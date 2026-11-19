'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

async function screen() {
  const elements = new Map(), stats = [], intervals = new Map();
  let handlers, nextTimerId = 1, time = 0, exportedBlob;
  const element = () => ({ children: [], dataset: {}, textContent: '', value: '',
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); }, click() {} });
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  class BrowserURL extends URL {
    static createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({ URL: BrowserURL, Blob, Date, console,
    location: { href: 'http://example.test/', protocol: 'http:' },
    performance: { now: () => time }, window: { addEventListener() {} },
    document: { getElementById: get, createElement: element },
    setInterval(callback, ms) { const id = nextTimerId++; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout() {},
    GameNetwork: {
      close() {}, getStats: () => stats.map((s) => ({ ...s })), getConnectionStats: async () => [],
      sendGameStart: () => stats.filter((s) => s.state === 'ready').length,
      async createRoom(url, callbacks) {
        handlers = callbacks;
        const room = { room_pin: 'ABC234', qr_data: '{}', transport: 'relay' };
        callbacks.onRoomCreated(room); return room;
      }
    } });
  vm.runInContext(readFileSync(require.resolve('../PC/front.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../PC/inGameFront.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../PC/inGameBack.js'), 'utf8'), context);
  vm.runInContext(readFileSync(require.resolve('../PC/back.js'), 'utf8'), context);
  await get('room-form').onsubmit({ preventDefault() {} });
  function player(id) {
    const value = { id, state: 'ready', count: 0, missing: 0, invalid: 0, latest: null };
    stats.push(value); handlers.onPlayerState(id, 'joined'); return value;
  }
  return { get, stats, player, context, intervals, handlers: () => handlers,
    tick() {
      time += 1000;
      for (const { callback } of [...intervals.values()]) callback();
    },
    async export() { await get('export').onclick(); return JSON.parse(await exportedBlob.text()); }
  };
}

test('joining a second player does not reset the first player receive-rate baseline', async () => {
  const ui = await screen();
  const one = ui.player('PLAYER_1'); one.count = 20;
  ui.player('PLAYER_2');
  ui.get('start').onclick();
  ui.tick();
  assert.equal(ui.get('players').children[0].children.length, 2);
  assert.equal(ui.get('players').children[0].children[1].textContent, 'ready');
  assert.match(ui.get('ingame-packets').children[0].children[1].textContent, /20\.0회\/초/);
});

test('export includes packets received after the last screen refresh', async () => {
  const ui = await screen();
  const one = ui.player('PLAYER_1'); one.count = 42;
  assert.equal((await ui.export()).players[0].count, 42);
});

test('lobby renders title, participant count, start button, QR screen and PIN', async () => {
  const ui = await screen();
  assert.equal(ui.get('title').textContent, 'GUM FIELD');
  assert.equal(ui.get('pin').textContent, 'ABC234');
  assert.match(ui.get('qr-screen').innerHTML, /^<svg\b/);
  assert.equal(ui.get('participant-count').textContent, '참여인원: 0 / 2명');
  assert.equal(ui.get('start').disabled, true);
  ui.player('PLAYER_1');
  assert.equal(ui.get('participant-count').textContent, '참여인원: 1 / 2명');
  assert.equal(ui.get('start').disabled, false);
});

test('clicking start switches to in-game view and renders controller packet overlay on 60Hz tick', async () => {
  const ui = await screen();
  const one = ui.player('PLAYER_1');
  ui.get('start').onclick();
  assert.equal(ui.get('lobby-view').hidden, true);
  assert.equal(ui.get('ingame-view').hidden, false);
  const packet = { type: 'SENSOR', sender_id: 'PLAYER_1', seq: 1, timestamp: 12345,
    payload: { rotation_vector: { x: 0, y: 0, z: 0, w: 1 }, acceleration: { x: 3, y: 0, z: 0 }, button: 1 } };
  one.count = 1; one.latest = packet;
  ui.handlers().onSensorData('PLAYER_1', packet.timestamp, packet.payload);
  assert.equal(ui.context.InGameBack.getSensorValue('PLAYER_1'), null);
  ui.context.InGameBack.tick();
  assert.equal(ui.get('ingame-packets').children.length, 1);
  assert.match(ui.get('ingame-packets').children[0].children[2].textContent, /"seq": 1/);
});

test('inGameBack reads sensor values at 60Hz and falls back to previous valid value on missing or invalid data', async () => {
  const ui = await screen();
  ui.player('PLAYER_1');

  ui.get('start').onclick();
  const inGameTimer = [...ui.intervals.values()].find((entry) => Math.abs(entry.ms - 1000 / 60) < 0.01);
  assert.ok(inGameTimer, 'registers a 60Hz interval');

  const validPayload = {
    rotation_vector: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    acceleration: { x: 1, y: 2, z: 3 },
    button: 1,
  };
  ui.handlers().onSensorData('PLAYER_1', 100, validPayload);
  assert.equal(ui.context.InGameBack.getSensorValue('PLAYER_1'), null, 'does not read sensor value before 60Hz tick');

  inGameTimer.callback();
  assert.deepEqual(ui.context.InGameBack.getSensorValue('PLAYER_1'), validPayload);

  // Next 60Hz tick with no new sensor packet -> uses previous valid value
  inGameTimer.callback();
  assert.deepEqual(ui.context.InGameBack.getSensorValue('PLAYER_1'), validPayload);

  // Next 60Hz tick with abnormal/invalid sensor value -> uses previous valid value
  ui.handlers().onSensorData('PLAYER_1', 200, {
    rotation_vector: { x: NaN, y: 0, z: 0, w: 1 },
    acceleration: { x: 0, y: 0, z: 0 },
    button: 1,
  });
  inGameTimer.callback();
  assert.deepEqual(ui.context.InGameBack.getSensorValue('PLAYER_1'), validPayload);
});
