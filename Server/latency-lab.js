'use strict';

// node latency-lab.js [clean|jitter|stall] [report-file] [baseline-commit]
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { compileFunction } = require('node:vm');
const { WebSocket } = require('ws');

const sourceMs = 6000;
const targetHz = 60;
const stalls = [[1500, 2100], [3500, 4100]];
const pulseEvery = 15;

function loadServer(commit) {
  if (!commit) return require('./server.js');
  assert(/^[a-f0-9]{7,40}$/i.test(commit), 'baseline-commit must be a commit hash');
  const filename = path.join(__dirname, 'server.js');
  const source = execFileSync('git', ['show', `${commit}:Server/server.js`], { cwd: __dirname, encoding: 'utf8' });
  const baselineModule = { exports: {} };
  compileFunction(source, ['require', 'module', '__dirname'], { filename })(require, baselineModule, __dirname);
  return baselineModule.exports;
}

function samplePlayer(sent, received, latest, latencies, pulsesReceived) {
  assert.equal(latest, sent - 1, 'Did not receive the final sample');
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(1));
  return { sent, received, skipped: sent - received, over250ms: sorted.filter((ms) => ms > 250).length,
    buttonPulses: { sent: Math.ceil(sent / pulseEvery), received: pulsesReceived },
    latencyMs: { p50: percentile(0.50), p95: percentile(0.95), max: percentile(1) } };
}

