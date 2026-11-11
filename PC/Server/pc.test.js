'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

async function screen() {
  const elements = new Map(), stats = [];
  let handlers, tick, time = 0, exportedBlob;
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
    setInterval(callback) { tick = callback; }, setTimeout() {},
    GameNetwork: {
      close() {}, getStats: () => stats.map((s) => ({ ...s })), getConnectionStats: async () => [],
      async createRoom(url, callbacks) {
        handlers = callbacks;
        const room = { room_pin: 'ABC234', qr_data: '{}', transport: 'relay' };
        callbacks.onRoomCreated(room); return room;
      }
    } });
  vm.runInContext(readFileSync(require.resolve('./public/pc.js'), 'utf8'), context);
  await get('room-form').onsubmit({ preventDefault() {} });
  function player(id) {
    const value = { id, state: 'ready', count: 0, missing: 0, invalid: 0, latest: null };
    stats.push(value); handlers.onPlayerState(id, 'joined'); return value;
  }
  return { get, stats, player,
    tick() { time += 1000; tick(); },
    async export() { await get('export').onclick(); return JSON.parse(await exportedBlob.text()); }
  };
}

test('joining a second player does not reset the first player receive-rate baseline', async () => {
  const ui = await screen();
  const one = ui.player('PLAYER_1'); one.count = 20;
  ui.player('PLAYER_2'); ui.tick();
  assert.match(ui.get('players').children[0].children[1].textContent, /20\.0회\/초/);
});

test('export includes packets received after the last screen refresh', async () => {
  const ui = await screen();
  const one = ui.player('PLAYER_1'); one.count = 42;
  assert.equal((await ui.export()).players[0].count, 42);
});
