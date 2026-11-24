import * as THREE from 'three';

/**
 * [피격 판정 박스 기준 상수] - Back 팀원 공유용 실측 좌표
 * 3D 캐릭터 메쉬(머리 반경 0.3, 몸통 반경 0.32, 중심 X=0, Y=0.5~1.65)에 맞춘 유효 피격 범위
 */
export const HITBOX_CONFIG = {
  halfWidthX: 0.34,    // 좌우 유효 폭 (-0.34 ~ +0.34)
  minY: 0.48,          // 하단 유효 높이 (하체 기준)
  maxY: 1.68,          // 상단 유효 높이 (머리 정수리 기준)
  strikeDepthZ: 0.05,  // 중앙 대치선(Z=0)을 넘어 상대 쪽으로 베어 들어가야 하는 깊이
  clashDepthZ: 0.05    // 방어 가드와 검이 맞부딪히는 유효 깊이
};

// Player 2 월드 공간 180도 회전 쿼터니언
export const ROT_Y_180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// 양 플레이어 실시간 상태 저장소
export const playerStates = {
  "PLAYER_1": {
    pos: new THREE.Vector3(0.18, 0.95, 0.95),
    targetPos: new THREE.Vector3(0.18, 0.95, 0.95),
    quat: new THREE.Quaternion(),
    targetQuat: new THREE.Quaternion(),
    hp: 5,
    status: "IDLE",
    hitCooldown: 0,
    stunTimer: 0,
    clashCooldown: 0
  },
  "PLAYER_2": {
    pos: new THREE.Vector3(-0.18, 0.95, -0.95),
    targetPos: new THREE.Vector3(-0.18, 0.95, -0.95),
    quat: ROT_Y_180.clone(),
    targetQuat: ROT_Y_180.clone(),
    hp: 5,
    status: "IDLE",
    hitCooldown: 0,
    stunTimer: 0,
    clashCooldown: 0
  }
};

// 전역 제어 플래그
export const appState = {
  activePlayer: "PLAYER_1",
  isExternalBackendConnected: false
};