async function run(scenario, baseline) {
  const app = loadServer(baseline).createServer({ transport: 'relay' });
  const sockets = [];
  const blockedWrites = [];
  const send = WebSocket.prototype.send;
  const bufferedAmount = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount');
  const sentAt = [[], []], received = [0, 0], latest = [-1, -1], latencies = [[], []];
  const pulsesReceived = [0, 0], pressed = [false, false];
  let began, resumeDownlink, maxDownlinkQueue = 0, receiveError;
  // Delay the actual write and its completion callback. This lets the production
  // server react to a blocked write, which OS socket buffers can mask in a short local test.
  if (scenario === 'stall') {
    Object.defineProperty(WebSocket.prototype, 'bufferedAmount', { ...bufferedAmount, get() {
      const bytes = bufferedAmount.get.call(this);
      return this.memberId === 'PC_HOST' && blockedWrites.length ? bytes + 2048 : bytes;
    } });
    WebSocket.prototype.send = function (data, options, callback) {
      const elapsed = performance.now() - began;
      const stall = stalls.find(([start, end]) => elapsed >= start && elapsed < end);
      if (this.memberId !== 'PC_HOST' || (!stall && !resumeDownlink)
          || !['SENSOR', 'BUTTON_CHANGE'].includes(JSON.parse(data).type)) {
        return send.call(this, data, options, callback);
      }
      blockedWrites.push(() => send.call(this, data, options, callback));
      maxDownlinkQueue = Math.max(maxDownlinkQueue, blockedWrites.length);
      if (resumeDownlink) return;
      resumeDownlink = setTimeout(() => {
        resumeDownlink = undefined;
        for (const write of blockedWrites.splice(0)) write();
      }, Math.ceil(stall[1] - elapsed));
    };
  }

  try {
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const url = `ws://127.0.0.1:${app.server.address().port}/ws`;
    async function connect() {
      const ws = new WebSocket(url);
      sockets.push(ws);
      await once(ws, 'open', { signal: AbortSignal.timeout(3000) });
      return ws;
    }
    const message = async (ws) => JSON.parse((await once(ws, 'message', { signal: AbortSignal.timeout(3000) }))[0]);
    const host = await connect(), roomMessage = message(host);
    host.send(JSON.stringify({ type: 'CREATE_ROOM', client_type: 'PC_HOST' }));
    const room = await roomMessage;
    assert.equal(room.type, 'ROOM_CREATED');
    const players = [];
    for (let i = 0; i < 2; i++) {
      const ws = await connect(), join = message(ws);
      ws.send(JSON.stringify({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin }));
      const id = `PLAYER_${i + 1}`;
      assert.equal((await join).assigned_id, id);
      players.push({ id, ws, lastUplinkSlot: 0, uplink: Promise.resolve() });
    }
    const startMessages = players.map(({ ws }) => message(ws));
    host.send(JSON.stringify({ type: 'GAME_START' }));
    for (const m of await Promise.all(startMessages)) assert.equal(m.type, 'GAME_START');

    host.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (!['SENSOR', 'BUTTON_CHANGE'].includes(m.type)) return;
      try {
        const i = players.findIndex(({ id }) => id === m.sender_id);
        assert(i >= 0);
        if (m.type === 'BUTTON_CHANGE') {
          assert.equal(m.button, pressed[i] ? 0 : i + 1, 'Unexpected button transition or missing release');
          pressed[i] = m.button !== 0;
          if (pressed[i]) pulsesReceived[i]++;
          return;
        }
        assert.equal(m.payload.acceleration.x, i === 0 ? 10 : -10);
        assert.equal(m.payload.button, m.seq % pulseEvery === 0 ? i + 1 : 0);
        assert(m.seq > latest[i], 'Out-of-order or duplicate sample');
        assert(Number.isFinite(sentAt[i][m.seq]), 'Received an unknown sequence');
        latest[i] = m.seq;
        received[i]++;
        if (!room.button_events && m.payload.button) pulsesReceived[i]++;
        latencies[i].push(performance.now() - sentAt[i][m.seq]);
      } catch (cause) { receiveError ||= cause; }
    });

    const sent = sourceMs * targetHz / 1000;
    began = performance.now();
    for (let seq = 0; seq < sent; seq++) {
      const until = began + seq * (1000 / targetHz) - performance.now();
      if (until > 0) await delay(Math.ceil(until));
      for (const [i, player] of players.entries()) {
        const now = sentAt[i][seq] = performance.now();
        const packet = JSON.stringify({
          type: 'SENSOR', sender_id: player.id, seq, timestamp: Date.now(),
          payload: { rotation_vector: { x: 0, y: 0, z: 0, w: 1 },
            acceleration: { x: i === 0 ? 10 : -10, y: 0, z: 0 }, button: seq % pulseEvery === 0 ? i + 1 : 0 }
        });
        if (scenario !== 'jitter') { player.ws.send(packet); continue; }
        // A delayed packet also holds up later packets on its TCP connection.
        const jitter = (seq * 17 + i * 31) % 91;
        const slot = Math.max(now + 40 + jitter, player.lastUplinkSlot + 1);
        player.lastUplinkSlot = slot;
        player.uplink = player.uplink.then(async () => {
          const wait = Math.ceil(slot - performance.now());
          if (wait > 0) await delay(wait);
          if (player.ws.readyState === WebSocket.OPEN) player.ws.send(packet);
        });
      }
    }
    await Promise.all(players.map(({ uplink }) => uplink));
    const deadline = performance.now() + 3000;
    while (latest.some((seq) => seq !== sent - 1) && performance.now() < deadline && !receiveError) await delay(10);
    if (receiveError) throw receiveError;
    if (room.button_events) {
      assert.deepEqual(pressed, [false, false]);
      assert.deepEqual(pulsesReceived, Array(2).fill(Math.ceil(sent / pulseEvery)));
    }
    return { scenario, server: baseline || 'working-tree', targetHzPerPlayer: targetHz, sourceMs,
      protectedButtonEvents: Boolean(room.button_events),
      simulatedUplinkMs: scenario === 'jitter' ? [40, 130] : null,
      simulatedPcWriteStallsMs: scenario === 'stall' ? stalls : [], maxDownlinkQueue,
      players: Object.fromEntries(players.map(({ id }, i) => [id, samplePlayer(sent, received[i], latest[i], latencies[i], pulsesReceived[i])])) };
  } finally {
    WebSocket.prototype.send = send;
    if (scenario === 'stall') Object.defineProperty(WebSocket.prototype, 'bufferedAmount', bufferedAmount);
    clearTimeout(resumeDownlink);
    for (const ws of sockets) ws.terminate();
    await app.close();
  }
}

async function main() {
  const [scenario = 'stall', reportFile, baseline] = process.argv.slice(2);
  assert(['clean', 'jitter', 'stall'].includes(scenario), 'Choose clean, jitter, or stall');
  if (reportFile) {
    const relative = path.relative(path.resolve(__dirname, '..'), path.resolve(reportFile));
    assert(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Store reports outside GUM_FIELD');
  }
  const result = await run(scenario, baseline);
  const json = JSON.stringify(result, null, 2) + '\n';
  if (reportFile) await writeFile(reportFile, json, { flag: 'wx' });
  process.stdout.write(json);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
