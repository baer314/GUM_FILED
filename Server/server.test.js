'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { WebSocket } = require('ws');
const { createServer } = require('./server.js');

async function fixture(t, transport = 'relay', options = {}) {
  const app = createServer({ transport, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function client() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
    const messages = [], waiters = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      const waiter = waiters.shift();
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(message); } else messages.push(message);
    });
    await once(ws, 'open');
    return {
      ws, send: (m) => ws.send(JSON.stringify(m)),
      next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
        const entry = { resolve, timer: setTimeout(() => reject(new Error('Message timeout')), 3000) };
        waiters.push(entry);
      }),
      close: async () => { const closed = once(ws, 'close'); ws.close(); await closed; },
    };
  }
  const host = await client();
  host.send({ type: 'CREATE_ROOM', client_type: 'PC_HOST' });
  const room = await host.next();
  assert.equal(room.type, 'ROOM_CREATED');
  async function join() {
    const player = await client();
    player.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
    player.joined = await player.next(); return player;
  }
  return { app, base, host, room, client, join };
}
const sample = (id, seq = 0) => ({ type: 'SENSOR', sender_id: id, seq, timestamp: Date.now(),
  payload: { rotation_vector: { x: 0, y: 0, z: 0, w: 1 }, acceleration: { x: 1, y: 2, z: 3 }, button: 0 } });

test('rooms: two players, rejection, leave/rejoin, host cleanup', async (t) => {
  const f = await fixture(t);
  assert.match(f.room.room_pin, /^[A-Z2-9]{6}$/);
  assert.equal(JSON.parse(f.room.qr_data).server_url, f.base.replace('http:', 'ws:') + '/ws');
  const invalid = await f.client();
  invalid.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: 'BADPIN' });
  assert.equal((await invalid.next()).code, 'INVALID_PIN');
  const one = await f.join(), two = await f.join();
  assert.equal(one.joined.assigned_id, 'PLAYER_1'); assert.equal(two.joined.assigned_id, 'PLAYER_2');
  assert.equal((await f.host.next()).assigned_id, 'PLAYER_1');
  assert.equal((await f.host.next()).assigned_id, 'PLAYER_2');
  const third = await f.join(); assert.equal(third.joined.code, 'ROOM_FULL');
  await one.close(); assert.equal((await f.host.next()).type, 'PLAYER_LEFT');
  const replacement = await f.join(); assert.equal(replacement.joined.assigned_id, 'PLAYER_1');
  await f.host.next();
  const twoClosed = once(two.ws, 'close'), replacementClosed = once(replacement.ws, 'close');
  await f.host.close(); assert.equal((await two.next()).type, 'ROOM_CLOSED');
  assert.equal((await replacement.next()).type, 'ROOM_CLOSED');
  await Promise.all([twoClosed, replacementClosed]);
  const after = await f.join(); assert.equal(after.joined.code, 'INVALID_PIN');
});

test('relay: both inputs, controls, malformed input and sender spoofing', async (t) => {
  const f = await fixture(t), one = await f.join(), two = await f.join();
  await f.host.next(); await f.host.next();
  f.host.send({ type: 'GAME_START' });
  assert.equal((await one.next()).type, 'GAME_START'); assert.equal((await two.next()).type, 'GAME_START');
  one.send(sample('PLAYER_1')); two.send(sample('PLAYER_2'));
  const received = [await f.host.next(), await f.host.next()];
  assert.deepEqual(received.map((m) => m.sender_id).sort(), ['PLAYER_1', 'PLAYER_2']);
  one.send(sample('PLAYER_2')); assert.equal((await one.next()).code, 'INVALID_SENDER');
  const bad = sample('PLAYER_1'); bad.payload.rotation_vector.w = null;
  one.send(bad); assert.equal((await one.next()).code, 'INVALID_MESSAGE');
  one.ws.send('{'); assert.equal((await one.next()).code, 'INVALID_MESSAGE');
  one.ws.send(Buffer.from('{}')); assert.equal((await one.next()).code, 'INVALID_MESSAGE');
  one.send({ type: 'GAME_START' }); assert.equal((await one.next()).code, 'INVALID_MESSAGE');
  f.host.send(sample('PLAYER_1')); assert.equal((await f.host.next()).code, 'INVALID_MESSAGE');
  one.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: f.room.room_pin });
  assert.equal((await one.next()).code, 'ALREADY_JOINED');
});

