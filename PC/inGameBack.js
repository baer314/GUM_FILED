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
    IDLE: 'IDLE',       // 대기
    ATTACK: 'ATTACK',   // 공격
    DEFENSE: 'DEFENSE', // 방어
    STUN: 'STUN',       // 기절
    HIT: 'HIT',         // 피격
    // TODO: 필요 시 추가 상태 정의
  };

  function createInitialPlayerData() {
    return {
      tilt: { x: 0, y: 0, z: 0, w: 1 },   // 기울기 (쿼터니언 xyzw)
      acceleration: { x: 0, y: 0, z: 0 }, // 가속도 (xyz)
      state: PLAYER_STATE.IDLE,           // 현재 상태 (기본값: 대기)
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
        sensorData.set(playerId, payload);
      }
    }
    return sensorData;
  }

  // 2. 값에 반응해 상태를 갱신하기 (아직 구현되지 않은 빈 함수)
  function updateState(sensorData) {
    // TODO: 읽어온 센서값(sensorData)에 반응해 게임 상태를 갱신하는 로직 구현 예정
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
    playerData,
    start,
    stop,
    onSensorData,
    sync,
    tick,
    fetchSensorData,
    updateState,
    renderGraphics,
    getPlayerData: (playerId) => playerData[playerId] ?? null,
    getSensorValue: (playerId) => previousPayloads.get(playerId) ?? null,
    isActive: () => active,
  };
})(globalThis);
