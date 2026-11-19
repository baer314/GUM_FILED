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
    ATTACK_SUCCESS_HIT: 1.0, // 공격 성공 시: 상대 피격(HIT) 유지시간
    ATTACK_FAIL_STUN: 1.0,   // 공격 실패 시: 본인 기절(STUN) 유지시간
    PARRY_STUN: 1.0,         // 패리 시: 양쪽 모두 기절(STUN) 유지시간
  };

  // 상태별 기본 유지시간 (단위: 초)
  const STATE_DURATION = {
    [PLAYER_STATE.HIT]: 1.0,  // 피격 상태 1초
    [PLAYER_STATE.STUN]: 1.0, // 기절 상태 1초
  };

  // 판정별/상태별 유지시간 설정 변경 함수
  function setJudgmentDurations(updates = {}) {
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

  // 기본공격 판정 가속도 임계값
  const ATTACK_ACCEL_THRESHOLD = 5.0;

  function createInitialPlayerData() {
    return {
      tilt: { x: 0, y: 0, z: 0, w: 1 },   // 기울기 (쿼터니언 xyzw)
      acceleration: { x: 0, y: 0, z: 0 }, // 가속도 (xyz)
      button: 0,                          // 버튼 입력 (0: 없음, 1: 방어, 2: 강타)
      state: PLAYER_STATE.IDLE,           // 현재 상태 (기본값: 준비상태)
      stateDuration: 0,                   // 상태 유지시간 (초 단위, 0 이하면 기본상태로 변경)
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
        playerData[playerId].tilt = { ...payload.rotation_vector };
        if (payload.acceleration) {
          playerData[playerId].acceleration = { ...payload.acceleration };
        }
        if (payload.button !== undefined) {
          playerData[playerId].button = payload.button;
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

  // 센서 입력(가속도, 버튼)으로부터 플레이어의 현재 동작(준비상태/기본공격/방어) 판정
  function detectInputAction(player) {
    // 방어키(button === 1)를 누르고 있으면 방어 상태 우선 유지
    if (player.button === 1) {
      return PLAYER_STATE.DEFENSE;
    }
    const acc = player.acceleration || { x: 0, y: 0, z: 0 };
    const accelMag = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
    if (accelMag >= ATTACK_ACCEL_THRESHOLD || Math.abs(acc.x || 0) >= ATTACK_ACCEL_THRESHOLD) {
      return PLAYER_STATE.ATTACK;
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

  function resolveCombat(p1, p2) {
    if (!p1 || !p2) return;
    const s1 = p1.state;
    const s2 = p2.state;

    // 양쪽 모두 기본공격 -> 패리 (모두에게 기절 상태 부여 및 시간 초기화)
    if (s1 === PLAYER_STATE.ATTACK && s2 === PLAYER_STATE.ATTACK) {
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

    // PLAYER_1이 기본공격인 경우
    if (s1 === PLAYER_STATE.ATTACK) {
      if (isDefendingState(s2)) {
        // 공격 실패 (상대가 방어 또는 기절+방어) -> 공격자(PLAYER_1)에게 기절 상태 부여 및 시간 초기화
        setPlayerState(
          p1,
          p1.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
          JUDGMENT_DURATION.ATTACK_FAIL_STUN
        );
      } else {
        // 공격 성공 -> 상대(PLAYER_2)에게 최상위 위계인 피격(HIT) 부여 (기존 상태 덮어씀)
        setPlayerState(p2, PLAYER_STATE.HIT, JUDGMENT_DURATION.ATTACK_SUCCESS_HIT);
        //setPlayerState(p1, PLAYER_STATE.IDLE, 0, { force: true });
      }
      return;
    }

    // PLAYER_2가 기본공격인 경우
    if (s2 === PLAYER_STATE.ATTACK) {
      if (isDefendingState(s1)) {
        // 공격 실패 (상대가 방어 또는 기절+방어) -> 공격자(PLAYER_2)에게 기절 상태 부여 및 시간 초기화
        setPlayerState(
          p2,
          p2.button === 1 ? PLAYER_STATE.STUN_DEFENSE : PLAYER_STATE.STUN,
          JUDGMENT_DURATION.ATTACK_FAIL_STUN
        );
      } else {
        // 공격 성공 -> 상대(PLAYER_1)에게 최상위 위계인 피격(HIT) 부여 (기존 상태 덮어씀)
        setPlayerState(p1, PLAYER_STATE.HIT, JUDGMENT_DURATION.ATTACK_SUCCESS_HIT);
        //setPlayerState(p2, PLAYER_STATE.IDLE, 0, { force: true });
      }
    }
  }

  // 2. 값에 반응해 상태를 갱신하기
  function updateState(sensorData = new Map(), dt = 1 / TICK_RATE) {
    for (const [playerId, player] of Object.entries(playerData)) {
      // 1) 상태유지시간(stateDuration)이 남아있으면 시간 차감
      if (player.stateDuration > 0) {
        player.stateDuration = Math.max(0, Number((player.stateDuration - dt).toFixed(4)));
        if (player.stateDuration <= 0) {
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
      //    - 유지시간이 0 이하일 때는 자유롭게 전환
      //    - 유지시간이 남아있을 때는 위계 비교(canOverrideState)를 통과하는 경우에만 덮어씀
      if (sensorData && sensorData.has(playerId)) {
        const inputAction = detectInputAction(player);
        if (player.stateDuration <= 0) {
          setPlayerState(player, inputAction, 0, { force: true });
        } else {
          setPlayerState(player, inputAction, player.stateDuration, { inheritDuration: true });
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
    root.InGameFront?.start(() => stop());
    tick();
    startLoop();
  }

  function stop() {
    active = false;
    stopLoop();
    sensorBuffer.clear();
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
    playerData,
    start,
    stop,
    onSensorData,
    sync,
    tick,
    fetchSensorData,
    updateState,
    setPlayerState,
    setJudgmentDurations,
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
