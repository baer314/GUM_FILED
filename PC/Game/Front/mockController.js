import * as THREE from 'three';
import { HITBOX_CONFIG, ROT_Y_180, playerStates, appState } from './config.js';
import { p1Body, p2Body } from './scene.js';
import { swordP1, swordP2, triggerHitReaction } from './sword.js';
import { updateRender } from './front.js';

const phoneContainer = document.getElementById('phone-container');
const virtualPhone = document.getElementById('virtual-phone');
const phoneStateText = document.getElementById('phone-state-text');
const phonePTag = document.getElementById('phone-p-tag');
const activePTitle = document.getElementById('active-p-title');
const switchPlayerBtn = document.getElementById('switch-player-btn');
const calibNowBtn = document.getElementById('calib-now-btn');
const guardBtn = document.getElementById('guard-btn');
const chargeBtn = document.getElementById('charge-btn');
const valRoll = document.getElementById('val-roll');
const valPitch = document.getElementById('val-pitch');
const valStatus = document.getElementById('val-status');
const valSmash = document.getElementById('val-smash');

export const pressedKeys = {};

const phoneSensors = {
  "PLAYER_1": { roll: 0.0, pitch: -0.15, calibRoll: 0.0, calibPitch: 0.0, prevRoll: 0.0, prevPitch: 0.0, isDefending: false, isCharging: false, smashReady: false },
  "PLAYER_2": { roll: 0.0, pitch: -0.15, calibRoll: 0.0, calibPitch: 0.0, prevRoll: 0.0, prevPitch: 0.0, isDefending: false, isCharging: false, smashReady: false }
};

let isMouseDown = false;
let prevMouseX = 0;
let prevMouseY = 0;

// 영점 조절: 볼륨키가 정면(상대방)을 향한 현재 자세를 기준 영점으로 보정
export function calibrateZeroPoint(targetPlayerId = null) {
  const targets = targetPlayerId ? [targetPlayerId] : ["PLAYER_1", "PLAYER_2"];
  targets.forEach(pid => {
    const s = phoneSensors[pid];
    s.calibRoll = s.roll;
    s.calibPitch = s.pitch + 0.15;
    s.prevRoll = 0.0;
    s.prevPitch = -0.15;
  });
}

function updateSimButtonsUI() {
  const sensor = phoneSensors[appState.activePlayer];
  guardBtn.classList.toggle('active', sensor.isDefending);
  guardBtn.innerText = sensor.isDefending ? "방어 중 (DEFENSE)" : "방어 [D 홀드]";

  chargeBtn.classList.toggle('active', sensor.isCharging || sensor.smashReady);
  chargeBtn.innerText = sensor.smashReady ? "강타 준비완료!" : "강타충전 [S]";

  valSmash.innerText = sensor.smashReady ? "준비됨 [SMASH READY]" : "미충전";
  valSmash.style.color = sensor.smashReady ? "#f59e0b" : "#38bdf8";
}

export function switchPlayer() {
  appState.activePlayer = (appState.activePlayer === "PLAYER_1") ? "PLAYER_2" : "PLAYER_1";
  const isP1 = (appState.activePlayer === "PLAYER_1");
  activePTitle.innerText = isP1 ? "📱 P1 조작 중" : "📱 P2 조작 중";
  activePTitle.style.color = isP1 ? "#38bdf8" : "#f72585";
  phonePTag.innerText = isP1 ? "PLAYER 1" : "PLAYER 2";
  phonePTag.style.color = isP1 ? "#38bdf8" : "#f72585";
  updateSimButtonsUI();
}

export function setGuardState(enable) {
  const sensor = phoneSensors[appState.activePlayer];
  sensor.isDefending = enable;
  if (enable) {
    sensor.isCharging = false;
    sensor.smashReady = false;
  }
  updateSimButtonsUI();
}

export function triggerChargeAction(isHolding) {
  const sensor = phoneSensors[appState.activePlayer];
  const pState = playerStates[appState.activePlayer];
  if (pState.stunTimer > 0) return;

  if (isHolding) {
    sensor.isDefending = false;
    sensor.isCharging = true;
    sensor.smashReady = true;
  } else {
    sensor.isCharging = false;
  }
  updateSimButtonsUI();
}

