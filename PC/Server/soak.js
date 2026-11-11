'use strict';
// Run explicitly: node soak.js [seconds=300] [report-file-outside-GUM_FILED]
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');
const { createServer } = require('./server.js');

async function main() {
  const seconds = Number(process.argv[2] || 300);
  assert(Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600, 'seconds must be 1..3600');
  const reportFile = process.argv[3] && path.resolve(process.argv[3]);
  const projectRoot = path.resolve(__dirname, '../..');
  assert(!reportFile || !reportFile.toLowerCase().startsWith(projectRoot.toLowerCase() + path.sep), 'Store reports outside GUM_FILED');
  const app = createServer({ transport: 'relay' });
  const sockets = [];
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const url = `ws://127.0.0.1:${app.server.address().port}/ws`;
    async function connect() {
      const ws = new WebSocket(url); sockets.push(ws); await once(ws, 'open'); return ws;
    }
    const host = await connect();
    let received = [0, 0], lastSeq = [-1, -1], failure = null;
    host.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type !== 'SENSOR') return;
      try {
        const index = ['PLAYER_1', 'PLAYER_2'].indexOf(m.sender_id);
        assert(index >= 0); assert.equal(m.payload.acceleration.x, index === 0 ? 20 : -20);
        assert.equal(m.seq, lastSeq[index] + 1); lastSeq[index] = m.seq; received[index]++;
      } catch (error) { failure ||= error; }
    });
    const roomPromise = once(host, 'message');
    host.send(JSON.stringify({ type: 'CREATE_ROOM', client_type: 'PC_HOST' }));
    const room = JSON.parse((await roomPromise)[0]);
    const players = [];
    for (let index = 0; index < 2; index++) {
      const ws = await connect(), joined = once(ws, 'message');
      ws.send(JSON.stringify({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin }));
      assert.equal(JSON.parse((await joined)[0]).assigned_id, `PLAYER_${index + 1}`); players.push(ws);
    }
    const starts = players.map((ws) => once(ws, 'message'));
    host.send(JSON.stringify({ type: 'GAME_START' }));
    for (const start of await Promise.all(starts)) assert.equal(JSON.parse(start[0]).type, 'GAME_START');
    const began = performance.now(), end = began + seconds * 1000;
    let sent = 0, next = began, progressAt = began + 30000;
    while (performance.now() < end) {
      if (failure) throw failure;
      for (let index = 0; index < 2; index++) players[index].send(JSON.stringify({
        type: 'SENSOR', sender_id: `PLAYER_${index + 1}`, seq: sent, timestamp: Date.now(),
        payload: { rotation_vector: { x: 0, y: 0, z: 0, w: 1 },
          acceleration: { x: index === 0 ? 20 : -20, y: 0, z: 0 }, button: index + 1 }
      }));
      sent++; next += 1000 / 60;
      const now = performance.now();
      if (now > progressAt) { console.log(JSON.stringify({ elapsedSeconds: Math.round((now - began) / 1000), sentPerPlayer: sent, received })); progressAt += 30000; }
      if (next < now - 1000 / 60) next = now + 1000 / 60;
      await delay(Math.max(0, next - performance.now()));
    }
    for (let attempt = 0; attempt < 50 && received.some((n) => n !== sent); attempt++) await delay(100);
    if (failure) throw failure;
    assert.deepEqual(received, [sent, sent]);
    const elapsedSeconds = (performance.now() - began) / 1000;
    const result = { test: 'local-websocket-relay-synthetic', passed: true, actualAndroidVerified: false,
      externalNetworksVerified: false, elapsedSeconds, targetHz: 60, sentPerPlayer: sent, received,
      receivedHz: received.map((n) => n / elapsedSeconds), missing: [0, 0] };
    if (reportFile) await writeFile(reportFile, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { for (const ws of sockets) ws.terminate(); await app.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
