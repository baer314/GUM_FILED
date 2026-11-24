import * as THREE from 'three';
import { scene, p1Body, p2Body } from './scene.js';
import { playerStates } from './config.js';

const p1HitFlash = document.getElementById('p1-hit-flash');
const p2HitFlash = document.getElementById('p2-hit-flash');
const p1HpBar = document.getElementById('p1-hp');
const p2HpBar = document.getElementById('p2-hp');

// 1. 3D 검 메쉬 및 상태별 이펙트 생성
function createRiggedSword(handleColor) {
  const pivot = new THREE.Group();

  const handleMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.2 })
  );
  pivot.add(handleMarker);

  const bladeLength = 0.85;
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    metalness: 0.85,
    roughness: 0.2,
    emissive: 0x000000
  });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, bladeLength, 0.02), bladeMat);
  blade.position.y = bladeLength / 2;
  pivot.add(blade);

  const tipMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xff3333 })
  );
  tipMarker.position.y = bladeLength;
  pivot.add(tipMarker);

  // 강타 충전(CHARGE) 회전 에너지 링 & 구체 오라
  const chargeGroup = new THREE.Group();
  chargeGroup.position.y = bladeLength * 0.5;
  const chargeSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.65 })
  );
  const chargeRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.02, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffbf69 })
  );
  chargeRing.rotation.x = Math.PI / 2;
  chargeGroup.add(chargeSphere);
  chargeGroup.add(chargeRing);
  chargeGroup.visible = false;
  pivot.add(chargeGroup);

  // 방어 스파크
  const guardSpark = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshBasicMaterial({ color: 0xffea00 })
  );
  guardSpark.visible = false;
  scene.add(guardSpark);

  // 피격 슬래시 버스트
  const hitVFXGroup = new THREE.Group();
  const hitSlashPlane1 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.65, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xff3838, side: THREE.DoubleSide })
  );
  const hitSlashPlane2 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.65, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  hitSlashPlane1.rotation.z = Math.PI / 4;
  hitSlashPlane2.rotation.z = -Math.PI / 4;
  hitVFXGroup.add(hitSlashPlane1);
  hitVFXGroup.add(hitSlashPlane2);
  hitVFXGroup.visible = false;
  scene.add(hitVFXGroup);

  // 검기 잔상 (Trail Ribbon)
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0x4cc9f0,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  const trailGeo = new THREE.BufferGeometry();
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  scene.add(trailMesh);

  scene.add(pivot);
  return {
    pivot,
    bladeMat,
    bladeLength,
    chargeGroup,
    guardSpark,
    hitVFXGroup,
    hitVFXTimer: 0,
    trailMesh,
    trailMat,
    trailGeo,
    trailHistory: []
  };
}

export const swordP1 = createRiggedSword(0x38bdf8);
export const swordP2 = createRiggedSword(0xf72585);

// 2. 피격 리액션 트리거 (넉백, 플래시, 슬래시 버스트)
export function triggerHitReaction(victimId, hitWorldPos, isSmashHit = false) {
  const victim = (victimId === "PLAYER_1") ? p1Body : p2Body;
  const victimState = playerStates[victimId];
  const swordVFX = (victimId === "PLAYER_1") ? swordP2 : swordP1;
  const flashEl = (victimId === "PLAYER_1") ? p1HitFlash : p2HitFlash;
  const hpEl = (victimId === "PLAYER_1") ? p1HpBar : p2HpBar;

  if (hpEl) hpEl.classList.add('hp-hit');
  if (flashEl) flashEl.classList.add('active');
  setTimeout(() => {
    if (hpEl) hpEl.classList.remove('hp-hit');
    if (flashEl) flashEl.classList.remove('active');
  }, isSmashHit ? 350 : 250);

  victim.recoilZ = isSmashHit ? 0.65 : 0.45;
  victim.recoilAngle = isSmashHit ? 0.5 : 0.35;
  victim.flashTimer = isSmashHit ? 0.32 : 0.22;

  const hitPos = hitWorldPos || new THREE.Vector3(
    victim.group.position.x,
    1.0,
    victim.group.position.z + (victimId === "PLAYER_1" ? -0.3 : 0.3)
  );
  swordVFX.hitVFXGroup.position.copy(hitPos);
  const scaleVal = isSmashHit ? 1.6 : 1.0;
  swordVFX.hitVFXGroup.scale.set(scaleVal, scaleVal, scaleVal);
  swordVFX.hitVFXGroup.visible = true;
  swordVFX.hitVFXTimer = 0.28;

  victimState.hitCooldown = 0.8;
}

