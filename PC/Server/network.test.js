'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

function browser(t) {
  const sockets = [], connections = [], timers = new Map();
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.bufferedAmount = 0; sockets.push(this); }
    send(text) { this.sent ||= []; this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    async message(m) { await this.onmessage({ data: JSON.stringify(m) }); }
  }
  class Peer {
    constructor() { connections.push(this); this.connectionState = 'connected'; }
    createDataChannel() {
      return this.channel = { readyState: 'open', bufferedAmount: 0, sent: [],
        send(text) { this.sent.push(JSON.parse(text)); }, close() { this.readyState = 'closed'; } };
    }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async getStats() { return new Map(); }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({ WebSocket: Socket, RTCPeerConnection: Peer,
    URL, performance, console, GameProtocol: require('../Game/protocol.js'),
    setTimeout(callback, ms) { const id = Symbol(); timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(readFileSync(require.resolve('../Game/network.js'), 'utf8'), context);
  const network = context.GameNetwork;
  t.after(() => network.close());
  async function room() {
    const opening = network.createRoom('ws://example.test/ws');
    const ws = sockets.at(-1); ws.readyState = 1; ws.onopen();
    await ws.message({ type: 'ROOM_CREATED', transport: 'p2p', ice_servers: [] });
    await opening;
    for (const id of ['PLAYER_1', 'PLAYER_2']) {
      await ws.message({ type: 'PLAYER_JOINED', assigned_id: id });
      connections.at(-1).channel.onopen();
    }
    return ws;
  }
  return { network, sockets, connections, timers, room };
}

test('room creation times out if a socket never opens', async (t) => {
  const b = browser(t);
  const outcome = b.network.createRoom('ws://example.test/ws').catch((error) => error);
  assert.equal(b.timers.size, 1);
  const timer = [...b.timers.values()][0];
  assert.equal(timer.ms, 15000); timer.callback();
  assert.match((await outcome).message, /시간|응답/);
  assert.equal(b.sockets[0].readyState, 3);
});

test('start validates every ready channel before sending to any player', async (t) => {
  const b = browser(t); await b.room();
  b.connections[1].channel.bufferedAmount = 262145;
  assert.throws(() => b.network.sendGameStart());
  assert.equal(b.connections[0].channel.sent.length, 0);
  b.connections[1].channel.bufferedAmount = 0;
  assert.equal(b.network.sendGameStart(), 2);
  assert.equal(b.connections[0].channel.sent.length, 1);
  assert.equal(b.connections[1].channel.sent.length, 1);
});

test('one stats failure does not prevent collecting other player diagnostics', async (t) => {
  const b = browser(t); await b.room();
  b.connections[0].getStats = async () => { throw new Error('stats unavailable'); };
  b.connections[1].getStats = async () => new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.01 }],
    ['local', { candidateType: 'host' }], ['remote', { candidateType: 'srflx' }],
  ]);
  const result = await b.network.getConnectionStats();
  assert(result.some((item) => item.id === 'PLAYER_1' && item.error === 'stats unavailable'));
  assert(result.some((item) => item.id === 'PLAYER_2' && item.local === 'host' && item.remote === 'srflx'));
});

test('leaving during stats collection does not abort the export', async (t) => {
  const b = browser(t), ws = await b.room();
  let rejectStats;
  b.connections[0].getStats = () => new Promise((resolve, reject) => { rejectStats = reject; });
  const collecting = b.network.getConnectionStats();
  await ws.message({ type: 'PLAYER_LEFT', assigned_id: 'PLAYER_1' });
  rejectStats(new Error('connection closed'));
  const result = await collecting;
  assert(!result.some((item) => item.id === 'PLAYER_1'));
});