function holdFirstSensorWrite(t, backedUp = true) {
  const send = WebSocket.prototype.send;
  const bufferedAmount = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount').get;
  let complete, blockedSocket;
  t.mock.getter(WebSocket.prototype, 'bufferedAmount', function () {
    return this === blockedSocket ? 2048 : bufferedAmount.call(this);
  });
  t.mock.method(WebSocket.prototype, 'send', function (data, options, callback) {
    if (!complete && typeof options === 'function' && JSON.parse(data).type === 'SENSOR') {
      complete = options;
      if (backedUp) blockedSocket = this;
      return send.call(this, data);
    }
    return send.call(this, data, options, callback);
  });
  return () => { blockedSocket = null; complete(); };
}

async function waitForPriorFrames(player) {
  const pong = once(player.ws, 'pong', { signal: AbortSignal.timeout(3000) });
  player.ws.ping();
  await pong;
}

test('relay preserves a brief button press when a write callback lags but the socket can send', async (t) => {
  const f = await fixture(t), one = await f.join();
  await f.host.next();
  const release = holdFirstSensorWrite(t, false);
  one.send(sample('PLAYER_1', 0));
  assert.equal((await f.host.next()).seq, 0);

  const press = sample('PLAYER_1', 1);
  press.payload.button = 1;
  one.send(press);
  one.send(sample('PLAYER_1', 2));
  assert.deepEqual(await f.host.next(), { type: 'BUTTON_CHANGE', sender_id: 'PLAYER_1', button: 1 });
  assert.equal((await f.host.next()).payload.button, 1);
  assert.deepEqual(await f.host.next(), { type: 'BUTTON_CHANGE', sender_id: 'PLAYER_1', button: 0 });
  assert.equal((await f.host.next()).payload.button, 0);
  release();
});

test('PC receives both short buttons in order and the newest motion after relay congestion', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const context = vm.createContext({ WebSocket, URL, performance, console, setTimeout, clearTimeout,
    GameProtocol: require('../PC/protocol.js') });
  vm.runInContext(readFileSync(require.resolve('../PC/network.js'), 'utf8'), context);
  const network = context.GameNetwork, events = new EventEmitter();
  t.after(() => network.close());
  const room = await network.createRoom(f.base.replace('http:', 'ws:') + '/ws', {
    onPlayerState: (id, state) => events.emit(state, id),
    onSensorData: (id) => events.emit(id),
  });
  const players = [];
  for (const id of ['PLAYER_1', 'PLAYER_2']) {
    const controller = await f.client();
    const ready = once(events, 'ready');
    controller.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
    assert.equal((await controller.next()).assigned_id, id);
    assert.equal((await ready)[0], id);
    players.push({ id, controller });
  }
  network.sendGameStart();
  for (const { controller } of players) assert.equal((await controller.next()).type, 'GAME_START');

  const release = holdFirstSensorWrite(t);
  const firstMotion = once(events, 'PLAYER_1');
  players[0].controller.send(sample('PLAYER_1'));
  await firstMotion;

  for (const [i, { id, controller }] of players.entries()) {
    const press = sample(id, 1);
    press.payload.button = i + 1;
    controller.send(press);
    const fresh = sample(id, 2);
    fresh.payload.acceleration.x = i === 0 ? 2 : -2;
    controller.send(fresh);
  }
  await Promise.all(players.map(({ controller }) => waitForPriorFrames(controller)));
  const latestMotion = players.map(({ id }) => once(events, id));
  release();
  await Promise.all(latestMotion);

  for (const [i, { id }] of players.entries()) {
    const { latest } = network.getStats().find((s) => s.id === id);
    assert.equal(latest.seq, 2);
    assert.equal(latest.payload.acceleration.x, i === 0 ? 2 : -2);
    assert.equal(latest.payload.button, 0, 'Motion would have overwritten the short press');
    assert.equal(network.consumeButton(id), i + 1);
  }
  for (const { id } of players) assert.equal(network.consumeButton(id), 0);

  const { id, controller } = players[0];
  const pressed = sample(id, 3);
  pressed.payload.button = 1;
  const motion = once(events, id);
  controller.send(pressed);
  await motion;
  const disconnected = once(events, 'disconnected');
  await controller.close();
  assert.equal((await disconnected)[0], id);
  assert.equal(network.consumeButton(id), 0);
});

