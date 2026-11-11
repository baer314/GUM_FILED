'use strict';
const $ = (id) => document.getElementById(id);
const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
$('server-url').value = url.href;
const events = [], history = new Map(), rates = new Map(), previousCounts = new Map();
let roomInfo = null, startedAt = null, lastTick = performance.now();
function log(text) {
  events.push(`${new Date().toISOString()} ${text}`);
  if (events.length > 100) events.shift();
  $('events').textContent = events.slice(-12).join('\n');
}
function reset() {
  roomInfo = null; startedAt = null; history.clear(); rates.clear(); previousCounts.clear();
  $('pin').textContent = '—'; $('qr-data').value = ''; $('controller-link').hidden = true;
  $('start').disabled = true; $('players').replaceChildren();
}
$('room-form').onsubmit = async (event) => {
  event.preventDefault(); GameNetwork.close(); reset(); $('create').disabled = true;
  try {
    const room = await GameNetwork.createRoom($('server-url').value, {
      onRoomCreated(m) {
        roomInfo = m; $('pin').textContent = m.room_pin; $('qr-data').value = m.qr_data;
        $('room-status').textContent = `입장 대기 · ${m.transport === 'p2p' ? '직접 연결' : '서버 중계'}`;
        const link = new URL('/controller.html', location.href);
        link.searchParams.set('join', m.qr_data);
        $('controller-link').href = link.href; $('controller-link').hidden = false;
        log(`방 생성 ${m.room_pin} (${m.transport})`);
      },
      onPlayerState(id, state) {
        if (state === 'joined') { history.delete(id); rates.delete(id); previousCounts.delete(id); }
        if (state === 'disconnected' && history.has(id)) history.get(id).state = state;
        log(`${id}: ${state}`); render();
      },
      onCalibrateConfirm(id) { $('calibration').textContent = `${id} 영점 확인 수신`; log(`${id}: 영점 확인`); },
      onError(e) { log(`${e.code}: ${e.message}`); },
      onRoomClosed() { $('room-status').textContent = '서버 연결 종료 · 방을 다시 생성해 주세요.'; $('start').disabled = true; },
    });
    roomInfo = room;
  } catch (error) { $('room-status').textContent = error.message; log(error.message); }
  finally { $('create').disabled = false; }
};
$('start').onclick = () => {
  try {
    const count = GameNetwork.sendGameStart(); startedAt ||= new Date().toISOString();
    log(`게임 시작 신호 → ${count}명`);
  } catch (error) { log(error.message); }
};
$('close').onclick = () => { GameNetwork.close(); reset(); $('room-status').textContent = '방을 닫았습니다.'; log('방 종료'); };
function render() {
  const live = GameNetwork.getStats();
  for (const s of live) history.set(s.id, s);
  $('start').disabled = !live.some((s) => s.state === 'ready');
  $('players').replaceChildren();
  for (const s of history.values()) {
    const card = document.createElement('section'); card.dataset.player = s.id;
    const heading = document.createElement('h2'); heading.textContent = s.id;
    const status = document.createElement('p'); status.textContent = `${s.state} · ${(rates.get(s.id) || 0).toFixed(1)}회/초 · 누적 ${s.count} · 누락 ${s.missing ?? '미측정(seq 없음)'} · 잘못된 입력 ${s.invalid}`;
    const values = document.createElement('pre'); values.textContent = s.latest ? JSON.stringify(s.latest.payload, null, 2) : '센서 수신 대기';
    card.append(heading, status, values); $('players').append(card);
  }
}
setInterval(() => {
  const now = performance.now(), seconds = (now - lastTick) / 1000; lastTick = now;
  for (const id of rates.keys()) rates.set(id, 0);
  for (const s of GameNetwork.getStats()) {
    rates.set(s.id, (s.count - (previousCounts.get(s.id) || 0)) / seconds);
    previousCounts.set(s.id, s.count);
  }
  render();
}, 1000);
$('export').onclick = async () => {
  render();
  const result = { kind: 'synthetic-controller-test', actualAndroidVerified: false,
    exportedAt: new Date().toISOString(), startedAt, room: roomInfo,
    players: [...history.values()], connections: await GameNetwork.getConnectionStats(), events };
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = objectUrl; a.download = 'gum-transport-test.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
window.addEventListener('pagehide', () => GameNetwork.close());
