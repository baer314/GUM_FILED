'use strict';
(function (root) {
  const TICK_RATE = 60;
  const TICK_INTERVAL_MS = 1000 / TICK_RATE;

  let active = false;
  let timerId = null;
  let currentPlayers = [];
  let currentRates = new Map();

  const sensorBuffer = new Map();
  const previousPayloads = new Map();
  const lastReadPackets = new Map();

  // 플레이어 상태 상수 (추후 새로운 상태 추가 가능)
  const PLAYER_STATE = {
    IDLE: 'IDLE',                 // 기본상태 (준비상태)
    ATTACK: 'ATTACK',             // 기본공격
    DEFENSE: 'DEFENSE',           // 방어
    STUN_DEFENSE: 'STUN_DEFENSE', // 기절+방어 (기절 중 방어키 입력 시, 남은 기절시간 유지)
    STUN: 'STUN',                 // 기절
    HIT: 'HIT',                   // 피격
    // TODO: 필요 시 추가 상태 정의
  };

  // 상태 위계(우선순위) 정의:
  // 기본(0) < 공격(10) = 방어(10) < 기절방어(20) = 기절(20) < 피격(30)
  // 같거나 상위(>=)인 상태는 현재 상태를 덮어씌울 수 있으며, 추후 중간/상위 상태 추가를 고려해 10 단위로 설정
  const STATE_PRIORITY = {
    [PLAYER_STATE.IDLE]: 0,
    [PLAYER_STATE.ATTACK]: 10,
    [PLAYER_STATE.DEFENSE]: 10,
    [PLAYER_STATE.STUN_DEFENSE]: 20,
    [PLAYER_STATE.STUN]: 20,
    [PLAYER_STATE.HIT]: 30,
  };

  function getStatePriority(state) {
    return STATE_PRIORITY[state] ?? 0;
  }

  // 새 상태(newState)가 현재 상태(currentState)와 위계가 같거나 상위인지 판정
  function canOverrideState(currentState, newState) {
    return getStatePriority(newState) >= getStatePriority(currentState);
  }

  // 추후 새로운 상태를 동적으로 등록할 때 사용할 헬퍼 함수
  function registerPlayerState(stateName, priority, defaultDuration = 0) {
    PLAYER_STATE[stateName] = stateName;
    STATE_PRIORITY[stateName] = Number(priority) || 0;
    if (defaultDuration > 0) {
      STATE_DURATION[stateName] = Number(defaultDuration);
    }
    return stateName;
  }

  // 판정별 상태이상 유지시간 (단위: 초) - 인게임에서 숫자 '0' 키를 눌러 실시간 조절 가능
  const JUDGMENT_DURATION = {
    ATTACK: 0.5,             // 공격 판정 발생 시: 기본공격(ATTACK) 유지시간
    ATTACK_SUCCESS_HIT: 1.0, // 공격 성공 시: 상대 피격(HIT) 유지시간
    ATTACK_FAIL_STUN: 1.0,   // 공격 실패 시: 본인 기절(STUN) 유지시간
    PARRY_STUN: 1.0,         // 패리 시: 양쪽 모두 기절(STUN) 유지시간
  };

  // 상태별 기본 유지시간 (단위: 초)
  const STATE_DURATION = {
    [PLAYER_STATE.ATTACK]: 0.5, // 기본공격 상태 0.5초
    [PLAYER_STATE.HIT]: 1.0,    // 피격 상태 1초
    [PLAYER_STATE.STUN]: 1.0,   // 기절 상태 1초
  };

  // 판정별/상태별 유지시간 설정 변경 함수
  function setJudgmentDurations(updates = {}) {
    if (Number.isFinite(Number(updates.ATTACK)) && Number(updates.ATTACK) >= 0) {
      JUDGMENT_DURATION.ATTACK = Number(updates.ATTACK);
      STATE_DURATION[PLAYER_STATE.ATTACK] = JUDGMENT_DURATION.ATTACK;
    }
    if (Number.isFinite(Number(updates.ATTACK_SUCCESS_HIT)) && Number(updates.ATTACK_SUCCESS_HIT) >= 0) {
      JUDGMENT_DURATION.ATTACK_SUCCESS_HIT = Number(updates.ATTACK_SUCCESS_HIT);
      STATE_DURATION[PLAYER_STATE.HIT] = JUDGMENT_DURATION.ATTACK_SUCCESS_HIT;
    }
    if (Number.isFinite(Number(updates.ATTACK_FAIL_STUN)) && Number(updates.ATTACK_FAIL_STUN) >= 0) {
      JUDGMENT_DURATION.ATTACK_FAIL_STUN = Number(updates.ATTACK_FAIL_STUN);
      STATE_DURATION[PLAYER_STATE.STUN] = JUDGMENT_DURATION.ATTACK_FAIL_STUN;
    }
    if (Number.isFinite(Number(updates.PARRY_STUN)) && Number(updates.PARRY_STUN) >= 0) {
      JUDGMENT_DURATION.PARRY_STUN = Number(updates.PARRY_STUN);
    }
    if (Number.isFinite(Number(updates.HIT)) && Number(updates.HIT) >= 0) {
      STATE_DURATION[PLAYER_STATE.HIT] = Number(updates.HIT);
      JUDGMENT_DURATION.ATTACK_SUCCESS_HIT = Number(updates.HIT);
    }
    if (Number.isFinite(Number(updates.STUN)) && Number(updates.STUN) >= 0) {
      STATE_DURATION[PLAYER_STATE.STUN] = Number(updates.STUN);
      JUDGMENT_DURATION.ATTACK_FAIL_STUN = Number(updates.STUN);
      if (updates.PARRY_STUN === undefined) {
        JUDGMENT_DURATION.PARRY_STUN = Number(updates.STUN);
      }
    }
    return { ...JUDGMENT_DURATION };
  }

  // 각속도(xyz) 기반 기본공격 판정 기준값 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  const ATTACK_ANGULAR_THRESHOLD = {
    x: 5.0,
    y: 5.0,
    z: 5.0,
  };

  function setAttackAngularThreshold(updates = {}) {
    for (const axis of ['x', 'y', 'z']) {
      const val = Number(updates[axis]);
      if (Number.isFinite(val) && val >= 0) {
        ATTACK_ANGULAR_THRESHOLD[axis] = val;
      }
    }
    return { ...ATTACK_ANGULAR_THRESHOLD };
  }

  function getAttackAngularThreshold() {
    return { ...ATTACK_ANGULAR_THRESHOLD };
  }

  // 플레이어 정보에 저장되는 이전 쿼터니언(prevTilt)과 현재 쿼터니언(currentTilt)으로부터 각속도(xyz, rad/s) 계산
  function computeAngularVelocity(prevTilt, currentTilt, dt = 1 / TICK_RATE) {
    if (!prevTilt || !currentTilt || dt <= 0) {
      return { x: 0, y: 0, z: 0 };
    }
    const p = normalizeQuaternion(prevTilt);
    let c = normalizeQuaternion(currentTilt);

    // q와 -q 부호 반전으로 인한 각속도 튐 방지 (내적 < 0 이면 같은 반구로 부호 정렬)
    const dot = p.x * c.x + p.y * c.y + p.z * c.z + p.w * c.w;
    if (dot < 0) {
      c = { x: -c.x, y: -c.y, z: -c.z, w: -c.w };
    }

    // 상대 회전 쿼터니언 deltaQ = inverse(prevTilt) * currentTilt
    const invPrev = { x: -p.x, y: -p.y, z: -p.z, w: p.w };
    const dx = invPrev.w * c.x + invPrev.x * c.w + invPrev.y * c.z - invPrev.z * c.y;
    const dy = invPrev.w * c.y - invPrev.x * c.z + invPrev.y * c.w + invPrev.z * c.x;
    const dz = invPrev.w * c.z + invPrev.x * c.y - invPrev.y * c.x + invPrev.z * c.w;
    const dw = Math.min(1, Math.max(-1, invPrev.w * c.w - invPrev.x * c.x - invPrev.y * c.y - invPrev.z * c.z));

    const sinHalfTheta = Math.hypot(dx, dy, dz);
    let scale = 2 / dt;
    if (sinHalfTheta > 1e-6) {
      const theta = 2 * Math.atan2(sinHalfTheta, dw);
      scale = theta / (sinHalfTheta * dt);
    }

    return {
      x: Number((dx * scale).toFixed(2)) || 0,
      y: Number((dy * scale).toFixed(2)) || 0,
      z: Number((dz * scale).toFixed(2)) || 0,
    };
  }

  // 기울기 값에 따라 팔이 움직이는 배수 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let armSwingMultiplier = 0.55;

  function setArmSwingMultiplier(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      armSwingMultiplier = num;
      for (const player of Object.values(playerData)) {
        player.armSwingMultiplier = armSwingMultiplier;
      }
    }
    return armSwingMultiplier;
  }

  // 공격 판정(ATTACK) 시 팔 길이가 늘어나는 정도 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let attackArmExtension = 0.65;

  function setAttackArmExtension(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      attackArmExtension = num;
      for (const player of Object.values(playerData)) {
        player.attackArmExtension = attackArmExtension;
      }
      root.InGameFront?.setAttackArmExtension?.(attackArmExtension);
    }
    return attackArmExtension;
  }

  function getAttackArmExtension() {
    return attackArmExtension;
  }

  // 방어(DEFENSE) 시 팔 길이는 유지한 채 검이 검 손잡이 방향(+Z)으로 이동하는 거리 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let defenseSwordOffset = 1.2;

  function setDefenseSwordOffset(value) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      defenseSwordOffset = num;
      for (const player of Object.values(playerData)) {
        player.defenseSwordOffset = defenseSwordOffset;
      }
      root.InGameFront?.setDefenseSwordOffset?.(defenseSwordOffset);
    }
    return defenseSwordOffset;
  }

  function getDefenseSwordOffset() {
    return defenseSwordOffset;
  }

  // 방어 판정 시 정면으로 내린 두 검 선분이 이루는 최대 허용 각도 (단위: 도, 0~90, 개발자 패널에서 조절 가능)
  let defenseAngleThreshold = 35;

  function setDefenseAngleThreshold(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0 && num <= 180) {
      defenseAngleThreshold = num;
    }
    return defenseAngleThreshold;
  }

  function getDefenseAngleThreshold() {
    return defenseAngleThreshold;
  }

  // 방어 판정 시 방어자의 정면 투영 검 선분 최소 길이 (검끝을 중앙으로 향하면 선분이 짧아져 방어 불가, 개발자 패널에서 조절 가능)
  let defenseMinSegmentLength = 1.0;

  function setDefenseMinSegmentLength(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      defenseMinSegmentLength = num;
    }
    return defenseMinSegmentLength;
  }

  function getDefenseMinSegmentLength() {
    return defenseMinSegmentLength;
  }

  // 기절(STUN) 시 중앙에 생성되는 검 진입 금지 원의 반지름 (기절+방어 시에는 미적용, 개발자 패널에서 실시간 조절 가능)
  let stunCircleRadius = 0.55;

  function setStunCircleRadius(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      stunCircleRadius = num;
      for (const player of Object.values(playerData)) {
        player.stunCircleRadius = stunCircleRadius;
      }
      root.InGameFront?.setStunCircleRadius?.(stunCircleRadius);
    }
    return stunCircleRadius;
  }

  function getStunCircleRadius() {
    return stunCircleRadius;
  }

  // 두 플레이어 간의 간격 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let playerDistance = 3.0;

  function setPlayerDistance(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      playerDistance = num;
      root.InGameFront?.setPlayerDistance?.(playerDistance);
    }
    return playerDistance;
  }

  function getPlayerDistance() {
    return playerDistance;
  }

  // 본인 화면에서 보이는 본인 머리의 불투명도 (0.0 ~ 1.0, 인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let selfHeadOpacity = 0.35;

  function setSelfHeadOpacity(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0 && num <= 1) {
      selfHeadOpacity = num;
      root.InGameFront?.setSelfHeadOpacity?.(selfHeadOpacity);
    }
    return selfHeadOpacity;
  }

  function getSelfHeadOpacity() {
    return selfHeadOpacity;
  }

  // 물리 팔 모델의 불투명도 (0.0 ~ 1.0, 인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let armOpacity = 1.0;

  function setArmOpacity(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0 && num <= 1) {
      armOpacity = num;
      root.InGameFront?.setArmOpacity?.(armOpacity);
    }
    return armOpacity;
  }

  function getArmOpacity() {
    return armOpacity;
  }

  // 어깨 기준 머리 앞뒤 위치 오프셋 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  let headOffsetZ = 0.0;

  function setHeadOffsetZ(value) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      headOffsetZ = num;
      root.InGameFront?.setHeadOffsetZ?.(headOffsetZ);
    }
    return headOffsetZ;
  }

  function getHeadOffsetZ() {
    return headOffsetZ;
  }

  // 머리 직육면체 히트박스 각 모서리 길이 (기본값: 반지름 0.44인 머리 구에 접하도록 0.88 x 0.88 x 0.88)
  // x: 좌우 가로 너비, y: 정수리 기준 아래쪽 세로 길이, yUp: 정수리 기준 위쪽 추가 길이, z: 앞뒤 깊이
  const headHitboxSize = {
    x: 0.88,
    y: 0.88,
    yUp: 0.0,
    z: 0.88,
  };

  function setHeadHitboxSize(updates = {}) {
    for (const axis of ['x', 'y', 'z']) {
      const val = Number(updates[axis]);
      if (Number.isFinite(val) && val > 0) {
        headHitboxSize[axis] = val;
      }
    }
    if (updates.yUp !== undefined) {
      const yUpVal = Number(updates.yUp);
      if (Number.isFinite(yUpVal)) {
        headHitboxSize.yUp = yUpVal;
      }
    }
    root.InGameFront?.setHeadHitboxSize?.(headHitboxSize);
    return { ...headHitboxSize };
  }

  function getHeadHitboxSize() {
    return { ...headHitboxSize };
  }

  // 카메라 앞뒤(플레이어 뒤쪽 거리) 및 위아래(높이) 위치 (인게임 '0' 키 개발자 패널에서 실시간 조절 가능)
  const cameraOffset = {
    back: 2.4,
    height: 2.3,
  };

  function setCameraOffset(updates = {}) {
    const nextBack = Number(updates.back);
    if (Number.isFinite(nextBack)) {
      cameraOffset.back = nextBack;
    }
    const nextHeight = Number(updates.height);
    if (Number.isFinite(nextHeight)) {
      cameraOffset.height = nextHeight;
    }
    root.InGameFront?.setCameraOffset?.(cameraOffset);
    return { ...cameraOffset };
  }

  function getCameraOffset() {
    return { ...cameraOffset };
  }

  // 공격 종료 후 다음 공격까지 대기하는 쿨다운(후딜레이, 초 단위, 개발자 패널에서 조절 가능)
  let attackCooldownDuration = 0.2;

  function setAttackCooldownDuration(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      attackCooldownDuration = num;
    }
    return attackCooldownDuration;
  }

  function getAttackCooldownDuration() {
    return attackCooldownDuration;
  }

  // 세트(줄다리기 밀어내기) 규칙 상태:
  // - 기본 체력(maxSteps): 4 (balance: 0 중앙, ±4 도달 시 승패 결정)
  // - 세트 흐름: INTRO(세트 시작 연출) -> READY(볼륨 업 키 정렬 준비) -> PLAYING(전투 진행) -> RESULT(승패 피니시 연출)
  // - 게임 시작(PLAYING) 후 1분(60초)이 지나면 데미지 2배(damageMultiplier: 2) 적용
  // - 1분 도달 10초 전(50초~60초)부터 화면 중앙 카운트다운(countdownRemaining: 10..1) 표시
  const SET_MAX_STEPS = 4;
  const SET_STEP_DISTANCE = 1.1;
  const SET_INTRO_DURATION_SEC = 5.0;
  const SET_READY_CUE_SEC = 1.05;
  const SET_FIGHT_BANNER_SEC = 0.85;
  const SET_RESULT_DISPLAY_SEC = 2.8;
  const SET_DOUBLE_DAMAGE_SEC = 60.0;
  const SET_COUNTDOWN_WINDOW_SEC = 10.0;

  const setState = {
    phase: 'INTRO', // 'INTRO' -> 'READY' -> 'READY_CUE' -> 'PLAYING' -> 'RESULT'
    setNumber: 1,
    lastWinner: null,
    introTimer: SET_INTRO_DURATION_SEC,
    introDuration: SET_INTRO_DURATION_SEC,
    introAssemblePlayers: ['PLAYER_1', 'PLAYER_2'],
    readyCueTimer: 0,
    fightBannerTimer: 0,
    ready: {
      PLAYER_1: false,
      PLAYER_2: false,
    },
    balance: 0,
    maxSteps: SET_MAX_STEPS,
    stepDistance: SET_STEP_DISTANCE,
    winner: null,
    resultTimer: 0,
    elapsedTime: 0,
    doubleDamageTime: SET_DOUBLE_DAMAGE_SEC,
    countdownWindow: SET_COUNTDOWN_WINDOW_SEC,
    isDoubleDamage: false,
    damageMultiplier: 1,
    countdownRemaining: 0,
  };

  function resetSetState({ nextSet = false } = {}) {
    if (nextSet) {
      setState.setNumber += 1;
    } else {
      setState.setNumber = 1;
      setState.lastWinner = null;
    }
    setState.phase = 'INTRO';
    setState.introTimer = SET_INTRO_DURATION_SEC;
    setState.introDuration = SET_INTRO_DURATION_SEC;
    // 1세트면 두 플레이어 모두 패배 판정으로 조립 애니메이션 진행, 2세트 이상은 직전 라운드 패자만 조립
    if (setState.setNumber === 1 || !setState.lastWinner) {
      setState.introAssemblePlayers = ['PLAYER_1', 'PLAYER_2'];
    } else {
      const prevLoser = setState.lastWinner === 'PLAYER_1' ? 'PLAYER_2' : 'PLAYER_1';
      setState.introAssemblePlayers = [prevLoser];
    }
    setState.ready.PLAYER_1 = false;
    setState.ready.PLAYER_2 = false;
    setState.readyCueTimer = 0;
    setState.fightBannerTimer = 0;
    setState.balance = 0;
    setState.winner = null;
    setState.resultTimer = 0;
    setState.elapsedTime = 0;
    setState.isDoubleDamage = false;
    setState.damageMultiplier = 1;
    setState.countdownRemaining = 0;
    for (const player of Object.values(playerData)) {
      player.state = PLAYER_STATE.IDLE;
      player.stateDuration = 0;
      player.attackHasHit = false;
      player.attackStartFrontalSegment = null;
      player.attackDirectionLocked = false;
      player.attackCooldown = 0;
      player.attackTriggerStreak = 0;
      player.hitImpact = null;
    }
    return {
      ...setState,
      ready: { ...setState.ready },
      introAssemblePlayers: [...setState.introAssemblePlayers],
    };
  }

  function getSetState() {
    return {
      ...setState,
      ready: { ...setState.ready },
      introAssemblePlayers: [...setState.introAssemblePlayers],
    };
  }

  function setHitPushbackDistance(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) {
      setState.stepDistance = num;
    }
    return setState.stepDistance;
  }

  function getHitPushbackDistance() {
    return setState.stepDistance;
  }

  // 센서 노이즈 스파이크 방지용 스무딩 및 공격 중 회전 감쇠 파라미터 (개발자 패널에서 실시간 조절 가능)
  let sensorTiltSmoothing = 0.65;          // 일반 상태 쿼터니언 보간 계수 (0.05~1.0, 1.0이면 보간 없음)
  let attackRotationDamping = 0.18;        // 공격(ATTACK) 중 회전 감쇠 보간 계수 (0.05~1.0, 1.0이면 감쇠 없음)
  const ATTACK_TRIGGER_FRAMES = 2;         // 단발성 1프레임 스파이크 무시를 위한 연속 기준 초과 프레임 수

  function setSensorTiltSmoothing(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0 && num <= 1) {
      sensorTiltSmoothing = num;
    }
    return sensorTiltSmoothing;
  }

  function getSensorTiltSmoothing() {
    return sensorTiltSmoothing;
  }

  function setAttackRotationDamping(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0 && num <= 1) {
      attackRotationDamping = num;
    }
    return attackRotationDamping;
  }

  function getAttackRotationDamping() {
    return attackRotationDamping;
  }

  // 두 단위 쿼터니언 간의 최단 경로 구면 선형 보간 (Slerp)
  function slerpQuaternions(q1, q2, t) {
    const a = normalizeQuaternion(q1 || { x: 0, y: 0, z: 0, w: 1 });
    let b = normalizeQuaternion(q2 || { x: 0, y: 0, z: 0, w: 1 });
    let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    if (dot < 0) {
      b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
      dot = -dot;
    }
    if (dot > 0.9995) {
      return normalizeQuaternion({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        w: a.w + (b.w - a.w) * t,
      });
    }
    const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sinTheta0 = Math.sin(theta0) || 1;
    const theta = theta0 * t;
    const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / sinTheta0;
    const s1 = Math.sin(theta) / sinTheta0;
    return normalizeQuaternion({
      x: s0 * a.x + s1 * b.x,
      y: s0 * a.y + s1 * b.y,
      z: s0 * a.z + s1 * b.z,
      w: s0 * a.w + s1 * b.w,
    });
  }

  // 플레이어별 영점 조절용 쿼터니언 변수 (버튼 2번 입력 시 갱신되며, 센서값에 곱해 영점을 0, 0, 0, 1로 만듦)
  const zeroCalibration = {
    PLAYER_1: { x: 0, y: 0, z: 0, w: 1 },
    PLAYER_2: { x: 0, y: 0, z: 0, w: 1 },
  };

  function normalizeQuaternion(q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return {
      x: q.x / len,
      y: q.y / len,
      z: q.z / len,
      w: q.w / len,
    };
  }

  // 단위 쿼터니언의 역원(켤레 쿼터니언): inverse(q) * q = (0, 0, 0, 1)
  function invertQuaternion(q) {
    const n = normalizeQuaternion(q);
    return {
      x: -n.x || 0,
      y: -n.y || 0,
      z: -n.z || 0,
      w: n.w || 1,
    };
  }

  // 두 쿼터니언 곱셈 (a * b)
  function multiplyQuaternions(a, b) {
    const rx = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const ry = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const rz = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const rw = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    const n = normalizeQuaternion({ x: rx, y: ry, z: rz, w: rw });
    return {
      x: Number(n.x.toFixed(4)) || 0,
      y: Number(n.y.toFixed(4)) || 0,
      z: Number(n.z.toFixed(4)) || 0,
      w: Number(n.w.toFixed(4)) || 0,
    };
  }

  function createInitialPlayerData() {
    return {
      tilt: { x: 0, y: 0, z: 0, w: 1 },            // 기울기 (쿼터니언 xyzw)
      prevTilt: { x: 0, y: 0, z: 0, w: 1 },        // 직전 틱 기울기 (각속도 계산용 쿼터니언 xyzw)
      angularVelocity: { x: 0, y: 0, z: 0 },       // 플레이어 저장 쿼터니언 기반 검 각속도 (xyz, rad/s)
      acceleration: { x: 0, y: 0, z: 0 },          // 가속도 (xyz)
      button: 0,                                   // 버튼 입력 (0: 없음, 1: 방어, 2: 강타)
      state: PLAYER_STATE.IDLE,                    // 현재 상태 (기본값: 준비상태)
      stateDuration: 0,                            // 상태 유지시간 (초 단위, 0 이하면 기본상태로 변경)
      armSwingMultiplier,                          // 기울기 값에 따라 팔이 움직이는 배수
      attackArmExtension,                          // 공격 판정 시 팔이 늘어나는 길이
      defenseSwordOffset,                          // 방어 시 검이 손잡이 방향으로 이동하는 거리
      stunCircleRadius,                            // 기절 시 중앙 검 진입금지 원 반지름
      currentArmExtension: 0,                      // 현재 보간된 팔 연장 길이
      attackHasHit: false,                         // 현재 공격 스윙에서 이미 피격 판정이 발생했는지 여부
      attackStartFrontalSegment: null,             // 공격 판정 시작 시점에 고정된 정면 검 선분 (단일 방향 고정용)
      attackDirectionLocked: false,                // 현재 공격의 방향이 고정되었는지 여부
      attackCooldown: 0,                           // 공격 종료 후 회수 반동 오인식 방지용 쿨다운 (초)
      attackTriggerStreak: 0,                      // 각속도 기준치 연속 초과 프레임 카운터 (1프레임 스파이크 필터링)
      hitImpact: null,                             // 피격 시 검이 맞은 방향 및 진동 정보
      prevSwordTipWorld: null,                     // 직전 틱 검끝 월드 좌표 (타격 스윙 방향 계산용)
      swordCollider: null,                         // 공격/방어 판정 시에만 활성화되는 검 선분 콜라이더
      headCollider: null,                          // 머리 구형 콜라이더
    };
  }

  // 두 플레이어(PLAYER_1, PLAYER_2)의 기울기, 가속도, 상태를 저장하는 변수
  const playerData = {
    PLAYER_1: createInitialPlayerData(),
    PLAYER_2: createInitialPlayerData(),
  };

  function isRecord(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isVector(v, keys) {
    return isRecord(v) && keys.every((key) => Number.isFinite(v[key]));
  }

  function isValidRotation(rv) {
    if (!isVector(rv, ['x', 'y', 'z', 'w'])) return false;
    return rv.x !== 0 || rv.y !== 0 || rv.z !== 0 || rv.w !== 0;
  }

  function isValidPayload(payload) {
    if (!isRecord(payload)) return false;
    if (!isValidRotation(payload.rotation_vector)) return false;
    if (payload.acceleration !== undefined && !isVector(payload.acceleration, ['x', 'y', 'z'])) return false;
    if (payload.button !== undefined && ![0, 1, 2].includes(payload.button)) return false;
    return true;
  }

  function refreshPlayersFromNetwork() {
    const live = root.GameNetwork?.getStats?.();
    if (!Array.isArray(live) || !live.length) return;
    const byId = new Map(currentPlayers.map((p) => [p.id, p]));
    for (const s of live) byId.set(s.id, s);
    currentPlayers = [...byId.values()];
  }

  function readPlayerSensorValue(playerId, playerStat) {
    let rawPayload;
    let hasNewCandidate = false;

    if (sensorBuffer.has(playerId)) {
      rawPayload = sensorBuffer.get(playerId);
      sensorBuffer.delete(playerId);
      hasNewCandidate = true;
      if (playerStat?.latest) lastReadPackets.set(playerId, playerStat.latest);
    } else if (playerStat?.latest && lastReadPackets.get(playerId) !== playerStat.latest) {
      lastReadPackets.set(playerId, playerStat.latest);
      rawPayload = playerStat.latest.payload;
      hasNewCandidate = true;
    }

    if (hasNewCandidate && isValidPayload(rawPayload)) {
      previousPayloads.set(playerId, rawPayload);
      return rawPayload;
    }

    return previousPayloads.get(playerId) ?? null;
  }

  // 1. 센서값 가져오기 (정상적인 값이 오지 않을 시 이전 값 반환)
  function fetchSensorData() {
    refreshPlayersFromNetwork();

    const playerById = new Map(currentPlayers.map((p) => [p.id, p]));
    const playerIds = new Set([
      ...playerById.keys(),
      ...sensorBuffer.keys(),
      ...previousPayloads.keys(),
    ]);

    const sensorData = new Map();
    for (const playerId of playerIds) {
      const playerStat = playerById.get(playerId);
      const payload = readPlayerSensorValue(playerId, playerStat);
      if (payload) {
        if (playerStat?.latest && !isValidPayload(playerStat.latest.payload)) {
          playerStat.latest = { ...playerStat.latest, payload };
        }
        if (!playerData[playerId]) {
          playerData[playerId] = createInitialPlayerData();
        }
        if (!zeroCalibration[playerId]) {
          zeroCalibration[playerId] = { x: 0, y: 0, z: 0, w: 1 };
        }
        if (payload.button !== undefined) {
          playerData[playerId].button = payload.button;
        }
        // 버튼 2번이 눌리면 현재 센서 쿼터니언의 역원을 영점조절용 변수(zeroCalibration)에 저장
        // 또한 세트 시작 준비(READY) 단계에서 볼륨 업 키(button === 1)를 누르면 검 영점 정렬과 동시에 준비 완료 처리
        let calibratedNow = false;
        if (payload.button === 2) {
          zeroCalibration[playerId] = invertQuaternion(payload.rotation_vector);
          calibratedNow = true;
        } else if (setState.phase === 'READY' && payload.button === 1 && !setState.ready[playerId]) {
          zeroCalibration[playerId] = invertQuaternion(payload.rotation_vector);
          setState.ready[playerId] = true;
          calibratedNow = true;
        }
        // 직전 플레이어 정보에 저장된 쿼터니언(tilt) 백업
        const prevTilt = playerData[playerId].tilt
          ? { ...playerData[playerId].tilt }
          : { x: 0, y: 0, z: 0, w: 1 };
        // 영점조절용 변수를 센서값에 곱해 목표 쿼터니언 산출
        const targetTilt = multiplyQuaternions(
          zeroCalibration[playerId],
          normalizeQuaternion(payload.rotation_vector)
        );
        // 방법 3(센서 스파이크 저역통과 필터) & 방법 4(공격 중 급격한 손목 비틀기 회전 감쇠) 적용
        if (calibratedNow) {
          playerData[playerId].tilt = targetTilt;
          playerData[playerId].angularVelocity = { x: 0, y: 0, z: 0 };
          playerData[playerId].attackTriggerStreak = 0;
        } else {
          const smoothingFactor = playerData[playerId].state === PLAYER_STATE.ATTACK
            ? attackRotationDamping
            : sensorTiltSmoothing;
          const smoothed = slerpQuaternions(prevTilt, targetTilt, smoothingFactor);
          playerData[playerId].tilt = {
            x: Number(smoothed.x.toFixed(4)) || 0,
            y: Number(smoothed.y.toFixed(4)) || 0,
            z: Number(smoothed.z.toFixed(4)) || 0,
            w: Number(smoothed.w.toFixed(4)) || 0,
          };
          // 플레이어 정보에 저장되는 쿼터니언(tilt)의 변화량으로부터 각속도(xyz) 계산
          playerData[playerId].angularVelocity = computeAngularVelocity(prevTilt, playerData[playerId].tilt);
        }
        playerData[playerId].prevTilt = { ...playerData[playerId].tilt };
        playerData[playerId].armSwingMultiplier = armSwingMultiplier;
        playerData[playerId].attackArmExtension = attackArmExtension;
        playerData[playerId].defenseSwordOffset = defenseSwordOffset;
        playerData[playerId].stunCircleRadius = stunCircleRadius;
        if (payload.acceleration) {
          playerData[playerId].acceleration = { ...payload.acceleration };
        }
        sensorData.set(playerId, payload);
      }
    }
    return sensorData;
  }

  // 플레이어에게 특정 상태와 상태 유지시간(초) 부여
  // 규칙: 현재 유지시간(stateDuration > 0)이 남아있을 때는 새 상태의 위계가 현재 상태와 같거나 상위(>=)일 때만 덮어씀
  function setPlayerState(player, newState, durationSec = STATE_DURATION[newState] || 0, options = {}) {
    if (!player) return false;
    const { force = false, inheritDuration = false } = options;

    if (!force && player.stateDuration > 0 && !canOverrideState(player.state, newState)) {
      return false;
    }

    player.state = newState;
    if (!inheritDuration) {
      player.stateDuration = Math.max(0, Number(durationSec) || 0);
    }
    return true;
  }

  // 플레이어 정보에 저장된 쿼터니언 기반 각속도(angularVelocity)와 버튼으로부터 현재 동작(준비상태/기본공격/방어) 판정
  function detectInputAction(player) {
    // 방어키(button === 1)를 누르고 있으면 방어 상태 우선 유지
    if (player.button === 1) {
      player.attackTriggerStreak = 0;
      return PLAYER_STATE.DEFENSE;
    }
    // 공격 종료 후 쿨다운 중에는 회수 반동으로 인한 재공격 차단
    if (player.attackCooldown > 0) {
      player.attackTriggerStreak = 0;
      return PLAYER_STATE.IDLE;
    }
    const av = player.angularVelocity || { x: 0, y: 0, z: 0 };
    const exceedsThreshold =
      Math.abs(av.x || 0) >= ATTACK_ANGULAR_THRESHOLD.x ||
      Math.abs(av.y || 0) >= ATTACK_ANGULAR_THRESHOLD.y ||
      Math.abs(av.z || 0) >= ATTACK_ANGULAR_THRESHOLD.z;

    if (exceedsThreshold) {
      player.attackTriggerStreak = (player.attackTriggerStreak || 0) + 1;
      // 방법 3: 단발성 1프레임 스파이크를 무시하고 연속 ATTACK_TRIGGER_FRAMES 이상 기준 초과 시에만 공격 발동
      if (player.attackTriggerStreak >= ATTACK_TRIGGER_FRAMES) {
        return PLAYER_STATE.ATTACK;
      }
    } else {
      player.attackTriggerStreak = 0;
    }
    return PLAYER_STATE.IDLE;
  }

  /*
   * 상태표 (공격자 기준)
   * 동작       | 준비상태(IDLE) | 기본공격(ATTACK) | 방어(DEFENSE)
   * 준비상태   | -              | 공격성공         | -
   * 기본공격   | 공격성공       | 패리             | 공격실패
   * 방어       | -              | 공격실패         | -
   *
   * 위계: 기본(0) < 공격(10) = 방어(10) < 기절방어(20) = 기절(20) < 피격(30)
   * - 같거나 상위(>=)인 상태는 현재 상태를 덮어씌움
   */
  function isDefendingState(state) {
    return state === PLAYER_STATE.DEFENSE || state === PLAYER_STATE.STUN_DEFENSE;
  }

  function isStunnedState(state) {
    return state === PLAYER_STATE.STUN || state === PLAYER_STATE.STUN_DEFENSE;
  }

  // 공격(ATTACK) 또는 방어(DEFENSE, STUN_DEFENSE) 판정일 때만 검에 물리 판정이 존재함
  function hasSwordPhysics(state) {
    return (
      state === PLAYER_STATE.ATTACK ||
      state === PLAYER_STATE.DEFENSE ||
      state === PLAYER_STATE.STUN_DEFENSE
    );
  }

  const ARM_PIVOT_OFFSET = { x: 0, y: -0.22, z: 0.45 };
  const WRIST_BASE_OFFSET = { x: 0, y: 0.12, z: -0.95 };
  const HEAD_RADIUS = 0.44;
  const SWORD_BLADE_LENGTH = 2.2;
  const SWORD_HANDLE_BACK = 0.50;
  const SWORD_HEAD_HIT_RADIUS = 0.14;
  const SWORD_CLASH_RADIUS = 0.34;
  const ARM_RETRACT_SMOOTHING = 0.16;

  function rotateVec3ByQuat(v, q) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  function mapGripQuaternion(q) {
    const mx = -q.z;
    const my = -q.x;
    const mz = -q.y;
    const mw = q.w;

    const halfRad = (-90 * Math.PI) / 180 / 2;
    const s = Math.sin(halfRad);
    const c = Math.cos(halfRad);

    const rx = mx * c + my * s;
    const ry = my * c - mx * s;
    const rz = mz * c + mw * s;
    const rw = mw * c - mz * s;

    return normalizeQuaternion({ x: rx, y: -ry, z: rz, w: rw });
  }

  function quatFromUnitVectors(fromVec, toVec) {
    let r = fromVec.x * toVec.x + fromVec.y * toVec.y + fromVec.z * toVec.z + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(fromVec.x) > Math.abs(fromVec.z)) {
        return normalizeQuaternion({ x: -fromVec.y, y: fromVec.x, z: 0, w: r });
      }
      return normalizeQuaternion({ x: 0, y: -fromVec.z, z: fromVec.y, w: r });
    }
    return normalizeQuaternion({
      x: fromVec.y * toVec.z - fromVec.z * toVec.y,
      y: fromVec.z * toVec.x - fromVec.x * toVec.z,
      z: fromVec.x * toVec.y - fromVec.y * toVec.x,
      w: r,
    });
  }

  // 기절(STUN) 상태일 때(기절+방어 STUN_DEFENSE 제외) 검이 중앙 원 안으로 들어오지 못하고
  // 검끝이 정면 기준 완전 바깥쪽(중심에서 90도 방사형 외곽, z = 0)을 향한 채 원 둘레를 따라 움직이도록 보정
  function applyStunCircleConstraint(qn, baseDir, rawBladeDir) {
    const ox = rawBladeDir.x - baseDir.x;
    const oy = rawBladeDir.y - baseDir.y;
    const dist = Math.hypot(ox, oy);

    // 정중앙 근처일 때는 위쪽(+Y)으로 검이 완전히 들리도록 기본 각도(+PI/2) 부여,
    // 움직임이 있으면 해당 방향 각도(angle)를 따라 검끝이 완전 바깥쪽(z = 0)을 가리키도록 설정
    const angle = dist > 1e-4 ? Math.atan2(oy, ox) : Math.PI / 2;
    const clampedBladeDir = {
      x: Math.cos(angle),
      y: Math.sin(angle),
      z: 0,
    };
    const deltaQ = quatFromUnitVectors(rawBladeDir, clampedBladeDir);
    const clampedQ = multiplyQuaternions(deltaQ, qn);
    return { qn: clampedQ, bladeDir: clampedBladeDir, angle };
  }

  // armPivot 로컬 좌표를 월드 좌표로 변환 (세트 밀어내기 오프셋 arenaShiftX 반영)
  function armPivotLocalToWorld(playerId, localPt) {
    const halfDist = playerDistance / 2;
    const arenaShiftX = setState.balance * setState.stepDistance;
    const bx = localPt.x + ARM_PIVOT_OFFSET.x;
    const by = localPt.y + ARM_PIVOT_OFFSET.y;
    const bz = localPt.z + ARM_PIVOT_OFFSET.z;

    if (playerId === 'PLAYER_1') {
      // baseGroup position (-halfDist + arenaShiftX, 1.1, 0), rotation.y = -PI / 2
      return {
        x: -halfDist + arenaShiftX - bz,
        y: 1.1 + by,
        z: bx,
      };
    }
    // PLAYER_2: baseGroup position (+halfDist + arenaShiftX, 1.1, 0), rotation.y = +PI / 2
    return {
      x: halfDist + arenaShiftX + bz,
      y: 1.1 + by,
      z: -bx,
    };
  }

  // 월드 방향 벡터를 플레이어의 armPivot 로컬 방향 벡터로 변환
  function worldDirToArmPivotLocal(playerId, worldDir) {
    if (playerId === 'PLAYER_1') {
      return {
        x: worldDir.z,
        y: worldDir.y,
        z: -worldDir.x,
      };
    }
    return {
      x: -worldDir.z,
      y: worldDir.y,
      z: worldDir.x,
    };
  }

  // 플레이어의 현재 자세로부터 월드 공간의 머리(구) 콜라이더와 검(선분) 콜라이더 갱신
  function updatePlayerPhysicsColliders(playerId, player) {
    if (!player) return;
    const rawTilt = player.tilt || { x: 0, y: 0, z: 0, w: 1 };
    let qn = mapGripQuaternion(rawTilt);
    const q0n = mapGripQuaternion({ x: 0, y: 0, z: 0, w: 1 });
    const forwardVec = { x: 0, y: 0, z: -1 };
    const baseDir = rotateVec3ByQuat(forwardVec, q0n);
    let bladeDir = rotateVec3ByQuat(forwardVec, qn);

    const baseArmRadius = Math.abs(WRIST_BASE_OFFSET.z) || 0.95;

    // 기절(STUN) 상태(단, 기절+방어 STUN_DEFENSE 제외)일 때 중앙 원 진입 금지 및 검끝 바깥쪽 방향 강제 적용
    const isPureStun = player.state === PLAYER_STATE.STUN;
    const circleRadius = Number.isFinite(Number(player.stunCircleRadius))
      ? Number(player.stunCircleRadius)
      : stunCircleRadius;
    let stunOutwardAngle = Math.PI / 2;
    if (isPureStun) {
      const constrained = applyStunCircleConstraint(qn, baseDir, bladeDir, circleRadius, baseArmRadius);
      qn = constrained.qn;
      bladeDir = constrained.bladeDir;
      if (Number.isFinite(constrained.angle)) {
        stunOutwardAngle = constrained.angle;
      }
    }

    const isAttacking = player.state === PLAYER_STATE.ATTACK;
    const targetExtension = isAttacking
      ? Math.max(0, Number.isFinite(Number(player.attackArmExtension)) ? Number(player.attackArmExtension) : attackArmExtension)
      : 0;
    const prevExtension = Number(player.currentArmExtension) || 0;
    let currentExtension;
    if (targetExtension >= prevExtension) {
      currentExtension = targetExtension;
    } else {
      const step = Math.max((prevExtension - targetExtension) * ARM_RETRACT_SMOOTHING, 0.005);
      currentExtension = Math.max(targetExtension, prevExtension - step);
    }
    player.currentArmExtension = currentExtension;

    const armRadius = Math.max(0.1, baseArmRadius + currentExtension);
    const mult = Number.isFinite(Number(player.armSwingMultiplier))
      ? Number(player.armSwingMultiplier)
      : armSwingMultiplier;

    let dx = (bladeDir.x - baseDir.x) * armRadius * mult;
    let dy = (bladeDir.y - baseDir.y) * armRadius * mult;

    if (isPureStun) {
      const minWristR = Math.min(armRadius * 0.9, Math.max(0, circleRadius));
      const wristDist = Math.max(Math.hypot(dx, dy), minWristR);
      dx = Math.cos(stunOutwardAngle) * wristDist;
      dy = Math.sin(stunOutwardAngle) * wristDist;
    }

    const xySq = Math.min(armRadius * armRadius * 0.92, dx * dx + dy * dy);
    const wx = WRIST_BASE_OFFSET.x + dx;
    const wy = WRIST_BASE_OFFSET.y + dy;
    const wz = -Math.sqrt(Math.max(0.04, armRadius * armRadius - xySq));

    let sx = wx;
    let sy = wy;
    let sz = wz;
    const isDefending = isDefendingState(player.state) || player.button === 1;
    if (isDefending) {
      const defOffsetZ = Number.isFinite(Number(player.defenseSwordOffset))
        ? Number(player.defenseSwordOffset)
        : defenseSwordOffset;
      const shift = rotateVec3ByQuat({ x: 0, y: 0, z: defOffsetZ }, qn);
      sx += shift.x;
      sy += shift.y;
      sz += shift.z;
    }

    // 그래픽(구형 머리 메쉬)과 분리된 직육면체 머리 히트박스:
    // 기본 크기(0.88 x 0.88 x 0.88)는 반지름 0.44인 머리 구의 6면에 접하며,
    // 세로 아래(y)는 정수리 기준 아래쪽으로, 세로 위쪽 추가(yUp)는 정수리 기준 위쪽으로 독립 조절 가능
    const headSphereCenterLocal = { x: 0, y: HEAD_RADIUS, z: headOffsetZ };
    const headSphereCenterWorld = armPivotLocalToWorld(playerId, headSphereCenterLocal);
    const boxW = Number(headHitboxSize.x) > 0 ? Number(headHitboxSize.x) : HEAD_RADIUS * 2;
    const boxDown = Number(headHitboxSize.y) > 0 ? Number(headHitboxSize.y) : HEAD_RADIUS * 2;
    const boxUp = Number.isFinite(Number(headHitboxSize.yUp)) ? Number(headHitboxSize.yUp) : 0;
    const boxD = Number(headHitboxSize.z) > 0 ? Number(headHitboxSize.z) : HEAD_RADIUS * 2;

    // 플레이어 로컬 x(가로) -> 월드 Z축, 로컬 y(세로) -> 월드 Y축, 로컬 z(앞뒤) -> 월드 X축
    const halfWorldX = boxD / 2;
    const halfWorldZ = boxW / 2;
    const baseTopWorldY = headSphereCenterWorld.y + HEAD_RADIUS;
    const bottomWorldY = baseTopWorldY - boxDown;
    const topWorldY = Math.max(bottomWorldY + 0.05, baseTopWorldY + boxUp);
    const totalHeight = topWorldY - bottomWorldY;
    const boxCenterWorldY = (topWorldY + bottomWorldY) / 2;
    const baseTopLocalY = HEAD_RADIUS * 2;
    const frontalCenterY = (Math.max(baseTopLocalY - boxDown + 0.05, baseTopLocalY + boxUp) + (baseTopLocalY - boxDown)) / 2;

    player.headCollider = {
      type: 'CUBOID',
      center: {
        x: headSphereCenterWorld.x,
        y: boxCenterWorldY,
        z: headSphereCenterWorld.z,
      },
      size: { x: boxW, y: totalHeight, z: boxD, yDown: boxDown, yUp: boxUp },
      frontalCenter: { x: 0, y: frontalCenterY },
      min: {
        x: headSphereCenterWorld.x - halfWorldX,
        y: bottomWorldY,
        z: headSphereCenterWorld.z - halfWorldZ,
      },
      max: {
        x: headSphereCenterWorld.x + halfWorldX,
        y: topWorldY,
        z: headSphereCenterWorld.z + halfWorldZ,
      },
    };

    // 검 선분 콜라이더 (손잡이~검끝)
    const swordStartLocal = {
      x: sx - bladeDir.x * SWORD_HANDLE_BACK,
      y: sy - bladeDir.y * SWORD_HANDLE_BACK,
      z: sz - bladeDir.z * SWORD_HANDLE_BACK,
    };
    const swordTipLocal = {
      x: sx + bladeDir.x * SWORD_BLADE_LENGTH,
      y: sy + bladeDir.y * SWORD_BLADE_LENGTH,
      z: sz + bladeDir.z * SWORD_BLADE_LENGTH,
    };
    const startWorld = armPivotLocalToWorld(playerId, swordStartLocal);
    const tipWorld = armPivotLocalToWorld(playerId, swordTipLocal);

    const prevTip = player.prevSwordTipWorld || tipWorld;
    const tipVelocityWorld = {
      x: tipWorld.x - prevTip.x,
      y: tipWorld.y - prevTip.y,
      z: tipWorld.z - prevTip.z,
    };
    player.prevSwordTipWorld = tipWorld;

    // 정면(월드 Z-Y 평면, P1 시점 기준 가로: +Z, 세로: +Y)으로 내린 검 손잡이(start)와 검끝(tip)의 2D 선분
    const centerWorldY = 1.1 + ARM_PIVOT_OFFSET.y;
    const frontalSegment = {
      handle: {
        x: startWorld.z,
        y: startWorld.y - centerWorldY,
      },
      tip: {
        x: tipWorld.z,
        y: tipWorld.y - centerWorldY,
      },
    };
    player.frontalSegment = frontalSegment;

    // 공격 또는 방어 판정 시에만 검의 물리 판정(active: true) 활성화
    player.swordCollider = {
      active: hasSwordPhysics(player.state),
      start: startWorld,
      tip: tipWorld,
      prevTip,
      tipVelocityWorld,
      frontalSegment,
    };
  }

  // 점 P와 선분 AB 사이의 최근접 점 및 거리 계산
  function closestPointOnSegment(A, B, P) {
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const abz = B.z - A.z;
    const lenSq = abx * abx + aby * aby + abz * abz;
    if (lenSq <= 1e-8) {
      return { point: { ...A }, dist: Math.hypot(P.x - A.x, P.y - A.y, P.z - A.z) };
    }
    const apx = P.x - A.x;
    const apy = P.y - A.y;
    const apz = P.z - A.z;
    const t = Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / lenSq));
    const closest = {
      x: A.x + abx * t,
      y: A.y + aby * t,
      z: A.z + abz * t,
    };
    return {
      point: closest,
      dist: Math.hypot(P.x - closest.x, P.y - closest.y, P.z - closest.z),
    };
  }

  // 두 3D 선분 A1-B1 과 A2-B2 사이의 최단 거리 계산
  function segmentToSegmentDistance(A1, B1, A2, B2) {
    const u = { x: B1.x - A1.x, y: B1.y - A1.y, z: B1.z - A1.z };
    const v = { x: B2.x - A2.x, y: B2.y - A2.y, z: B2.z - A2.z };
    const w = { x: A1.x - A2.x, y: A1.y - A2.y, z: A1.z - A2.z };
    const a = u.x * u.x + u.y * u.y + u.z * u.z;
    const b = u.x * v.x + u.y * v.y + u.z * v.z;
    const c = v.x * v.x + v.y * v.y + v.z * v.z;
    const d = u.x * w.x + u.y * w.y + u.z * w.z;
    const e = v.x * w.x + v.y * w.y + v.z * w.z;
    const D = a * c - b * b;
    let sc, sN, sD = D;
    let tc, tN, tD = D;

    if (D < 1e-7) {
      sN = 0.0;
      sD = 1.0;
      tN = e;
      tD = c;
    } else {
      sN = b * e - c * d;
      tN = a * e - b * d;
      if (sN < 0.0) {
        sN = 0.0;
        tN = e;
        tD = c;
      } else if (sN > sD) {
        sN = sD;
        tN = e + b;
        tD = c;
      }
    }

    if (tN < 0.0) {
      tN = 0.0;
      if (-d < 0.0) sN = 0.0;
      else if (-d > a) sN = sD;
      else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD) {
      tN = tD;
      if (-d + b < 0.0) sN = 0;
      else if (-d + b > a) sN = sD;
      else {
        sN = -d + b;
        sD = a;
      }
    }

    sc = Math.abs(sN) < 1e-7 ? 0.0 : sN / sD;
    tc = Math.abs(tN) < 1e-7 ? 0.0 : tN / tD;

    const dx = w.x + sc * u.x - tc * v.x;
    const dy = w.y + sc * u.y - tc * v.y;
    const dz = w.z + sc * u.z - tc * v.z;
    return Math.hypot(dx, dy, dz);
  }

  // 두 검 콜라이더가 충돌했는지 확인 (빠른 스윙 시 직전 검끝~현재 검끝 중간 경로까지 보간 검사)
  function doSwordsCollide(swordA, swordB) {
    if (!swordA?.active || !swordB?.active) return false;
    const directDist = segmentToSegmentDistance(swordA.start, swordA.tip, swordB.start, swordB.tip);
    if (directDist <= SWORD_CLASH_RADIUS) return true;

    if (swordA.prevTip) {
      const midTipA = {
        x: (swordA.prevTip.x + swordA.tip.x) / 2,
        y: (swordA.prevTip.y + swordA.tip.y) / 2,
        z: (swordA.prevTip.z + swordA.tip.z) / 2,
      };
      if (segmentToSegmentDistance(swordA.start, midTipA, swordB.start, swordB.tip) <= SWORD_CLASH_RADIUS) {
        return true;
      }
    }
    return false;
  }

  // 두 2D 정면 선분(seg1, seg2)이 이루는 예각(0~90도) 계산 헬퍼
  function angleBetweenSegmentsDeg(seg1, seg2) {
    if (!seg1 || !seg2) return null;

    const v1x = seg1.tip.x - seg1.handle.x;
    const v1y = seg1.tip.y - seg1.handle.y;
    const v2x = seg2.tip.x - seg2.handle.x;
    const v2y = seg2.tip.y - seg2.handle.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-4 || len2 < 1e-4) return 0;

    // 두 선분이 이루는 각도 (0° ~ 90°)
    const cosTheta = Math.min(1, Math.max(0, Math.abs(v1x * v2x + v1y * v2y) / (len1 * len2)));
    return Number(((Math.acos(cosTheta) * 180) / Math.PI).toFixed(2));
  }

  // 정면으로 투영된 두 플레이어의 검 2D 선분(손잡이 -> 검끝)이 이루는 예각(0~90도) 계산
  function computeFrontalSwordAngleDeg(p1 = playerData.PLAYER_1, p2 = playerData.PLAYER_2) {
    const seg1 = p1?.frontalSegment || p1?.swordCollider?.frontalSegment;
    const seg2 = p2?.frontalSegment || p2?.swordCollider?.frontalSegment;
    return angleBetweenSegmentsDeg(seg1, seg2);
  }

  // 정면 2D 평면에서 두 검 선분(seg1, seg2)이 서로 교차하거나 접촉(최단 거리 <= threshold)했는지 판정
  function doFrontalSegmentsTouch(p1, p2, threshold = 0.24) {
    const seg1 = p1?.frontalSegment || p1?.swordCollider?.frontalSegment;
    const seg2 = p2?.frontalSegment || p2?.swordCollider?.frontalSegment;
    if (!seg1 || !seg2) return false;
    const a1 = { x: seg1.handle.x, y: seg1.handle.y, z: 0 };
    const b1 = { x: seg1.tip.x, y: seg1.tip.y, z: 0 };
    const a2 = { x: seg2.handle.x, y: seg2.handle.y, z: 0 };
    const b2 = { x: seg2.tip.x, y: seg2.tip.y, z: 0 };
    return segmentToSegmentDistance(a1, b1, a2, b2) <= threshold;
  }

  // 공격자의 검과 방어자의 검이 수직(90도 +- 허용치)으로 교차하고, 방어자의 정면 검 선분 길이가 최소 기준 이상인지 확인
  // 현재 두 검의 정면 각도를 우선 확인하고, 검끝이 중앙을 지나며 투영 선분이 짧아진 경우 공격 시작 시 고정된 선분 각도도 함께 확인
  function isDefenseAngleMatched(attacker, defender) {
    const defSeg = defender?.frontalSegment || defender?.swordCollider?.frontalSegment;
    if (!defSeg) return false;

    const defSegLen = Math.hypot(defSeg.tip.x - defSeg.handle.x, defSeg.tip.y - defSeg.handle.y);
    if (defSegLen < defenseMinSegmentLength) {
      return false;
    }

    const curAttSeg = attacker?.frontalSegment || attacker?.swordCollider?.frontalSegment;
    const curAngle = angleBetweenSegmentsDeg(curAttSeg, defSeg);
    if (curAngle !== null && Math.abs(90 - curAngle) <= defenseAngleThreshold) {
      return true;
    }

    if (attacker?.attackStartFrontalSegment) {
      const startAngle = angleBetweenSegmentsDeg(attacker.attackStartFrontalSegment, defSeg);
      if (startAngle !== null && Math.abs(90 - startAngle) <= defenseAngleThreshold) {
        return true;
      }
    }
    return false;
  }

  // 공격자의 검이 방어자의 검 깊이(월드 X축)에 도달해 검끼리 부딪히는 타이밍인지 판정
  function isSwordClashTiming(attackerId, attacker, defender) {
    const swordA = attacker?.swordCollider;
    const swordD = defender?.swordCollider;
    if (!swordA?.active || !swordD?.active) return false;

    if (attackerId === 'PLAYER_1') {
      // PLAYER_1(-X -> +X 공격): 공격 검의 가장 앞쪽 X가 방어자 검의 X 영역(또는 머리 앞)에 도달한 타이밍
      const attackerFrontX = Math.max(swordA.start.x, swordA.tip.x);
      const defenderFrontX = Math.min(swordD.start.x, swordD.tip.x);
      return attackerFrontX >= defenderFrontX - 0.35;
    }
    // PLAYER_2(+X -> -X 공격)
    const attackerFrontX = Math.min(swordA.start.x, swordA.tip.x);
    const defenderFrontX = Math.max(swordD.start.x, swordD.tip.x);
    return attackerFrontX <= defenderFrontX + 0.35;
  }

  // 3D 선분 AB가 축 정렬 직육면체(AABB: min ~ max)와 교차하는지 검사 (Slab Method)
  function intersectSegmentAABB(A, B, minBounds, maxBounds) {
    let tMin = 0;
    let tMax = 1;
    const dir = {
      x: B.x - A.x,
      y: B.y - A.y,
      z: B.z - A.z,
    };

    for (const axis of ['x', 'y', 'z']) {
      const d = dir[axis];
      const aVal = A[axis];
      const bMin = minBounds[axis];
      const bMax = maxBounds[axis];

      if (Math.abs(d) < 1e-8) {
        if (aVal < bMin || aVal > bMax) return null;
      } else {
        let t1 = (bMin - aVal) / d;
        let t2 = (bMax - aVal) / d;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }

    const tHit = (tMin + tMax) / 2;
    return {
      tMin,
      tMax,
      point: {
        x: A.x + dir.x * tHit,
        y: A.y + dir.y * tHit,
        z: A.z + dir.z * tHit,
      },
    };
  }

  // 공격 검이 상대 머리 직육면체 히트박스에 닿았는지 확인하고, 닿았다면 타격 방향 벡터 반환
  function checkSwordHitsHead(attackerSword, victimId, victimHead) {
    if (!attackerSword?.active || !victimHead?.center || !victimHead?.min || !victimHead?.max) return null;

    let hitResult = intersectSegmentAABB(
      attackerSword.start,
      attackerSword.tip,
      victimHead.min,
      victimHead.max
    );

    // 빠른 스윙 시 직전 프레임 검끝과 현재 검끝의 중간 선분도 함께 검사하여 터널링 방지
    if (!hitResult && attackerSword.prevTip) {
      const midTip = {
        x: (attackerSword.prevTip.x + attackerSword.tip.x) / 2,
        y: (attackerSword.prevTip.y + attackerSword.tip.y) / 2,
        z: (attackerSword.prevTip.z + attackerSword.tip.z) / 2,
      };
      hitResult = intersectSegmentAABB(
        attackerSword.start,
        midTip,
        victimHead.min,
        victimHead.max
      );
    }

    if (!hitResult) return null;

    // 검이 맞은 방향 = 검끝의 이동(스윙) 방향 벡터 + 접촉점에서 머리 중심으로 밀어내는 벡터
    const vel = attackerSword.tipVelocityWorld || { x: 0, y: 0, z: 0 };
    const hitPt = hitResult.point;
    const push = {
      x: victimHead.center.x - hitPt.x,
      y: victimHead.center.y - hitPt.y,
      z: victimHead.center.z - hitPt.z,
    };
    const pushLen = Math.hypot(push.x, push.y, push.z) || 1;
    const pushNorm = { x: push.x / pushLen, y: push.y / pushLen, z: push.z / pushLen };

    const velLen = Math.hypot(vel.x, vel.y, vel.z);
    const velNorm = velLen > 1e-4
      ? { x: vel.x / velLen, y: vel.y / velLen, z: vel.z / velLen }
      : { x: 0, y: 0, z: 0 };

    let wx = velNorm.x * 2.2 + pushNorm.x;
    let wy = velNorm.y * 2.2 + pushNorm.y;
    let wz = velNorm.z * 2.2 + pushNorm.z;
    const wLen = Math.hypot(wx, wy, wz) || 1;
    const worldDir = { x: wx / wLen, y: wy / wLen, z: wz / wLen };
    const localDir = worldDirToArmPivotLocal(victimId, worldDir);

    return {
      worldDir,
      localDir,
      totalDuration: JUDGMENT_DURATION.ATTACK_SUCCESS_HIT || 1.0,
      timestamp: Date.now(),
    };
  }

  function resolveCombat(p1, p2) {
    if (!p1 || !p2) return;

    updatePlayerPhysicsColliders('PLAYER_1', p1);
    updatePlayerPhysicsColliders('PLAYER_2', p2);

    // 세트 준비(READY) 단계이거나 승패(WIN/LOSE) 표시 중에는 전투 판정 중단
    if (setState.phase !== 'PLAYING' || setState.winner) {
      return;
    }

    const s1 = p1.state;
    const s2 = p2.state;

    // 방법 1: 공격 상태가 시작되는 순간의 정면 검 선분을 1회만 고정(Lock)하여 공격 중 손목 비틀기로 방향이 바뀌지 않도록 함
    if (s1 !== PLAYER_STATE.ATTACK) {
      p1.attackHasHit = false;
      p1.attackStartFrontalSegment = null;
      p1.attackDirectionLocked = false;
    } else if (!p1.attackDirectionLocked && p1.frontalSegment) {
      const len1 = Math.hypot(
        p1.frontalSegment.tip.x - p1.frontalSegment.handle.x,
        p1.frontalSegment.tip.y - p1.frontalSegment.handle.y
      );
      p1.attackStartFrontalSegment = {
        handle: { ...p1.frontalSegment.handle },
        tip: { ...p1.frontalSegment.tip },
      };
      if (len1 >= 0.25) {
        p1.attackDirectionLocked = true;
      }
    }

    if (s2 !== PLAYER_STATE.ATTACK) {
      p2.attackHasHit = false;
      p2.attackStartFrontalSegment = null;
      p2.attackDirectionLocked = false;
    } else if (!p2.attackDirectionLocked && p2.frontalSegment) {
      const len2 = Math.hypot(
        p2.frontalSegment.tip.x - p2.frontalSegment.handle.x,
        p2.frontalSegment.tip.y - p2.frontalSegment.handle.y
      );
      p2.attackStartFrontalSegment = {
        handle: { ...p2.frontalSegment.handle },
        tip: { ...p2.frontalSegment.tip },
      };
      if (len2 >= 0.25) {
        p2.attackDirectionLocked = true;
      }
    }

    const swordsCollide3D = doSwordsCollide(p1.swordCollider, p2.swordCollider);
    const frontalSwordsTouch = doFrontalSegmentsTouch(p1, p2);
    const impactOnP2 = s1 === PLAYER_STATE.ATTACK
      ? checkSwordHitsHead(p1.swordCollider, 'PLAYER_2', p2.headCollider)
      : null;
    const impactOnP1 = s2 === PLAYER_STATE.ATTACK
      ? checkSwordHitsHead(p2.swordCollider, 'PLAYER_1', p1.headCollider)
      : null;

    // 검이 실제로 상대 검 또는 머리 히트박스에 닿은 타이밍 판정 (닿는 순간 기절이 걸려 검이 튕겨져 나오는 느낌 연출)
    const p1SwordTouchedP2 = Boolean(
      swordsCollide3D ||
      (isSwordClashTiming('PLAYER_1', p1, p2) && frontalSwordsTouch) ||
      impactOnP2
    );
    const p2SwordTouchedP1 = Boolean(
      swordsCollide3D ||
      (isSwordClashTiming('PLAYER_2', p2, p1) && frontalSwordsTouch) ||
      impactOnP1
    );

    // 1) 맞공격(패리): 두 검이 닿은 타이밍에 교차 각도(90도 +- 설정치)를 만족하면 양쪽 모두 기절 부여
    if (s1 === PLAYER_STATE.ATTACK && s2 === PLAYER_STATE.ATTACK) {
      if (p1SwordTouchedP2 || p2SwordTouchedP1) {
        const parryMatched = isDefenseAngleMatched(p1, p2) || isDefenseAngleMatched(p2, p1);
        if (parryMatched) {
          setPlayerState(
            p1,
            p1.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
            JUDGMENT_DURATION.PARRY_STUN
          );
          setPlayerState(
            p2,
            p2.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
            JUDGMENT_DURATION.PARRY_STUN
          );
          return;
        }
      }
    }

    // 2) PLAYER_1 공격 vs PLAYER_2 방어:
    //    방어 중일 때는 머리 히트박스보다 두 검의 각도(90도 +- 허용치)를 최우선으로 판정
    //    - 각도가 맞으면 히트박스 피격은 원천 차단하고, 검이 닿은 타이밍(p1SwordTouchedP2)에 공격자(PLAYER_1)에게 기절 부여
    const p2BlockedByAngle = s1 === PLAYER_STATE.ATTACK && isDefendingState(s2) && isDefenseAngleMatched(p1, p2);
    if (p2BlockedByAngle) {
      if (p1SwordTouchedP2) {
        setPlayerState(
          p1,
          p1.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
          JUDGMENT_DURATION.ATTACK_FAIL_STUN
        );
      }
      return;
    }

    // 3) PLAYER_2 공격 vs PLAYER_1 방어:
    //    방어 중일 때는 머리 히트박스보다 두 검의 각도(90도 +- 허용치)를 최우선으로 판정
    //    - 각도가 맞으면 히트박스 피격은 원천 차단하고, 검이 닿은 타이밍(p2SwordTouchedP1)에 공격자(PLAYER_2)에게 기절 부여
    const p1BlockedByAngle = s2 === PLAYER_STATE.ATTACK && isDefendingState(s1) && isDefenseAngleMatched(p2, p1);
    if (p1BlockedByAngle) {
      if (p2SwordTouchedP1) {
        setPlayerState(
          p2,
          p2.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
          JUDGMENT_DURATION.ATTACK_FAIL_STUN
        );
      }
      return;
    }

    // 4) 방어 상태가 아니거나 방어 각도/선분길이 조건을 만족하지 못한 경우에만 머리 히트박스 피격(HIT) 판정
    //    때리면 앞으로 전진하고 맞으면 뒤로 밀려남 (기본 데미지 1, 1분 경과 후 데미지 2배, ±maxSteps 도달 시 승패 결정)
    const dmg = Math.max(1, Number(setState.damageMultiplier) || 1);
    if (s1 === PLAYER_STATE.ATTACK && !p1.attackHasHit && !p2BlockedByAngle && impactOnP2) {
      p1.attackHasHit = true;
      p2.hitImpact = impactOnP2;
      setPlayerState(p2, PLAYER_STATE.HIT, JUDGMENT_DURATION.ATTACK_SUCCESS_HIT);
      setState.balance = Math.min(setState.maxSteps, setState.balance + dmg);
      if (setState.balance >= setState.maxSteps) {
        setState.phase = 'RESULT';
        setState.winner = 'PLAYER_1';
        setState.resultTimer = SET_RESULT_DISPLAY_SEC;
      }
    }

    if (s2 === PLAYER_STATE.ATTACK && !p2.attackHasHit && !p1BlockedByAngle && impactOnP1 && !setState.winner) {
      p2.attackHasHit = true;
      p1.hitImpact = impactOnP1;
      setPlayerState(p1, PLAYER_STATE.HIT, JUDGMENT_DURATION.ATTACK_SUCCESS_HIT);
      setState.balance = Math.max(-setState.maxSteps, setState.balance - dmg);
      if (setState.balance <= -setState.maxSteps) {
        setState.phase = 'RESULT';
        setState.winner = 'PLAYER_2';
        setState.resultTimer = SET_RESULT_DISPLAY_SEC;
      }
    }
  }

  // 2. 값에 반응해 상태를 갱신하기
  function updateState(sensorData = new Map(), dt = 1 / TICK_RATE) {
    // 세트 시작 인트로(INTRO) 단계: 옆면 카메라 접근 + 전 라운드 패자 조립 애니메이션 완료 후 READY로 전환
    if (setState.phase === 'INTRO') {
      for (const player of Object.values(playerData)) {
        setPlayerState(player, PLAYER_STATE.IDLE, 0, { force: true });
      }
      setState.introTimer = Math.max(0, Number((setState.introTimer - dt).toFixed(4)));
      if (setState.introTimer <= 0) {
        setState.phase = 'READY';
      }
      return;
    }

    // 세트 준비(READY) 단계: 참여 중인 플레이어가 모두 볼륨 업 키(button === 1)를 눌러 정렬을 완료하면 READY -> FIGHT! 시퀀스로 전환
    if (setState.phase === 'READY') {
      const connectedIds = currentPlayers
        .map((p) => p.id)
        .filter((id) => id === 'PLAYER_1' || id === 'PLAYER_2');
      const requiredIds = connectedIds.length > 0 ? connectedIds : ['PLAYER_1', 'PLAYER_2'];
      if (requiredIds.every((id) => setState.ready[id])) {
        setState.phase = 'READY_CUE';
        setState.readyCueTimer = SET_READY_CUE_SEC;
        setState.fightBannerTimer = 0;
        for (const player of Object.values(playerData)) {
          setPlayerState(player, PLAYER_STATE.IDLE, 0, { force: true });
          player.attackCooldown = 0.25;
          player.attackTriggerStreak = 0;
        }
      } else {
        for (const player of Object.values(playerData)) {
          setPlayerState(player, PLAYER_STATE.IDLE, 0, { force: true });
        }
        resolveCombat(playerData.PLAYER_1, playerData.PLAYER_2);
        return;
      }
    }

    // 준비 완료 후 READY -> FIGHT! 연출 대기 단계 (전투 판정 잠금, 종료 즉시 FIGHT! 배너와 함께 PLAYING 시작)
    if (setState.phase === 'READY_CUE') {
      for (const player of Object.values(playerData)) {
        setPlayerState(player, PLAYER_STATE.IDLE, 0, { force: true });
        player.attackTriggerStreak = 0;
      }
      setState.readyCueTimer = Math.max(0, Number((setState.readyCueTimer - dt).toFixed(4)));
      if (setState.readyCueTimer <= 0) {
        setState.phase = 'PLAYING';
        setState.fightBannerTimer = SET_FIGHT_BANNER_SEC;
        for (const player of Object.values(playerData)) {
          setPlayerState(player, PLAYER_STATE.IDLE, 0, { force: true });
          player.attackCooldown = 0.25;
          player.attackTriggerStreak = 0;
        }
      } else {
        return;
      }
    }

    // FIGHT! 배너 표시 잔여 시간 차감
    if (setState.fightBannerTimer > 0) {
      setState.fightBannerTimer = Math.max(0, Number((setState.fightBannerTimer - dt).toFixed(4)));
    }

    // 세트 결과(WIN/LOSE) 표시 타이머 차감 -> 만료 시 직전 승자를 기록하고 다음 세트 인트로(INTRO)로 전환
    if (setState.resultTimer > 0) {
      setState.resultTimer = Math.max(0, Number((setState.resultTimer - dt).toFixed(4)));
      if (setState.resultTimer <= 0) {
        setState.lastWinner = setState.winner;
        resetSetState({ nextSet: true });
        return;
      }
    }

    // 게임 진행(PLAYING) 중 내부 경과 타이머 갱신 -> 1분(60초) 경과 시 데미지 2배, 10초 전부터 카운트다운
    if (setState.phase === 'PLAYING' && !setState.winner) {
      setState.elapsedTime = Number((setState.elapsedTime + dt).toFixed(4));
      const remainingToDouble = setState.doubleDamageTime - setState.elapsedTime;
      if (remainingToDouble <= 0) {
        setState.isDoubleDamage = true;
        setState.damageMultiplier = 2;
        setState.countdownRemaining = 0;
      } else {
        setState.isDoubleDamage = false;
        setState.damageMultiplier = 1;
        setState.countdownRemaining = remainingToDouble <= setState.countdownWindow
          ? Math.ceil(remainingToDouble)
          : 0;
      }
    }

    for (const [playerId, player] of Object.entries(playerData)) {
      // 0) 공격 후 쿨다운(후딜레이) 차감
      if (player.attackCooldown > 0) {
        player.attackCooldown = Math.max(0, Number((player.attackCooldown - dt).toFixed(4)));
      }

      // 1) 상태유지시간(stateDuration)이 남아있으면 시간 차감
      if (player.stateDuration > 0) {
        player.stateDuration = Math.max(0, Number((player.stateDuration - dt).toFixed(4)));
        if (player.stateDuration <= 0) {
          // 방법 2: 공격(ATTACK)이 자연 종료되면 회수 반동으로 인한 연속 오인식 공격을 막기 위해 쿨다운 부여
          if (player.state === PLAYER_STATE.ATTACK && attackCooldownDuration > 0) {
            player.attackCooldown = attackCooldownDuration;
          }
          // 유지시간이 0 이하로 만료되면 기본상태(또는 방어 유지 시 방어)로 복귀
          const fallbackState = player.button === 1 ? PLAYER_STATE.DEFENSE : PLAYER_STATE.IDLE;
          setPlayerState(player, fallbackState, 0, { force: true });
        }
      }

      // 2) 기절(STUN=20) ↔ 기절+방어(STUN_DEFENSE=20)는 위계가 같으므로(20 >= 20)
      //    기절 유지시간 동안 방어키 입력 여부에 따라 남은 기절시간을 이어받으며 상호 덮어쓰기 가능
      if (player.stateDuration > 0 && isStunnedState(player.state)) {
        const targetStunState = player.button === 1
          ? PLAYER_STATE.STUN_DEFENSE
          : PLAYER_STATE.STUN;
        setPlayerState(player, targetStunState, player.stateDuration, { inheritDuration: true });
      }

      // 3) 센서 입력 동작(기본=0, 공격=10, 방어=10) 반영:
      //    - 유지시간이 0 이하일 때는 자유롭게 전환 (공격 판정 발생 시 ATTACK 유지시간 부여)
      //    - 방법 2: 이미 ATTACK 유지시간이 남아있을 때는 ATTACK을 다시 덮어써 유지시간이 무한 연장되지 않도록 차단
      if (sensorData && sensorData.has(playerId)) {
        const inputAction = detectInputAction(player);
        const actionDuration = inputAction === PLAYER_STATE.ATTACK
          ? JUDGMENT_DURATION.ATTACK
          : (STATE_DURATION[inputAction] || 0);
        if (player.stateDuration <= 0) {
          setPlayerState(player, inputAction, actionDuration, { force: true });
        } else if (!(player.state === PLAYER_STATE.ATTACK && inputAction === PLAYER_STATE.ATTACK)) {
          setPlayerState(player, inputAction, actionDuration);
        }
      }
    }

    // 4) 두 플레이어의 동작을 상태표 및 위계에 따라 판정하여 피격/기절 부여
    resolveCombat(playerData.PLAYER_1, playerData.PLAYER_2);
  }

  // 3. 값에 따라 그래픽 출력하기 (플레이어 정보를 InGameFront로 전달하여 그래픽 갱신)
  function renderGraphics(currentPlayerData = playerData) {
    root.InGameFront?.updateGraphics?.(currentPlayerData);
  }

  // 초당 60번(60Hz) 주기로 실행되는 메인 게임 루프
  function tick() {
    if (!active) return;

    // 1) 센서값 가져오기
    const sensorData = fetchSensorData();

    // 2) 값에 반응해 상태를 갱신하고 (미구현 빈 함수)
    updateState(sensorData);

    // 3) 플레이어 정보를 InGameFront로 전달해 그래픽 출력
    renderGraphics(playerData);

    // 패킷 모니터링 오버레이 갱신
    root.InGameFront?.renderPackets(currentPlayers, currentRates);
  }

  function startLoop() {
    stopLoop();
    if (typeof root.setInterval === 'function') {
      timerId = root.setInterval(tick, TICK_INTERVAL_MS);
    }
  }

  function stopLoop() {
    if (timerId !== null) {
      root.clearInterval?.(timerId);
      timerId = null;
    }
  }

  function start(players = [], rates = new Map()) {
    active = true;
    currentPlayers = players;
    currentRates = rates;
    resetSetState();
    root.InGameFront?.start(() => stop());
    tick();
    startLoop();
  }

  function stop() {
    active = false;
    stopLoop();
    sensorBuffer.clear();
    resetSetState();
    root.InGameFront?.stop();
  }

  function onSensorData(playerId, timestamp, payload, players = [], rates = new Map()) {
    sensorBuffer.set(playerId, payload);
    if (players.length) currentPlayers = players;
    if (rates.size) currentRates = rates;
  }

  function sync(players = [], rates = new Map()) {
    currentPlayers = players;
    currentRates = rates;
    if (active) root.InGameFront?.renderPackets(currentPlayers, currentRates);
  }

  root.InGameBack = {
    PLAYER_STATE,
    STATE_PRIORITY,
    JUDGMENT_DURATION,
    STATE_DURATION,
    ATTACK_ANGULAR_THRESHOLD,
    zeroCalibration,
    playerData,
    setState,
    getSetState,
    resetSetState,
    setHitPushbackDistance,
    getHitPushbackDistance,
    start,
    stop,
    onSensorData,
    sync,
    tick,
    fetchSensorData,
    updateState,
    setPlayerState,
    setJudgmentDurations,
    setAttackAngularThreshold,
    getAttackAngularThreshold,
    computeAngularVelocity,
    setArmSwingMultiplier,
    getArmSwingMultiplier: () => armSwingMultiplier,
    setAttackArmExtension,
    getAttackArmExtension,
    setDefenseSwordOffset,
    getDefenseSwordOffset,
    setDefenseAngleThreshold,
    getDefenseAngleThreshold,
    setDefenseMinSegmentLength,
    getDefenseMinSegmentLength,
    setAttackCooldownDuration,
    getAttackCooldownDuration,
    setSensorTiltSmoothing,
    getSensorTiltSmoothing,
    setAttackRotationDamping,
    getAttackRotationDamping,
    computeFrontalSwordAngleDeg,
    setStunCircleRadius,
    getStunCircleRadius,
    hasSwordPhysics,
    applyStunCircleConstraint,
    updatePlayerPhysicsColliders,
    setPlayerDistance,
    getPlayerDistance,
    setSelfHeadOpacity,
    getSelfHeadOpacity,
    setArmOpacity,
    getArmOpacity,
    setHeadOffsetZ,
    getHeadOffsetZ,
    setHeadHitboxSize,
    getHeadHitboxSize,
    setCameraOffset,
    getCameraOffset,
    getStatePriority,
    canOverrideState,
    registerPlayerState,
    resolveCombat,
    renderGraphics,
    getPlayerData: (playerId) => playerData[playerId] ?? null,
    getSensorValue: (playerId) => previousPayloads.get(playerId) ?? null,
    isActive: () => active,
  };
})(globalThis);