test('relay forwards the latest sample of each player after a blocked write', async (t) => {
  const f = await fixture(t), one = await f.join(), two = await f.join();
  await f.host.next(); await f.host.next();
  const release = holdFirstSensorWrite(t);
  one.send(sample('PLAYER_1', 0));
  assert.equal((await f.host.next()).seq, 0);

  for (let seq = 1; seq <= 9; seq++) {
    one.send(sample('PLAYER_1', seq));
    two.send(sample('PLAYER_2', seq));
  }
  await Promise.all([one, two].map(waitForPriorFrames));
  f.host.send({ type: 'GAME_START' });
  assert.equal((await one.next()).type, 'GAME_START');
  assert.equal((await two.next()).type, 'GAME_START');

  release();
  const latest = [await f.host.next(), await f.host.next()];
  assert.deepEqual(latest.map((m) => [m.sender_id, m.seq]).sort(), [['PLAYER_1', 9], ['PLAYER_2', 9]]);
});

test('relay discards queued input when the player slot is reused', async (t) => {
  const f = await fixture(t), one = await f.join(), two = await f.join();
  await f.host.next(); await f.host.next();
  const release = holdFirstSensorWrite(t);
  two.send(sample('PLAYER_2', 0));
  await f.host.next();

  one.send(sample('PLAYER_1', 99));
  await waitForPriorFrames(one);
  await one.close();
  assert.equal((await f.host.next()).type, 'PLAYER_LEFT');
  const replacement = await f.join();
  assert.equal(replacement.joined.assigned_id, 'PLAYER_1');
  assert.equal((await f.host.next()).type, 'PLAYER_JOINED');

  release();
  const fresh = sample('PLAYER_1', 0);
  replacement.send(fresh);
  assert.deepEqual(await f.host.next(), fresh);
});