// 3. 매 프레임 검 보간(Lerp/Slerp) 및 이펙트 갱신
export function updateSwordVisual(swordObj, pState, delta, elapsedTime) {
  pState.pos.lerp(pState.targetPos, 0.28);
  pState.quat.slerp(pState.targetQuat, 0.28);

  swordObj.pivot.position.copy(pState.pos);
  swordObj.pivot.quaternion.copy(pState.quat);

  const st = pState.status;
  const isAttacking = (st === "ATTACK" || st === "SMASH");
  const isSmash = (st === "SMASH");
  const isCharge = (st === "CHARGE");
  const isStun = (st === "STUN");

  swordObj.chargeGroup.visible = isCharge;
  if (isCharge) {
    swordObj.chargeGroup.rotation.y += delta * 6.0;
    const pulse = 1.0 + Math.sin(elapsedTime * 15) * 0.2;
    swordObj.chargeGroup.scale.set(pulse, pulse, pulse);
    swordObj.bladeMat.emissive.setHex(0xff8800);
  } else if (isSmash) {
    swordObj.bladeMat.emissive.setHex(0xff2222);
  } else if (isStun) {
    swordObj.bladeMat.emissive.setHex(0x7e22ce);
  } else {
    swordObj.bladeMat.emissive.setHex(0x000000);
  }

  swordObj.trailMat.color.setHex(isSmash ? 0xff3b00 : 0x4cc9f0);

  const tipOffset = new THREE.Vector3(0, swordObj.bladeLength, 0);
  tipOffset.applyQuaternion(pState.quat);
  const currentTipPos = new THREE.Vector3().addVectors(pState.pos, tipOffset);

  if (isAttacking) {
    swordObj.trailHistory.push({
      tip: currentTipPos.clone(),
      handle: pState.pos.clone()
    });
    if (swordObj.trailHistory.length > (isSmash ? 11 : 8)) swordObj.trailHistory.shift();
  } else {
    if (swordObj.trailHistory.length > 0) swordObj.trailHistory.shift();
  }

  if (swordObj.trailHistory.length >= 2) {
    const positions = [];
    for (let i = 0; i < swordObj.trailHistory.length - 1; i++) {
      const p1 = swordObj.trailHistory[i];
      const p2 = swordObj.trailHistory[i + 1];

      positions.push(p1.handle.x, p1.handle.y, p1.handle.z);
      positions.push(p1.tip.x, p1.tip.y, p1.tip.z);
      positions.push(p2.tip.x, p2.tip.y, p2.tip.z);

      positions.push(p1.handle.x, p1.handle.y, p1.handle.z);
      positions.push(p2.tip.x, p2.tip.y, p2.tip.z);
      positions.push(p2.handle.x, p2.handle.y, p2.handle.z);
    }
    swordObj.trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    swordObj.trailGeo.computeVertexNormals();
    swordObj.trailMesh.visible = true;
  } else {
    swordObj.trailMesh.visible = false;
  }

  if (swordObj.hitVFXTimer > 0) {
    swordObj.hitVFXTimer -= delta;
    swordObj.hitVFXGroup.scale.multiplyScalar(1.08);
    if (swordObj.hitVFXTimer <= 0) swordObj.hitVFXGroup.visible = false;
  }

  return currentTipPos;
}
