'use strict';
const $ = (id) => document.getElementById(id);
const defaultUrl = new URL('/ws', location.href);
defaultUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
$('server-url').value = defaultUrl.href;
try {
  const join = JSON.parse(new URLSearchParams(location.search).get('join') || 'null');
  if (join) {
    $('server-url').value = join.server_url;
    $('pin').value = join.pin;
  }
} catch {
  $('status').textContent = '접속 링크 형식이 잘못되었습니다. 주소와 PIN을 직접 입력하세요.';
}

let ws = null, pc = null, channel = null, timer = null, session = 0;
let id = null, mode = null, iceServers = [], pending = [], seq = 0, sent = 0, skipped = 0;
let started = false, paused = false;
const events = [];

// 센서 상태: 회전축 각도(deg), 공격 가속도, 버튼 상태
const state = {
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  accel: { x: 0, y: 0, z: 0 },
  button: 0,
};

const pressedKeys = new Set();

function log(text) {
  events.push(text);
  if (events.length > 12) events.shift();
  if ($('events')) $('events').textContent = events.join('\n');
}

function status(text) {
  if ($('status')) $('status').textContent = text;
  log(text);
}

function wrapAngle(deg) {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180 && deg > 0) a = 180;
  return Math.round(a * 10) / 10;
}

// 오일러 각(X, Y, Z 도 단위)을 정규화된 쿼터니언 { x, y, z, w }로 변환
function eulerToQuaternion(degX, degY, degZ) {
  const rx = (degX * Math.PI) / 360;
  const ry = (degY * Math.PI) / 360;
  const rz = (degZ * Math.PI) / 360;

  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const x = sx * cy * cz + cx * sy * sz;
  const y = cx * sy * cz - sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  const w = cx * cy * cz - sx * sy * sz;

  const len = Math.hypot(x, y, z, w) || 1;
  return {
    x: Number((x / len).toFixed(4)),
    y: Number((y / len).toFixed(4)),
    z: Number((z / len).toFixed(4)),
    w: Number((w / len).toFixed(4)),
  };
}

function buildPayload() {
  const rotation_vector = eulerToQuaternion(state.rotX, state.rotY, state.rotZ);
  const acceleration = {
    x: Number(state.accel.x.toFixed(2)),
    y: Number(state.accel.y.toFixed(2)),
    z: Number(state.accel.z.toFixed(2)),
  };
  return {
    rotation_vector,
    acceleration,
    button: state.button,
  };
}

function syncControlsFromState() {
  if ($('rot-x')) $('rot-x').value = String(Math.round(state.rotX));
  if ($('rot-y')) $('rot-y').value = String(Math.round(state.rotY));
  if ($('rot-z')) $('rot-z').value = String(Math.round(state.rotZ));
  if ($('rot-x-val')) $('rot-x-val').textContent = `${Math.round(state.rotX)}°`;
  if ($('rot-y-val')) $('rot-y-val').textContent = `${Math.round(state.rotY)}°`;
  if ($('rot-z-val')) $('rot-z-val').textContent = `${Math.round(state.rotZ)}°`;
  if ($('motion')) $('motion').value = String(Number(state.accel.x.toFixed(1)));
  if ($('button')) $('button').value = String(state.button);

  const payload = buildPayload();
  const q = payload.rotation_vector;
  if ($('quat-display')) {
    $('quat-display').textContent = `Quaternion(xyzw): ${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}, ${q.w.toFixed(2)}`;
  }
  if ($('packet-preview')) {
    $('packet-preview').textContent = JSON.stringify(payload, null, 2);
  }
  if ($('pill-a')) $('pill-a').classList.toggle('active', pressedKeys.has('KeyA') || state.accel.x > 0.5);
  if ($('pill-s')) $('pill-s').classList.toggle('active', state.button === 1);
  if ($('pill-d')) $('pill-d').classList.toggle('active', state.button === 2);
}

// 영점 잡기 (Space 키 또는 버튼)
function resetZeroPoint() {
  state.rotX = 0;
  state.rotY = 0;
  state.rotZ = 0;
  state.accel.x = 0;
  state.accel.y = 0;
  state.accel.z = 0;
  syncControlsFromState();
  updatePhoneModel();
  if ($('pill-space')) {
    $('pill-space').classList.add('active');
    setTimeout(() => $('pill-space')?.classList.remove('active'), 180);
  }
}

// 3D 핸드폰 모델 초기화 및 렌더링
let scene = null, camera = null, renderer = null, phoneGroup = null;
let volUpMesh = null, smashMesh = null, bladeGuideMesh = null;

