import * as THREE from 'three';
import { playerStates, appState } from './config.js';
import { p1Body, p2Body, updateCharacterVisual, renderSplitView } from './scene.js';
import { swordP1, swordP2, updateSwordVisual } from './sword.js';
import { handleUICommand } from './front.js';
import {
  initMockController,
  calibrateZeroPoint,
  switchPlayer,
  setGuardState,
  triggerChargeAction,
  process3DController,
  checkLocalSimCombat,
  pressedKeys
} from './mockController.js';

const startBtn = document.getElementById('start-btn');
const joinSimBtn = document.getElementById('join-sim-btn');
const calibConfirmBtn = document.getElementById('calib-confirm-btn');

// 가상 컨트롤러 이벤트 바인딩
initMockController();

// 대기실 & 영점 조절 버튼 이벤트
joinSimBtn.addEventListener('click', () => {
  handleUICommand("UPDATE_PLAYER_READY", { connected_id: "PLAYER_1" });
  handleUICommand("UPDATE_PLAYER_READY", { connected_id: "PLAYER_2" });
});

startBtn.addEventListener('click', () => {
  if (typeof window.front.onStartButtonClick === 'function') {
    window.front.onStartButtonClick();
  } else {
    handleUICommand("SHOW_CALIBRATION_UI");
  }
});

calibConfirmBtn.addEventListener('click', () => {
  calibrateZeroPoint();
  handleUICommand("START_MAIN_GAME");
});

// 키보드 단축키 이벤트
window.addEventListener('keydown', (e) => {
  pressedKeys[e.key] = true;

  if (e.key === 'Tab') {
    e.preventDefault();
    switchPlayer();
  }

  if (e.key === 'r' || e.key === 'R') calibrateZeroPoint(appState.activePlayer);
  if (e.key === 'd' || e.key === 'D') setGuardState(true);
  if (e.key === 's' || e.key === 'S') triggerChargeAction(true);

  if (e.key === '1') {
    handleUICommand("SHOW_WAITING_ROOM", {
      room_pin: "A1B2C3",
      qr_data: "http://localhost:8080/controller?pin=A1B2C3"
    });
  }
  if (e.key === '2') {
    handleUICommand("UPDATE_PLAYER_READY", { connected_id: "PLAYER_1" });
    handleUICommand("UPDATE_PLAYER_READY", { connected_id: "PLAYER_2" });
  }
  if (e.key === '3') handleUICommand("SHOW_CALIBRATION_UI");
  if (e.key === '4') {
    calibrateZeroPoint();
    handleUICommand("START_MAIN_GAME");
  }
});

window.addEventListener('keyup', (e) => {
  pressedKeys[e.key] = false;
  if (e.key === 'd' || e.key === 'D') setGuardState(false);
  if (e.key === 's' || e.key === 'S') triggerChargeAction(false);
});

// 메인 애니메이션 & 렌더링 루프
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsedTime = clock.elapsedTime;

  process3DController(delta);

  const p1 = playerStates["PLAYER_1"];
  const p2 = playerStates["PLAYER_2"];

  const tip1 = updateSwordVisual(swordP1, p1, delta, elapsedTime);
  const tip2 = updateSwordVisual(swordP2, p2, delta, elapsedTime);

  updateCharacterVisual(p1Body, p1, delta, elapsedTime, true);
  updateCharacterVisual(p2Body, p2, delta, elapsedTime, false);

  checkLocalSimCombat(tip1, tip2, delta);

  renderSplitView();
}

animate();
