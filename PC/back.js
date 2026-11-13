'use strict';
const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
GameFront.setServerUrl(url.href);
GameFront.initTitle('GUM FIELD');

const events = [], history = new Map(), rates = new Map(), previousCounts = new Map();
let roomInfo = null, startedAt = null, lastTick = performance.now();

function log(text) {
  events.push(`${new Date().toISOString()} ${text}`);
  if (events.length > 100) events.shift();
  GameFront.renderLog(events);
}

function reset() {
  roomInfo = null; startedAt = null; history.clear(); rates.clear(); previousCounts.clear();
  globalThis.InGameBack?.stop();
  GameFront.resetView();
}

function syncHistory() {
  const live = GameNetwork.getStats();
  for (const s of live) history.set(s.id, s);
  return live;
}

function render() {
  const live = syncHistory();
  const connectedCount = live.filter((s) => s.state !== 'disconnected').length;
  const canStart = live.some((s) => s.state === 'ready');
  const players = [...history.values()];
  GameFront.renderPlayers(players, rates, connectedCount, canStart);
  globalThis.InGameBack?.sync(players, rates);
}

async function openRoom(event) {
  event?.preventDefault(); GameNetwork.close(); reset(); GameFront.setCreateDisabled(true);
  try {
    const room = await GameNetwork.createRoom(GameFront.getServerUrl(), {
      onRoomCreated(m) {
        roomInfo = m;
        const link = new URL('/controller.html', location.href);
        link.searchParams.set('join', m.qr_data);
        GameFront.renderRoomCreated(m, link.href);
        log(`방 생성 ${m.room_pin} (${m.transport})`);
        render();
      },
      onPlayerState(id, state) {
        if (state === 'joined') { history.delete(id); rates.delete(id); previousCounts.delete(id); }
        if (state === 'disconnected' && history.has(id)) history.get(id).state = state;
        log(`${id}: ${state}`); render();
      },
      onSensorData(id, timestamp, payload) {
        syncHistory();
        globalThis.InGameBack?.onSensorData(id, timestamp, payload, [...history.values()], rates);
      },
      onError(e) { log(`${e.code}: ${e.message}`); },
      onRoomClosed() { GameFront.renderStatus('서버 연결 종료 · 방을 다시 생성해 주세요.'); GameFront.setStartDisabled(true); },
    });
    roomInfo = room;
  } catch (error) { GameFront.renderStatus(error.message); log(error.message); }
  finally { GameFront.setCreateDisabled(false); }
}

GameFront.bindEvents({
  onCreateRoom: openRoom,
  onStartGame() {
    try {
      const count = GameNetwork.sendGameStart(); startedAt ||= new Date().toISOString();
      log(`게임 시작 신호 → ${count}명`);
      syncHistory();
      globalThis.InGameBack?.start([...history.values()], rates);
    } catch (error) { log(error.message); }
  },
  onCloseRoom() {
    GameNetwork.close(); reset(); GameFront.renderStatus('방을 닫았습니다.'); log('방 종료');
  },
  async onExport() {
    render();
    const result = { kind: 'synthetic-controller-test', actualAndroidVerified: false,
      exportedAt: new Date().toISOString(), startedAt, room: roomInfo,
      players: [...history.values()], connections: await GameNetwork.getConnectionStats(), events };
    GameFront.downloadJson('gum-transport-test.json', result);
  },
});

setInterval(() => {
  const now = performance.now(), seconds = (now - lastTick) / 1000; lastTick = now;
  for (const id of rates.keys()) rates.set(id, 0);
  for (const s of GameNetwork.getStats()) {
    rates.set(s.id, (s.count - (previousCounts.get(s.id) || 0)) / seconds);
    previousCounts.set(s.id, s.count);
  }
  render();
}, 1000);

window.addEventListener('pagehide', () => GameNetwork.close());
openRoom();