function initPhone3D() {
  const canvas = $('phone-canvas');
  const THREE = globalThis.THREE;
  if (!canvas || !THREE) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1715);

  const width = canvas.clientWidth || 520;
  const height = canvas.clientHeight || 340;
  camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
  camera.position.set(0, 3.4, 5.2);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height, false);
  if (globalThis.devicePixelRatio) {
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(4, 7, 5);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(8, 8, 0x2f6b55, 0x1a332b);
  grid.position.y = -1.5;
  scene.add(grid);

  const axes = new THREE.AxesHelper(2.2);
  scene.add(axes);

  phoneGroup = new THREE.Group();

  // 스마트폰 본체
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.14, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x263834, roughness: 0.35, metalness: 0.45 })
  );
  phoneGroup.add(body);

  // 스마트폰 화면
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.16, 0.02, 2.3),
    new THREE.MeshStandardMaterial({ color: 0x4fd1a5, roughness: 0.25, metalness: 0.15 })
  );
  screen.position.y = 0.08;
  phoneGroup.add(screen);

  // 상단 스피커/카메라 노치 (앞쪽 방향 표시)
  const speaker = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.03, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0e1715 })
  );
  speaker.position.set(0, 0.09, -1.02);
  phoneGroup.add(speaker);

  // 전방 검 방향 표시 콘
  bladeGuideMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.55, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3 })
  );
  bladeGuideMesh.rotation.x = -Math.PI / 2;
  bladeGuideMesh.position.set(0, 0.08, -1.6);
  phoneGroup.add(bladeGuideMesh);

  // 측면 볼륨업 버튼 (S키 표시)
  volUpMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x7ee0b8 })
  );
  volUpMesh.position.set(-0.68, 0, -0.45);
  phoneGroup.add(volUpMesh);

  // 측면 강타 버튼 (D키 표시)
  smashMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xf28b66 })
  );
  smashMesh.position.set(-0.68, 0, 0.15);
  phoneGroup.add(smashMesh);

  scene.add(phoneGroup);

  window.addEventListener('resize', () => {
    if (!renderer || !camera || !canvas) return;
    const w = canvas.clientWidth || 520;
    const h = canvas.clientHeight || 340;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    updatePhoneModel();
  });

  updatePhoneModel();
}

function updatePhoneModel() {
  const q = eulerToQuaternion(state.rotX, state.rotY, state.rotZ);
  if (phoneGroup && renderer && scene && camera) {
    phoneGroup.quaternion.set(q.x, q.y, q.z, q.w);
    const thrust = Math.min(0.45, Math.max(-0.2, state.accel.x * 0.02));
    phoneGroup.position.set(0, 0, -thrust);
    if (volUpMesh?.material) {
      volUpMesh.material.color.setHex(state.button === 1 ? 0xffd166 : 0x7ee0b8);
    }
    if (smashMesh?.material) {
      smashMesh.material.color.setHex(state.button === 2 ? 0xff4d6d : 0xf28b66);
    }
    if (bladeGuideMesh?.material) {
      bladeGuideMesh.material.color.setHex(state.accel.x > 0.5 ? 0xff6b4a : 0xd9a441);
    }
    renderer.render(scene, camera);
    return;
  }

  // Three.js 미지원 환경용 2D 캔버스 폴백
  const canvas = $('phone-canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0e1715';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((state.rotZ * Math.PI) / 180);
  ctx.fillStyle = '#4fd1a5';
  ctx.fillRect(-45, -80, 90, 160);
  ctx.restore();
}

function isTypingInput(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target.type || 'text').toLowerCase();
    return type !== 'range' && type !== 'button' && type !== 'checkbox';
  }
  return false;
}

window.addEventListener('keydown', (event) => {
  if (isTypingInput(event.target)) return;

  const { code } = event;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(code)) {
    event.preventDefault();
  }

  pressedKeys.add(code);

  if (code === 'Space') {
    resetZeroPoint();
    return;
  }
  if (code === 'KeyS') {
    state.button = 1;
    syncControlsFromState();
    updatePhoneModel();
  } else if (code === 'KeyD') {
    state.button = 2;
    syncControlsFromState();
    updatePhoneModel();
  }
});

window.addEventListener('keyup', (event) => {
  const { code } = event;
  pressedKeys.delete(code);

  if (code === 'KeyS' || code === 'KeyD') {
    if (pressedKeys.has('KeyD')) state.button = 2;
    else if (pressedKeys.has('KeyS')) state.button = 1;
    else state.button = 0;
    syncControlsFromState();
    updatePhoneModel();
  }
});

window.addEventListener('blur', () => {
  pressedKeys.clear();
  state.button = 0;
  syncControlsFromState();
  updatePhoneModel();
});