test('P2P signaling: role checks, room isolation, trusted sender and candidate routing', async (t) => {
  const f = await fixture(t, 'p2p');
  const one = await f.join(); await f.host.next();
  f.host.send({ type: 'WEBRTC_OFFER', target_id: 'PLAYER_1', sender_id: 'FAKE', sdp: 'offer-sdp' });
  assert.equal((await one.next()).sender_id, 'PC_HOST');
  one.send({ type: 'WEBRTC_ANSWER', target_id: 'PC_HOST', sdp: 'answer-sdp' });
  assert.equal((await f.host.next()).sender_id, 'PLAYER_1');
  const candidate = { candidate: 'candidate:example', sdpMid: '0', sdpMLineIndex: 0 };
  one.send({ type: 'WEBRTC_ICE_CANDIDATE', target_id: 'PC_HOST', candidate });
  assert.deepEqual((await f.host.next()).candidate, candidate);
  one.send({ type: 'WEBRTC_OFFER', target_id: 'PC_HOST', sdp: 'bad-role' });
  assert.equal((await one.next()).code, 'INVALID_TARGET');
  f.host.send({ type: 'WEBRTC_ANSWER', target_id: 'PLAYER_1', sdp: 'bad-role' });
  assert.equal((await f.host.next()).code, 'INVALID_TARGET');
  const otherHost = await f.client(); otherHost.send({ type: 'CREATE_ROOM', client_type: 'PC_HOST' });
  const otherRoom = await otherHost.next();
  const otherPlayer = await f.client();
  otherPlayer.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: otherRoom.room_pin });
  await otherPlayer.next(); await otherHost.next();
  one.send({ type: 'WEBRTC_ANSWER', target_id: otherRoom.room_pin, sdp: 'cross-room' });
  assert.equal((await one.next()).code, 'INVALID_TARGET');
  otherHost.send({ type: 'WEBRTC_OFFER', target_id: 'PLAYER_1', sdp: 'other-room' });
  assert.equal((await otherPlayer.next()).sdp, 'other-room');
  one.send(sample('PLAYER_1')); assert.equal((await one.next()).code, 'WRONG_TRANSPORT');
  f.host.send({ type: 'WEBRTC_OFFER', target_id: 'PLAYER_1', sdp: {} });
  assert.equal((await f.host.next()).code, 'INVALID_MESSAGE');
});

test('HTTP allowlist and explicit public QR address', async (t) => {
  const f = await fixture(t, 'relay', { publicBaseUrl: 'https://example.test' });
  assert.deepEqual(JSON.parse(f.room.qr_data), { server_url: 'wss://example.test/ws', pin: f.room.room_pin, transport: 'relay' });
  for (const file of ['/', '/controller.html', '/protocol.js', '/network.js', '/front.js', '/inGameFront.js', '/inGameBack.js', '/back.js', '/controller.js', '/style.css', '/health',
    '/Graphic/Background.js', '/Graphic/Arm.js', '/Graphic/Head.js', '/Graphic/Sword.js', '/inGameDev.js']) {
    const response = await fetch(f.base + file); assert.equal(response.status, 200, file);
  }
  for (const file of ['/server.js', '/package.json', '/README.txt', '/.env', '/..%2fserver.js']) {
    assert.equal((await fetch(f.base + file)).status, 404, file);
  }
  assert.equal((await fetch(f.base, { method: 'POST' })).status, 405);
  assert.throws(() => createServer({ transport: 'auto' }));
  assert.throws(() => createServer({ publicBaseUrl: 'file:///C:/Windows' }));
});

test('heartbeat releases a controller that no longer replies', async (t) => {
  const f = await fixture(t, 'relay', { heartbeatMs: 40 });
  const one = await f.join(); await f.host.next(); one.ws._autoPong = false;
  assert.equal((await f.host.next()).type, 'PLAYER_LEFT');
  const replacement = await f.join(); assert.equal(replacement.joined.assigned_id, 'PLAYER_1');
});