export function initMockController() {
  switchPlayerBtn.addEventListener('click', switchPlayer);
  calibNowBtn.addEventListener('click', () => calibrateZeroPoint(appState.activePlayer));

  phoneContainer.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
    if (!pressedKeys['d'] && !pressedKeys['D']) setGuardState(false);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const deltaX = e.clientX - prevMouseX;
    const deltaY = e.clientY - prevMouseY;
    const sensor = phoneSensors[appState.activePlayer];

    sensor.roll -= deltaX * 0.018;
    sensor.pitch -= deltaY * 0.018;

    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  guardBtn.addEventListener('mousedown', () => setGuardState(true));
  chargeBtn.addEventListener('mousedown', () => triggerChargeAction(true));
  chargeBtn.addEventListener('mouseup', () => triggerChargeAction(false));
}

// 가상 스마트폰 3D 센서 연산 (단독 테스트 모드)
export function process3DController(delta) {
  if (appState.isExternalBackendConnected) return;

  ["PLAYER_1", "PLAYER_2"].forEach(pid => {
    if (playerStates[pid].stunTimer > 0) {
      playerStates[pid].stunTimer = Math.max(0, playerStates[pid].stunTimer - delta);
    }
    if (playerStates[pid].clashCooldown > 0) {
      playerStates[pid].clashCooldown = Math.max(0, playerStates[pid].clashCooldown - delta);
    }
  });

  const activeId = appState.activePlayer;
  const sensor = phoneSensors[activeId];
  const pState = playerStates[activeId];
  const isStunned = (pState.stunTimer > 0);
  const turnSpeed = 0.045;

  if (pressedKeys['ArrowLeft']) sensor.roll += turnSpeed;
  if (pressedKeys['ArrowRight']) sensor.roll -= turnSpeed;
  if (pressedKeys['ArrowUp']) sensor.pitch += turnSpeed;
  if (pressedKeys['ArrowDown']) sensor.pitch -= turnSpeed;

  const effRoll = Math.max(-2.5, Math.min(2.5, sensor.roll - sensor.calibRoll));
  const effPitch = Math.max(-1.5, Math.min(1.2, sensor.pitch - sensor.calibPitch));

  const angularSpeed = Math.sqrt(
    Math.pow(effRoll - sensor.prevRoll, 2) +
    Math.pow(effPitch - sensor.prevPitch, 2)
  );
  sensor.prevRoll = effRoll;
  sensor.prevPitch = effPitch;

  let status = "IDLE";
  if (isStunned) {
    sensor.isCharging = false;
    sensor.smashReady = false;
    status = sensor.isDefending ? "DEFENSE" : "STUN";
  } else if (sensor.isDefending) {
    status = "DEFENSE";
  } else if (angularSpeed > 0.012) {
    if (sensor.smashReady) {
      status = "SMASH";
      sensor.isCharging = false;
    } else {
      status = "ATTACK";
    }
  } else if (sensor.isCharging) {
    status = "CHARGE";
  }

  if (pState.status === "SMASH" && status === "IDLE") {
    sensor.smashReady = false;
  }
  updateSimButtonsUI();

  const degRoll = (effRoll * (180 / Math.PI)).toFixed(1);
  const degPitch = (effPitch * (180 / Math.PI)).toFixed(1);

  virtualPhone.style.transform = `rotateX(${-degPitch}deg) rotateZ(${-degRoll}deg) rotateY(-84deg)`;
  valRoll.innerText = `${degRoll}°`;
  valPitch.innerText = `${degPitch}°`;
  valStatus.innerText = status;
  phoneStateText.innerText = status;

  if (status === "STUN") phoneStateText.style.color = "#c084fc";
  else if (status === "SMASH") phoneStateText.style.color = "#ef4444";
  else if (status === "ATTACK" || status === "CHARGE") phoneStateText.style.color = "#f59e0b";
  else if (status === "DEFENSE") phoneStateText.style.color = "#38bdf8";
  else phoneStateText.style.color = "#22c55e";

  const isAttacking = (status === "ATTACK" || status === "SMASH");
  const swingForward = isAttacking ? 0.45 : (status === "DEFENSE" ? 0.15 : 0.0);
  const pitchForward = -Math.sin(effPitch) * 0.35;

  const localZ = 0.95 - (swingForward + pitchForward);
  const localX = 0.18 - Math.sin(effRoll) * 0.45;
  const localY = (status === "STUN") ? 0.65 : (0.95 + Math.sin(effPitch) * 0.35);

  const forwardTilt = (status === "STUN") ? -1.15 : (isAttacking ? -0.55 : 0);
  const guardAngle = (status === "DEFENSE") ? 1.4 : ((status === "STUN") ? 0.45 : 0);

  const localEuler = new THREE.Euler(effPitch + forwardTilt, 0, effRoll + guardAngle, 'YXZ');
  const localQuat = new THREE.Quaternion().setFromEuler(localEuler);

  let worldPos, worldQuat;
  if (activeId === "PLAYER_1") {
    worldPos = new THREE.Vector3(localX, localY, localZ);
    worldQuat = localQuat;
  } else {
    worldPos = new THREE.Vector3(-localX, localY, -localZ);
    worldQuat = ROT_Y_180.clone().multiply(localQuat);
  }

  updateRender(activeId, status, pState.hp, {
    position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    quaternion: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }
  }, true);
}

