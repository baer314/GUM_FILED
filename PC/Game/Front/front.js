import { playerStates, appState } from './config.js';
import { triggerHitReaction } from './sword.js';

const lobbyUI = document.getElementById('lobby-container');
const calibrationUI = document.getElementById('calibration-screen');
const gameHudUI = document.getElementById('game-hud');
const splitDivider = document.getElementById('split-divider');
const pinDisplay = document.getElementById('pin-code');
const qrDisplay = document.getElementById('qr-display');
const qrUrlText = document.getElementById('qr-url-text');
const p1Card = document.getElementById('p1-card');
const p2Card = document.getElementById('p2-card');
const p1HpBar = document.getElementById('p1-hp');
const p2HpBar = document.getElementById('p2-hp');
const phonePanel = document.getElementById('phone-panel');

/**
 * qr_data 문자열을 실제 스캔 가능한 QR 코드 이미지로 렌더링
 */
export function renderQRCode(qrDataString) {
  if (!qrDisplay || !qrDataString) return;
  const textVal = String(qrDataString);
  qrDisplay.innerHTML = "";
  if (qrUrlText) qrUrlText.innerText = textVal;

  if (typeof window.QRCode !== "undefined") {
    new window.QRCode(qrDisplay, {
      text: textVal,
      width: 140,
      height: 140,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    qrDisplay.innerText = textVal;
  }
}

// 초기 대기 화면 기본 QR 코드 표시
renderQRCode("http://localhost:8080/controller?pin=A1B2C3");

/**
 * [입·출력 규격서 1~3단계] Net / Back -> Front 화면 전환 및 대기방 정보 출력
 */
export function handleUICommand(command, data = {}) {
  switch (command) {
    case "SHOW_WAITING_ROOM":
      lobbyUI.style.display = "flex";
      calibrationUI.style.display = "none";
      gameHudUI.style.display = "none";
      splitDivider.style.display = "none";
      if (data.room_pin) pinDisplay.innerText = data.room_pin;
      if (data.qr_data) renderQRCode(data.qr_data);
      break;

    case "UPDATE_PLAYER_READY":
      if (data.connected_id === "PLAYER_1") p1Card.innerText = "Player 1: 준비 완료 (READY)";
      if (data.connected_id === "PLAYER_2") p2Card.innerText = "Player 2: 준비 완료 (READY)";
      break;

    case "SHOW_CALIBRATION_UI":
      lobbyUI.style.display = "none";
      calibrationUI.style.display = "flex";
      gameHudUI.style.display = "none";
      splitDivider.style.display = "none";
      break;

    case "START_MAIN_GAME":
      lobbyUI.style.display = "none";
      calibrationUI.style.display = "none";
      gameHudUI.style.display = "flex";
      splitDivider.style.display = "block";
      break;
  }
}

/**
 * [입·출력 규격서 4단계 26번] Back -> Front 실시간 상태 및 3D 검 좌표 갱신
 * @param {string} target_id - "PLAYER_1" | "PLAYER_2"
 * @param {string} status - "IDLE" | "ATTACK" | "DEFENSE" | "CHARGE" | "SMASH" | "STUN"
 * @param {number} hp - 현재 체력 (0 ~ 5)
 * @param {object} sword_transform - { position: {x, y, z}, quaternion: {x, y, z, w} }
 */
export function updateRender(target_id, status, hp, sword_transform, _isInternalSim = false) {
  // 실제 외부 Back 모듈에서 호출이 들어오면 단독 테스트 시뮬레이터 자동 비활성화
  if (!_isInternalSim && !appState.isExternalBackendConnected) {
    appState.isExternalBackendConnected = true;
    if (phonePanel) phonePanel.style.display = "none";
  }

  const p = playerStates[target_id];
  if (!p) return;

  // 체력이 감소한 경우 피격 넉백 및 화면 플래시 자동 실행
  if (typeof hp === 'number' && hp < p.hp) {
    triggerHitReaction(target_id);
  }

  p.status = status;
  if (typeof hp === 'number') p.hp = hp;

  const hpEl = (target_id === "PLAYER_1") ? p1HpBar : p2HpBar;
  if (hpEl) {
    hpEl.classList.toggle('status-stun', status === "STUN");
    if (target_id === "PLAYER_1") {
      hpEl.innerText = `◀ [P1 시점] HP: ${p.hp} / 5 [${status}]`;
    } else {
      hpEl.innerText = `[P2 시점] HP: ${p.hp} / 5 [${status}] ▶`;
    }
  }

  if (sword_transform && sword_transform.position) {
    p.targetPos.set(
      sword_transform.position.x,
      sword_transform.position.y,
      sword_transform.position.z
    );
  }
  if (sword_transform && sword_transform.quaternion) {
    p.targetQuat.set(
      sword_transform.quaternion.x,
      sword_transform.quaternion.y,
      sword_transform.quaternion.z,
      sword_transform.quaternion.w
    );
  }
}

// 외부 모듈(Back / Net)에서 접근할 수 있도록 전역 객체에 노출
window.front = {
  handleUICommand,
  updateRender,
  onStartButtonClick: null
};
window.handleUICommand = handleUICommand;
window.updateRender = updateRender;