test('PC module: callbacks, sequence gaps, duplicate rejection and slot reuse', async (t) => {
  const f = await fixture(t);
  const context = vm.createContext({ WebSocket, URL, performance, console, setTimeout, clearTimeout,
    GameProtocol: require('../PC/protocol.js') });
  vm.runInContext(readFileSync(require.resolve('../PC/network.js'), 'utf8'), context);
  const network = context.GameNetwork, events = new EventEmitter();
  t.after(() => network.close());
  const room = await network.createRoom(f.base.replace('http:', 'ws:') + '/ws', {
    onPlayerState: (id, state) => events.emit(state, id),
    onSensorData: (...args) => events.emit('sensor', args),
  });
  const one = await f.client(), readyOne = once(events, 'ready');
  one.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
  await one.next(); assert.equal((await readyOne)[0], 'PLAYER_1');
  const two = await f.client(), readyTwo = once(events, 'ready');
  two.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
  await two.next(); assert.equal((await readyTwo)[0], 'PLAYER_2');
  assert.equal(network.sendGameStart(), 2);
  assert.equal((await one.next()).type, 'GAME_START'); assert.equal((await two.next()).type, 'GAME_START');
  let received = once(events, 'sensor'); one.send(sample('PLAYER_1', 0));
  assert.equal((await received)[0][0], 'PLAYER_1');
  for (const [seq, button] of [[0, 2], [2, 1], [1, 2]]) {
    const packet = sample('PLAYER_1', seq);
    packet.payload.button = button;
    one.send(packet);
  }
  received = once(events, 'sensor'); one.send(sample('PLAYER_1', 3)); await received;
  const stats = network.getStats().find((s) => s.id === 'PLAYER_1');
  assert.equal(stats.count, 3); assert.equal(stats.missing, 1); assert.equal(stats.invalid, 0);
  assert.equal(network.consumeButton('PLAYER_1'), 1, 'a newer numbered input can still change the button');
  assert.equal(network.consumeButton('PLAYER_1'), 0);
  assert.equal(network.consumeButton('PLAYER_1'), 0);
  received = once(events, 'sensor'); two.send(sample('PLAYER_2', 4)); await received;
  assert.equal(network.getStats().find((s) => s.id === 'PLAYER_2').missing, 4);
  const disconnected = once(events, 'disconnected'); await one.close(); await disconnected;
  assert.equal(network.getStats().length, 1);
  const replacement = await f.client(), readyAgain = once(events, 'ready');
  replacement.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
  await replacement.next(); await readyAgain;
  received = once(events, 'sensor'); replacement.send(sample('PLAYER_1', 0)); await received;
  const fresh = network.getStats().find((s) => s.id === 'PLAYER_1');
  assert.equal(fresh.count, 1); assert.equal(fresh.missing, 0);
  network.close(); assert.equal(network.getStats().length, 0);
});

test('Android packet without seq is relayed unchanged and loss is unknown', async (t) => {
  const f = await fixture(t);
  const context = vm.createContext({ WebSocket, URL, performance, console, setTimeout, clearTimeout,
    GameProtocol: require('../PC/protocol.js') });
  vm.runInContext(readFileSync(require.resolve('../PC/network.js'), 'utf8'), context);
  const network = context.GameNetwork, events = new EventEmitter();
  t.after(() => network.close());
  const room = await network.createRoom(f.base.replace('http:', 'ws:') + '/ws', {
    onPlayerState: (id, state) => events.emit(state, id),
    onSensorData: (...args) => events.emit('sensor', args),
  });
  const player = await f.client(), ready = once(events, 'ready');
  player.send({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: room.room_pin });
  await player.next(); await ready;
  const packet = { type: 'SENSOR', sender_id: 'PLAYER_1', timestamp: 1794312345678,
    payload: { rotation_vector: { x: 0.6532, y: 0.0123, z: -0.0087, w: 0.7571 },
      acceleration: { x: 0.12, y: -3.85, z: 1.04 }, button: 1 } };
  let received = once(events, 'sensor'); player.send(packet);
  assert.deepEqual((await received)[0], ['PLAYER_1', packet.timestamp, packet.payload]);
  assert.deepEqual(network.getStats()[0].latest, packet);
  assert.equal(network.getStats()[0].missing, null);
  // Millisecond timestamps are not unique IDs: do not discard a repeated timestamp.
  received = once(events, 'sensor'); player.send(packet); await received;
  assert.equal(network.getStats()[0].count, 2);
  for (const seq of [null, -1, '1', 1.5]) {
    player.send({ ...packet, seq }); assert.equal((await player.next()).code, 'INVALID_MESSAGE');
  }
  received = once(events, 'sensor'); player.send({ ...packet, seq: 4 }); await received;
  assert.equal(network.getStats()[0].count, 3);
  assert.equal(network.getStats()[0].missing, null);
});