// 3D 피격 박스 판별
function isInsideOpponentHitbox(tipPos, isAttackerP1) {
  const withinX = Math.abs(tipPos.x) <= HITBOX_CONFIG.halfWidthX;
  const withinY = tipPos.y >= HITBOX_CONFIG.minY && tipPos.y <= HITBOX_CONFIG.maxY;
  const reachedZ = isAttackerP1
    ? (tipPos.z <= -HITBOX_CONFIG.strikeDepthZ)
    : (tipPos.z >= HITBOX_CONFIG.strikeDepthZ);

  return withinX && withinY && reachedZ;
}

// 단독 테스트용 로컬 전투 판정 (외부 Back 연동 시 자동 생략)
export function checkLocalSimCombat(tip1, tip2, delta) {
  if (appState.isExternalBackendConnected) return;

  const p1 = playerStates["PLAYER_1"];
  const p2 = playerStates["PLAYER_2"];

  if (p1.hitCooldown > 0) p1.hitCooldown -= delta;
  if (p2.hitCooldown > 0) p2.hitCooldown -= delta;

  const p1NormalAtk = (p1.status === "ATTACK");
  const p2NormalAtk = (p2.status === "ATTACK");
  const p1Smash = (p1.status === "SMASH");
  const p2Smash = (p2.status === "SMASH");
  const p1Def = (p1.status === "DEFENSE");
  const p2Def = (p2.status === "DEFENSE");

  const p1Clashed = p1NormalAtk && p2Def && tip1 && (tip1.z <= HITBOX_CONFIG.clashDepthZ) && (Math.abs(tip1.x) <= HITBOX_CONFIG.halfWidthX + 0.15);
  const p2Clashed = p2NormalAtk && p1Def && tip2 && (tip2.z >= -HITBOX_CONFIG.clashDepthZ) && (Math.abs(tip2.x) <= HITBOX_CONFIG.halfWidthX + 0.15);
  const isNormalClash = p1Clashed || p2Clashed;

  swordP1.guardSpark.visible = isNormalClash;
  swordP2.guardSpark.visible = isNormalClash;

  if (isNormalClash) {
    const midPoint = new THREE.Vector3().addVectors(tip1, tip2).multiplyScalar(0.5);
    swordP1.guardSpark.position.copy(midPoint);
    swordP2.guardSpark.position.copy(midPoint);

    if (p1Clashed && p1.clashCooldown <= 0) {
      p1.stunTimer = 1.5;
      p1.clashCooldown = 0.6;
      updateRender("PLAYER_1", "STUN", p1.hp, null, true);
    }
    if (p2Clashed && p2.clashCooldown <= 0) {
      p2.stunTimer = 1.5;
      p2.clashCooldown = 0.6;
      updateRender("PLAYER_2", "STUN", p2.hp, null, true);
    }
    return;
  }

  const p1CanHit = (p1NormalAtk && !p2Def) || p1Smash;
  if (p1CanHit && p2.hitCooldown <= 0 && tip1 && isInsideOpponentHitbox(tip1, true)) {
    const nextHp = Math.max(0, p2.hp - 1);
    const hitPos = new THREE.Vector3(tip1.x, THREE.MathUtils.clamp(tip1.y, 0.7, 1.4), p2Body.group.position.z + 0.32);
    phoneSensors["PLAYER_1"].smashReady = false;
    updateRender("PLAYER_2", p2.status, nextHp, null, true);
    triggerHitReaction("PLAYER_2", hitPos, p1Smash);
  }

  const p2CanHit = (p2NormalAtk && !p1Def) || p2Smash;
  if (p2CanHit && p1.hitCooldown <= 0 && tip2 && isInsideOpponentHitbox(tip2, false)) {
    const nextHp = Math.max(0, p1.hp - 1);
    const hitPos = new THREE.Vector3(tip2.x, THREE.MathUtils.clamp(tip2.y, 0.7, 1.4), p1Body.group.position.z - 0.32);
    phoneSensors["PLAYER_2"].smashReady = false;
    updateRender("PLAYER_1", p1.status, nextHp, null, true);
    triggerHitReaction("PLAYER_1", hitPos, p2Smash);
  }
}