// 60Hz 키보드 입력 반영 루프 (회전축 X/Y/Z 및 공격 가속도 A키 처리)
const ROT_STEP = 2.5;
setInterval(() => {
  let changed = false;

  // 방향키 상/하: X축 회전 (Pitch)
  if (pressedKeys.has('ArrowUp')) {
    state.rotX = wrapAngle(state.rotX + ROT_STEP);
    changed = true;
  }
  if (pressedKeys.has('ArrowDown')) {
    state.rotX = wrapAngle(state.rotX - ROT_STEP);
    changed = true;
  }

  // 방향키 좌/우: Shift와 함께 누르면 Z축(Roll), 기본은 Y축(Yaw) 회전
  const zMode = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight');
  if (pressedKeys.has('ArrowLeft')) {
    if (zMode) state.rotZ = wrapAngle(state.rotZ + ROT_STEP);
    else state.rotY = wrapAngle(state.rotY + ROT_STEP);
    changed = true;
  }
  if (pressedKeys.has('ArrowRight')) {
    if (zMode) state.rotZ = wrapAngle(state.rotZ - ROT_STEP);
    else state.rotY = wrapAngle(state.rotY - ROT_STEP);
    changed = true;
  }

  // Q / E 키로도 Z축(Roll) 회전 지원
  if (pressedKeys.has('KeyQ')) {
    state.rotZ = wrapAngle(state.rotZ + ROT_STEP);
    changed = true;
  }
  if (pressedKeys.has('KeyE')) {
    state.rotZ = wrapAngle(state.rotZ - ROT_STEP);
    changed = true;
  }

  // A키: 공격 동작 — 가속도 증가, 떼면 서서히 감쇠
  if (pressedKeys.has('KeyA')) {
    state.accel.x = Math.min(20, Number((state.accel.x + 1.8).toFixed(2)));
    state.accel.y = Number((state.accel.x * 0.35).toFixed(2));
    state.accel.z = Number((state.accel.x * 0.5).toFixed(2));
    changed = true;
  } else if (state.accel.x > 0 || state.accel.y !== 0 || state.accel.z !== 0) {
    state.accel.x = Math.max(0, Number((state.accel.x * 0.82).toFixed(2)));
    if (state.accel.x < 0.1) state.accel.x = 0;
    state.accel.y = Number((state.accel.x * 0.35).toFixed(2));
    state.accel.z = Number((state.accel.x * 0.5).toFixed(2));
    changed = true;
  }

  if (changed) {
    syncControlsFromState();
    updatePhoneModel();
  }
}, 1000 / 60);

// 슬라이더 및 버튼 UI 이벤트 바인딩
for (const [axisId, key] of [['rot-x', 'rotX'], ['rot-y', 'rotY'], ['rot-z', 'rotZ']]) {
  $(axisId)?.addEventListener('input', (e) => {
    state[key] = Number(e.target.value) || 0;
    syncControlsFromState();
    updatePhoneModel();
  });
}

$('motion')?.addEventListener('input', (e) => {
  state.accel.x = Number(e.target.value) || 0;
  state.accel.y = Number((state.accel.x * 0.35).toFixed(2));
  state.accel.z = Number((state.accel.x * 0.5).toFixed(2));
  syncControlsFromState();
  updatePhoneModel();
});

$('button')?.addEventListener('change', (e) => {
  state.button = Number(e.target.value) || 0;
  syncControlsFromState();
  updatePhoneModel();
});

$('zero-btn')?.addEventListener('click', () => {
  resetZeroPoint();
});

function leave() {
  session++;
  clearTimeout(timer);
  timer = null;
  started = false;
  paused = false;
  if ($('pause')) $('pause').textContent = '시험 송신 일시정지';
  const oldWs = ws, oldPc = pc, oldChannel = channel;
  ws = null; pc = null; channel = null; id = null; mode = null; pending = [];
  oldChannel?.close();
  oldPc?.close();
  if (oldWs && oldWs.readyState < 2) oldWs.close();
  if ($('join')) $('join').disabled = false;
  if ($('player')) $('player').textContent = '입장 전';
}

function sendInput(message) {
  const target = mode === 'relay' ? ws : channel;
  if (!target || (mode === 'relay' ? target.readyState !== WebSocket.OPEN : target.readyState !== 'open')) return false;
  if (target.bufferedAmount > 65536) return false;
  target.send(JSON.stringify(message));
  return true;
}

function stopSending() {
  clearTimeout(timer);
  timer = null;
  started = false;
}

function startSending() {
  if (started) return;
  const rate = Number($('rate').value);
  if (!Number.isFinite(rate) || rate < 1 || rate > 120) {
    status('송신 목표는 1~120으로 입력하세요.');
    return;
  }
  started = true;
  status(`게임 시작 · ${mode} · 송신 중`);
  const tick = 1000 / rate;
  let next = performance.now() + tick;
  const transmit = () => {
    if (!started) return;
    if (!paused) {
      const m = {
        type: 'SENSOR',
        sender_id: id,
        seq: seq++,
        timestamp: Date.now(),
        payload: buildPayload(),
      };
      if (sendInput(m)) sent++;
      else skipped++;
    }
    const now = performance.now();
    next += tick;
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
  event.preventDefault();
  leave();
  seq = sent = skipped = 0;
  $('join').disabled = true;
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
$('pause').onclick = () => {
  paused = !paused;
  $('pause').textContent = paused ? '시험 송신 재개' : '시험 송신 일시정지';
};
setInterval(() => {
  if ($('counts')) $('counts').textContent = `송신 ${sent} · 건너뜀 ${skipped} · 다음 순번 ${seq}`;
}, 1000);
window.addEventListener('pagehide', leave);

initPhone3D();
syncControlsFromState();
