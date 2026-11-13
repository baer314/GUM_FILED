'use strict';
const $ = (id) => document.getElementById(id);
const defaultUrl = new URL('/ws', location.href); defaultUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
$('server-url').value = defaultUrl.href;
try {
  const join = JSON.parse(new URLSearchParams(location.search).get('join') || 'null');
  if (join) { $('server-url').value = join.server_url; $('pin').value = join.pin; }
} catch { $('status').textContent = '접속 링크 형식이 잘못되었습니다. 주소와 PIN을 직접 입력하세요.'; }
let ws = null, pc = null, channel = null, timer = null, session = 0;
let id = null, mode = null, iceServers = [], pending = [], seq = 0, sent = 0, skipped = 0;
let started = false, paused = false;
const events = [];
function log(text) {
  events.push(text); if (events.length > 12) events.shift(); $('events').textContent = events.join('\n');
}
function status(text) { $('status').textContent = text; log(text); }
function leave() {
  session++; clearTimeout(timer); timer = null; started = false; paused = false;
  $('pause').textContent = '시험 송신 일시정지'; $('calibrate').disabled = true;
  const oldWs = ws, oldPc = pc, oldChannel = channel;
  ws = null; pc = null; channel = null; id = null; mode = null; pending = [];
  oldChannel?.close(); oldPc?.close(); if (oldWs && oldWs.readyState < 2) oldWs.close();
  $('join').disabled = false; $('player').textContent = '입장 전';
}
function sendInput(message) {
  const target = mode === 'relay' ? ws : channel;
  if (!target || (mode === 'relay' ? target.readyState !== WebSocket.OPEN : target.readyState !== 'open')) return false;
  if (target.bufferedAmount > 65536) return false;
  target.send(JSON.stringify(message)); return true;
}
function stopSending() { clearTimeout(timer); timer = null; started = false; $('calibrate').disabled = true; }
function startSending() {
  if (started) return;
  const rate = Number($('rate').value);
  if (!Number.isFinite(rate) || rate < 1 || rate > 120) { status('송신 목표는 1~120으로 입력하세요.'); return; }
  started = true; $('calibrate').disabled = false; status(`게임 시작 · ${mode} · 송신 중`);
  const tick = 1000 / rate;
  let next = performance.now() + tick;
  // setTimeout follows a monotonic target; do not burst old samples after background throttling.
  const transmit = () => {
    if (!started) return;
    if (!paused) {
      const x = Number($('motion').value), button = Number($('button').value);
      const m = { type: 'SENSOR', sender_id: id, seq: seq++, timestamp: Date.now(),
        payload: { rotation_vector: { x: 0, y: Math.sin(x / 40), z: 0, w: Math.cos(x / 40) },
          acceleration: { x, y: 0, z: 0 }, button } };
      if (sendInput(m)) sent++; else skipped++;
    }
    const now = performance.now(); next += tick;
    if (next < now) next = now + tick;
    timer = setTimeout(transmit, Math.max(0, next - now));
  };
  timer = setTimeout(transmit, tick);
}
function control(message) {
  if (message?.type === 'GAME_START') startSending();
  else status('받을 수 없는 게임 메시지입니다.');
}
$('join-form').onsubmit = (event) => {
  event.preventDefault(); leave(); seq = sent = skipped = 0; $('join').disabled = true;
  const token = session;
  try {
    const serverUrl = new URL($('server-url').value);
    if (!['ws:', 'wss:'].includes(serverUrl.protocol)) throw new Error('ws/wss 서버 주소가 필요합니다.');
    const socket = ws = new WebSocket(serverUrl);
    const active = () => token === session && ws === socket;
    socket.onopen = () => {
      if (active()) socket.send(JSON.stringify({ type: 'JOIN_ROOM', client_type: 'CONTROLLER', pin: $('pin').value.trim().toUpperCase() }));
    };
    socket.onerror = () => { if (active()) status('서버 연결 오류. 주소를 확인하세요.'); };
    socket.onclose = () => { if (active()) { leave(); status('서버 연결 종료. 다시 입장해 주세요.'); } };
    socket.onmessage = async ({ data }) => {
      if (!active()) return;
      const m = GameProtocol.parse(data);
      try {
        if (!m) throw new Error('서버 메시지 형식 오류');
        if (m.type === 'JOIN_SUCCESS') {
          id = m.assigned_id; mode = m.transport; iceServers = m.ice_servers;
          $('player').textContent = id;
          status(mode === 'relay' ? '서버 중계 준비 완료 · PC의 시작 신호 대기' : '입장 완료 · 직접 연결 대기');
        } else if (m.type === 'WEBRTC_OFFER') {
          if (pc || mode !== 'p2p' || m.sender_id !== 'PC_HOST' || m.target_id !== id) throw new Error('잘못된 연결 제안');
          const peer = pc = new RTCPeerConnection({ iceServers });
          peer.onicecandidate = ({ candidate }) => {
            if (candidate && active()) socket.send(JSON.stringify({ type: 'WEBRTC_ICE_CANDIDATE', target_id: 'PC_HOST', candidate: candidate.toJSON() }));
          };
          peer.onconnectionstatechange = () => {
            if (active() && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
              stopSending(); status(`직접 연결 ${peer.connectionState}. 나간 뒤 다시 입장하세요.`);
            }
          };
          peer.ondatachannel = ({ channel: incoming }) => {
            if (!active() || incoming.label !== 'game' || channel) { incoming.close(); return; }
            channel = incoming;
            channel.onopen = () => { if (active()) status('직접 연결 준비 완료 · PC의 시작 신호 대기'); };
            channel.onmessage = ({ data }) => { if (active()) control(GameProtocol.parse(data)); };
            channel.onclose = () => { if (active()) { stopSending(); status('직접 연결 종료. 다시 입장하세요.'); } };
            channel.onerror = () => { if (active()) { stopSending(); status('DataChannel 오류'); } };
          };
          await peer.setRemoteDescription({ type: 'offer', sdp: m.sdp });
          while (pending.length && active()) await peer.addIceCandidate(pending.shift());
          await peer.setLocalDescription(await peer.createAnswer());
          if (active()) socket.send(JSON.stringify({ type: 'WEBRTC_ANSWER', target_id: 'PC_HOST', sdp: peer.localDescription.sdp }));
        } else if (m.type === 'WEBRTC_ICE_CANDIDATE') {
          if (m.sender_id !== 'PC_HOST') throw new Error('잘못된 ICE 발신자');
          if (pc?.remoteDescription) await pc.addIceCandidate(m.candidate);
          else { if (pending.length >= 128) throw new Error('ICE 후보가 너무 많습니다.'); pending.push(m.candidate); }
        } else if (m.type === 'GAME_START' && mode === 'relay') control(m);
        else if (m.type === 'ERROR') {
          status(`${m.code}: ${m.message}`);
          if (!id) { leave(); }
        } else if (m.type === 'ROOM_CLOSED') { leave(); status('PC가 방을 닫았습니다.'); }
      } catch (error) { if (active()) { stopSending(); status(error.message); } }
    };
  } catch (error) { leave(); status(error.message); }
};
$('leave').onclick = () => { leave(); status('방에서 나왔습니다.'); };
$('calibrate').onclick = () => {
  if (sendInput({ type: 'CALIBRATE_CONFIRM', sender_id: id, button_input: 0 })) log('영점 확인 전송');
  else status('영점 확인을 보내지 못했습니다. 연결을 확인하세요.');
};
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? '시험 송신 재개' : '시험 송신 일시정지'; };
setInterval(() => { $('counts').textContent = `송신 ${sent} · 건너뜀 ${skipped} · 다음 순번 ${seq}`; }, 1000);
window.addEventListener('pagehide', leave);
