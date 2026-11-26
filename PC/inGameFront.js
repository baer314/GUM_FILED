'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);
  let scene = null, cameraP1 = null, cameraP2 = null, renderer = null, animId = null;
  let keyBound = false;
  const meshes = new Map();
  const playerGroups = new Map();
  const playerArmExtensions = new Map();
  const receivedAngles = new Map();
  const receivedPlayerInfo = new Map();
  const CAMERA_BACK_OFFSET = 2.4;
  const CAMERA_HEIGHT = 2.3;
  const CAMERA_LOOK_FORWARD = 6.0;
  const ARM_RETRACT_SMOOTHING = 0.16;
  let currentPlayerDistance = 3.0;
  let currentCameraBackOffset = CAMERA_BACK_OFFSET;
  let currentCameraHeight = CAMERA_HEIGHT;
  let currentSelfHeadOpacity = 0.35;
  let currentArmOpacity = 1.0;
  let currentHeadOffsetZ = 0.0;
  let currentHeadHitboxSize = { x: 0.88, y: 0.88, yUp: 0.0, z: 0.88 };
  let currentAttackArmExtension = 0.65;
  let currentDefenseSwordOffset = 1.2;
  let currentDefenseAngleThreshold = 35;
  let currentStunCircleRadius = 0.55;
  let currentArenaShiftX = 0;
  let viewsSwapped = false;
  const STUN_CAMERA_PULLBACK_MAX = 0.55;
  const HIT_CAMERA_PULLBACK_MAX = 1.0;
  const BASE_CAMERA_FOV = 60;
  const ATTACK_CAMERA_FOV = 51; // 공격 판정 시 순간적으로 좁혀지는 카메라 시야각(FOV)
  const cameraFovs = {
    PLAYER_1: BASE_CAMERA_FOV,
    PLAYER_2: BASE_CAMERA_FOV,
  };
  const lastHitTimestamps = {
    PLAYER_1: 0,
    PLAYER_2: 0,
  };
  const lastAlignTimestamps = {
    PLAYER_1: 0,
    PLAYER_2: 0,
  };
  const prevPlayerStates = {
    PLAYER_1: 'IDLE',
    PLAYER_2: 'IDLE',
  };
  let lastClashTimestamp = 0;
  let lastPhase = '';
  let pauseOpen = false;
  const cameraShakeOffsets = {
    PLAYER_1: { x: 0, y: 0, z: 0 },
    PLAYER_2: { x: 0, y: 0, z: 0 },
  };
  const cameraStunPullbacks = {
    PLAYER_1: 0,
    PLAYER_2: 0,
  };

  // [수치 조절용] 방어키를 누를 때 팔(손목) 위치는 유지하고 검만 현재 검 손잡이 방향(+Z) 기준으로 이동하는 기본 오프셋
  const DEFENSE_HAND_OFFSET = { x: 0.0, y: 0, z: 1.2 };

  // 플레이어 부유(둥실둥실) 연출 파라미터 (물리 판정과 무관한 그래픽 전용)
  const PLAYER_BASE_Y = 1.1;
  const FLOAT_BASE_LIFT = 0.04;   // 바닥(y=0)에 닿지 않도록 살짝 띄운 기준 높이 오프셋
  const FLOAT_AMPLITUDE = 0.06;   // 위아래 부유 진폭
  const FLOAT_SPEED = 2.2;        // 부유 주기 속도 (rad/s, 약 2.85초 주기)
  const FLOAT_PHASE_OFFSET = {
    PLAYER_1: 0,
    PLAYER_2: Math.PI * 0.72,     // 두 플레이어가 어긋나게 떠다니도록 위상차 부여
  };

  function getPlayerFloatY(playerId, nowMs) {
    const t = (nowMs / 1000) * FLOAT_SPEED + (FLOAT_PHASE_OFFSET[playerId] || 0);
    return PLAYER_BASE_Y + FLOAT_BASE_LIFT + Math.sin(t) * FLOAT_AMPLITUDE;
  }

  function updateLobbySwordIdle(nowMs) {
    const THREE = root.THREE;
    if (!THREE?.Euler) return;
    const t = nowMs / 1000;
    const configs = [
      { id: 'PLAYER_1', phase: 0, speed: 1.25 },
      { id: 'PLAYER_2', phase: Math.PI * 0.85, speed: 1.15 },
    ];
    for (const cfg of configs) {
      const mesh = meshes.get(cfg.id);
      if (!mesh) continue;
      const baseWrist = mesh.userData?.baseWristOffset || { x: 0, y: 0.12, z: -0.95 };
      const p = t * cfg.speed + cfg.phase;

      // 좌우 부드러운 검 휘두르기 + 완만한 8자 상하 리듬
      const sway = Math.sin(p);
      const figure8 = Math.sin(p * 2);
      const yaw = sway * 0.62;
      const pitch = 0.24 + figure8 * 0.18;
      const roll = -Math.cos(p) * 0.26;

      if (mesh.quaternion?.setFromEuler) {
        mesh.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      }
      const wx = baseWrist.x + sway * 0.30;
      const wy = baseWrist.y + figure8 * 0.08;
      const wz = baseWrist.z + Math.abs(sway) * 0.08;
      mesh.position?.set?.(wx, wy, wz);
      mesh.userData?.updateLimbs?.(wx, wy, wz);
    }
  }

  function updatePlayerFloatPositions() {
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const p1Group = playerGroups.get('PLAYER_1');
    if (p1Group?.position) {
      p1Group.position.y = getPlayerFloatY('PLAYER_1', nowMs);
    }
    const p2Group = playerGroups.get('PLAYER_2');
    if (p2Group?.position) {
      p2Group.position.y = getPlayerFloatY('PLAYER_2', nowMs);
    }
  }

  function applyPlayerDistanceLayout(distance = currentPlayerDistance) {
    const num = Number(distance);
    if (Number.isFinite(num) && num > 0) {
      currentPlayerDistance = num;
    }
    if (root.EndMatchAnimation?.isActive?.() || root.EndSetAnimation?.isActive?.() || root.StartSetAnimation?.isActive?.()) {
      return;
    }
    const halfDist = currentPlayerDistance / 2;
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    const p1Group = playerGroups.get('PLAYER_1');
    if (p1Group?.position?.set) {
      p1Group.position.set(-halfDist + currentArenaShiftX, getPlayerFloatY('PLAYER_1', nowMs), 0);
    }
    const p2Group = playerGroups.get('PLAYER_2');
    if (p2Group?.position?.set) {
      p2Group.position.set(halfDist + currentArenaShiftX, getPlayerFloatY('PLAYER_2', nowMs), 0);
    }

    const shake1 = cameraShakeOffsets.PLAYER_1 || { x: 0, y: 0, z: 0 };
    const shake2 = cameraShakeOffsets.PLAYER_2 || { x: 0, y: 0, z: 0 };
    const stunBack1 = Number(cameraStunPullbacks.PLAYER_1) || 0;
    const stunBack2 = Number(cameraStunPullbacks.PLAYER_2) || 0;

    // 카메라 시선 각도(pitch)를 일정하게 유지하고 세트 밀어내기(currentArenaShiftX), 피격 이동(shake), 후방 밀림(stunBack)을 반영
    if (cameraP1) {
      const cam1X = -halfDist + currentArenaShiftX - currentCameraBackOffset - stunBack1;
      cameraP1.position?.set(cam1X + shake1.x, currentCameraHeight + shake1.y, shake1.z);
      cameraP1.lookAt?.(cam1X + CAMERA_LOOK_FORWARD + shake1.x * 1.8, 1.1 + shake1.y * 2.2, shake1.z * 2.2);
    }
    if (cameraP2) {
      const cam2X = halfDist + currentArenaShiftX + currentCameraBackOffset + stunBack2;
      cameraP2.position?.set(cam2X + shake2.x, currentCameraHeight + shake2.y, shake2.z);
      cameraP2.lookAt?.(cam2X - CAMERA_LOOK_FORWARD + shake2.x * 1.8, 1.1 + shake2.y * 2.2, shake2.z * 2.2);
    }
  }

  function setPlayerDistance(distance) {
    applyPlayerDistanceLayout(distance);
    renderSplitView();
    return currentPlayerDistance;
  }

  function setCameraOffset(updates = {}) {
    const nextBack = Number(updates.back);
    if (Number.isFinite(nextBack)) {
      currentCameraBackOffset = nextBack;
    }
    const nextHeight = Number(updates.height);
    if (Number.isFinite(nextHeight)) {
      currentCameraHeight = nextHeight;
    }
    applyPlayerDistanceLayout(currentPlayerDistance);
    renderSplitView();
    return { back: currentCameraBackOffset, height: currentCameraHeight };
  }

  function setPlayerHeadOpacity(playerId, opacity) {
    const mesh = meshes.get(playerId);
    const headGroup = mesh?.userData?.headGroup;
    const bodyGroup = mesh?.userData?.bodyGroup;
    const headReveal = root.StartSetAnimation?.getPartRevealOpacity?.(playerId, 'head') ?? 1.0;
    const bodyReveal = root.StartSetAnimation?.getPartRevealOpacity?.(playerId, 'body') ?? 1.0;
    headGroup?.userData?.setOpacity?.(opacity * headReveal);
    bodyGroup?.userData?.setOpacity?.(opacity * bodyReveal);
  }

  function setSelfHeadOpacity(opacity) {
    const num = Number(opacity);
    if (Number.isFinite(num)) {
      currentSelfHeadOpacity = Math.min(1, Math.max(0, num));
    }
    renderSplitView();
    return currentSelfHeadOpacity;
  }

  function setArmOpacity(opacity) {
    const num = Number(opacity);
    if (Number.isFinite(num)) {
      currentArmOpacity = Math.min(1, Math.max(0, num));
    }
    for (const mesh of meshes.values()) {
      mesh?.userData?.setArmOpacity?.(currentArmOpacity);
    }
    renderSplitView();
    return currentArmOpacity;
  }

  function setHeadOffsetZ(offsetZ) {
    const num = Number(offsetZ);
    if (Number.isFinite(num)) {
      currentHeadOffsetZ = num;
    }
    for (const mesh of meshes.values()) {
      const headGroup = mesh?.userData?.headGroup;
      const bodyGroup = mesh?.userData?.bodyGroup;
      headGroup?.userData?.setOffsetZ?.(currentHeadOffsetZ);
      bodyGroup?.userData?.setOffsetZ?.(currentHeadOffsetZ);
    }
    renderSplitView();
    return currentHeadOffsetZ;
  }

  function setHeadHitboxSize(updates = {}) {
    for (const axis of ['x', 'y', 'z']) {
      const val = Number(updates[axis]);
      if (Number.isFinite(val) && val > 0) {
        currentHeadHitboxSize[axis] = val;
      }
    }
    if (updates.yUp !== undefined) {
      const yUpVal = Number(updates.yUp);
      if (Number.isFinite(yUpVal)) {
        currentHeadHitboxSize.yUp = yUpVal;
      }
    }
    root.InGameDev?.renderFrontalSwordHud?.(receivedPlayerInfo);
    return { ...currentHeadHitboxSize };
  }

  function setAttackArmExtension(extension) {
    const num = Number(extension);
    if (Number.isFinite(num) && num >= 0) {
      currentAttackArmExtension = num;
    }
    for (const [playerId, info] of receivedPlayerInfo.entries()) {
      updatePose(playerId, info);
    }
    renderSplitView();
    return currentAttackArmExtension;
  }

  function setDefenseSwordOffset(offset) {
    const num = Number(offset);
    if (Number.isFinite(num)) {
      currentDefenseSwordOffset = num;
      DEFENSE_HAND_OFFSET.z = num;
    }
    for (const [playerId, info] of receivedPlayerInfo.entries()) {
      updatePose(playerId, info);
    }
    renderSplitView();
    return currentDefenseSwordOffset;
  }

  function setStunCircleRadius(radius) {
    const num = Number(radius);
    if (Number.isFinite(num) && num >= 0) {
      currentStunCircleRadius = num;
    }
    for (const [playerId, info] of receivedPlayerInfo.entries()) {
      updatePose(playerId, info);
    }
    renderSplitView();
    return currentStunCircleRadius;
  }

  function initThree() {
    const THREE = root.THREE;
    const canvas = $('ingame-canvas');
    if (!THREE || !canvas || typeof canvas.getContext !== 'function') return;
    if (renderer) { resizeThree(); return; }

    scene = new THREE.Scene();

    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const halfWidth = Math.max(1, Math.floor(width / 2));

    const initialDist = root.InGameBack?.getPlayerDistance?.() ?? currentPlayerDistance;
    currentPlayerDistance = Number.isFinite(Number(initialDist)) && Number(initialDist) > 0
      ? Number(initialDist)
      : 3.6;
    const halfDist = currentPlayerDistance / 2;

    const camInit = root.InGameBack?.getCameraOffset?.();
    if (camInit) {
      if (Number.isFinite(Number(camInit.back))) currentCameraBackOffset = Number(camInit.back);
      if (Number.isFinite(Number(camInit.height))) currentCameraHeight = Number(camInit.height);
    }

    // 좌측 화면: 플레이어 1 시점 카메라 (플레이어 1 뒤에서 일정한 각도로 정면을 바라봄)
    const cam1X = -halfDist - currentCameraBackOffset;
    cameraP1 = new THREE.PerspectiveCamera(60, halfWidth / height, 0.1, 100);
    cameraP1.position.set(cam1X, currentCameraHeight, 0);
    cameraP1.lookAt(cam1X + CAMERA_LOOK_FORWARD, 1.1, 0);

    // 우측 화면: 플레이어 2 시점 카메라 (플레이어 2 뒤에서 일정한 각도로 정면을 바라봄)
    const cam2X = halfDist + currentCameraBackOffset;
    cameraP2 = new THREE.PerspectiveCamera(60, (width - halfWidth) / height, 0.1, 100);
    cameraP2.position.set(cam2X, currentCameraHeight, 0);
    cameraP2.lookAt(cam2X - CAMERA_LOOK_FORWARD, 1.1, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    if (root.devicePixelRatio) renderer.setPixelRatio(Math.min(root.devicePixelRatio, 1.25));

    // Graphic/Background.js 모듈을 사용해 배경 색상, 조명, 그리드 구성 + Effect 이펙트 초기화
    const bgRefs = root.BackgroundGraphic?.setupBackground(THREE, scene);
    root.DoubleDamageEffect?.initFloorEffect?.(THREE, bgRefs);
    root.HitSparkEffect?.init?.(THREE, scene);

    // Graphic/Arm.js, Graphic/Body.js, Graphic/Head.js 및 Graphic/Sword.js 모듈을 사용해 양팔, 몸통, 머리(구), 검 메쉬 구성
    const createSwordMesh = (playerId, color, xPos, facingYRad) => {
      const baseGroup = new THREE.Group();
      baseGroup.position.set(xPos, 1.1, 0);
      baseGroup.rotation.y = facingYRad;

      const arm = root.ArmGraphic.createArm(THREE);
      const initialArmOpacity = root.InGameBack?.getArmOpacity?.() ?? currentArmOpacity;
      currentArmOpacity = Number.isFinite(Number(initialArmOpacity))
        ? Math.min(1, Math.max(0, Number(initialArmOpacity)))
        : 1.0;
      arm.setOpacity?.(currentArmOpacity);
      const initialHeadOffsetZ = root.InGameBack?.getHeadOffsetZ?.() ?? currentHeadOffsetZ;
      currentHeadOffsetZ = Number.isFinite(Number(initialHeadOffsetZ)) ? Number(initialHeadOffsetZ) : 0;
      const bodyGroup = root.BodyGraphic?.createBody?.(THREE, color, currentHeadOffsetZ) || null;
      const headGroup = root.HeadGraphic?.createHead?.(THREE, color, currentHeadOffsetZ) || null;
      const swordGroup = root.SwordGraphic.createSword(THREE, color, arm.baseWristOffset);

      if (bodyGroup) {
        arm.armPivot.add(bodyGroup);
      }
      if (headGroup) {
        arm.armPivot.add(headGroup);
      }
      arm.armPivot.add(swordGroup);
      baseGroup.add(arm.armPivot);
      scene.add(baseGroup);
      playerGroups.set(playerId, baseGroup);

      swordGroup.userData = {
        baseGroup,
        armPivot: arm.armPivot,
        bodyGroup,
        headGroup,
        leftForearm: arm.leftForearm,
        rightForearm: arm.rightForearm,
        defaultLimbLen: arm.defaultLimbLen,
        positionLimbBetween: arm.positionLimbBetween,
        updateLimbs: arm.updateLimbs,
        setArmOpacity: arm.setOpacity,
        baseWristOffset: arm.baseWristOffset,
      };
      return swordGroup;
    };

    meshes.set('PLAYER_1', createSwordMesh('PLAYER_1', 0x4fd1a5, -halfDist, -Math.PI / 2));
    meshes.set('PLAYER_2', createSwordMesh('PLAYER_2', 0xf28b66, halfDist, Math.PI / 2));

    root.addEventListener?.('resize', resizeThree);
  }

  function resizeThree() {
    if (!renderer || !cameraP1 || !cameraP2) return;
    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const halfWidth = Math.max(1, Math.floor(width / 2));

    cameraP1.aspect = halfWidth / height;
    cameraP1.updateProjectionMatrix();

    cameraP2.aspect = (width - halfWidth) / height;
    cameraP2.updateProjectionMatrix();

    renderer.setSize(width, height);
  }

  function renderSplitView() {
    if (!renderer || !scene || !cameraP1 || !cameraP2) return;
    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const isMatchEndActive = Boolean(root.EndMatchAnimation?.isActive?.());
    if (isMatchEndActive) {
      root.EndMatchAnimation.updateFrame(width, height);
      root.HitSparkEffect?.update?.();
      setPlayerHeadOpacity('PLAYER_1', 1.0);
      setPlayerHeadOpacity('PLAYER_2', 1.0);
      renderer.setScissorTest?.(false);
      renderer.setViewport?.(0, 0, width, height);
      renderer.render(scene, cameraP1);
      return;
    }

    const isStartSetActive = Boolean(root.StartSetAnimation?.isActive?.());
    const isEndSetActive = Boolean(root.EndSetAnimation?.isActive?.());
    if (isStartSetActive) {
      root.StartSetAnimation.updateFrame();
    } else if (isEndSetActive) {
      root.EndSetAnimation.updateFrame(root.THREE);
    } else {
      updatePlayerFloatPositions();
      if ($('ingame-view')?.classList?.contains?.('lobby-bg-mode')) {
        const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        updateLobbySwordIdle(nowMs);
      }
    }
    root.HitSparkEffect?.update?.();
    const halfWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(1, width - halfWidth);
    const endLoserId = isEndSetActive ? root.EndSetAnimation?.getLoserId?.() : null;
    const p1SelfOpacity = isStartSetActive
      ? (root.StartSetAnimation?.getSelfOpacityForCamera?.('PLAYER_1', currentSelfHeadOpacity) ?? 1.0)
      : (endLoserId === 'PLAYER_1' ? 0 : currentSelfHeadOpacity);
    const p2SelfOpacity = isStartSetActive
      ? (root.StartSetAnimation?.getSelfOpacityForCamera?.('PLAYER_2', currentSelfHeadOpacity) ?? 1.0)
      : (endLoserId === 'PLAYER_2' ? 0 : currentSelfHeadOpacity);

    renderer.setScissorTest?.(true);

    // 좌측 뷰포트 (기본: P1, 화면 전환 시: P2)
    if (!viewsSwapped) {
      setPlayerHeadOpacity('PLAYER_1', p1SelfOpacity);
      setPlayerHeadOpacity('PLAYER_2', 1.0);
      renderer.setViewport?.(0, 0, halfWidth, height);
      renderer.setScissor?.(0, 0, halfWidth, height);
      renderer.render(scene, cameraP1);

      setPlayerHeadOpacity('PLAYER_1', 1.0);
      setPlayerHeadOpacity('PLAYER_2', p2SelfOpacity);
      renderer.setViewport?.(halfWidth, 0, rightWidth, height);
      renderer.setScissor?.(halfWidth, 0, rightWidth, height);
      renderer.render(scene, cameraP2);
    } else {
      setPlayerHeadOpacity('PLAYER_1', 1.0);
      setPlayerHeadOpacity('PLAYER_2', p2SelfOpacity);
      renderer.setViewport?.(0, 0, halfWidth, height);
      renderer.setScissor?.(0, 0, halfWidth, height);
      renderer.render(scene, cameraP2);

      setPlayerHeadOpacity('PLAYER_1', p1SelfOpacity);
      setPlayerHeadOpacity('PLAYER_2', 1.0);
      renderer.setViewport?.(halfWidth, 0, rightWidth, height);
      renderer.setScissor?.(halfWidth, 0, rightWidth, height);
      renderer.render(scene, cameraP1);
    }

    renderer.setScissorTest?.(false);
  }

  function animate() {
    renderSplitView();
    if (typeof root.requestAnimationFrame === 'function') {
      animId = root.requestAnimationFrame(animate);
    }
  }

  // 대기방 뒤에 실시간 3D 게임플레이 화면을 반투명 배경으로 표시
  function showLobbyBackground() {
    const lobbyView = $('lobby-view');
    if (lobbyView && lobbyView.hidden) return;
    const ingameView = $('ingame-view');
    if (ingameView) {
      ingameView.hidden = false;
      ingameView.classList.add('lobby-bg-mode');
    }
    initThree();
    root.InGameDev?.loadConfigDefaults?.();
    applyPlayerDistanceLayout(currentPlayerDistance);
    root.SoundManager?.setBgmState?.('MATCH', 1.0);
    if (!animId && renderer) animate();
  }

  function applyViewsSwappedUI() {
    const splitUi = document.querySelector?.('.ingame-split-ui');
    splitUi?.classList?.toggle?.('is-swapped', viewsSwapped);
  }

  function toggleViewsSwapped(force) {
    viewsSwapped = force !== undefined ? Boolean(force) : !viewsSwapped;
    applyViewsSwappedUI();
    renderSplitView();
    return viewsSwapped;
  }

  function setPauseMenuOpen(open) {
    pauseOpen = Boolean(open);
    const modal = $('pause-modal');
    if (modal) modal.hidden = !pauseOpen;
    root.InGameBack?.setPaused?.(pauseOpen);
    if (pauseOpen) {
      lastPauseStatusRenderMs = 0;
      root.SoundManager?.setHumPlaying?.(false);
    }
    return pauseOpen;
  }

  let lastPauseStatusRenderMs = 0;

  function renderPausePlayerStatus(players = [], rates = new Map()) {
    if (!pauseOpen) return;
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (nowMs - lastPauseStatusRenderMs < 200) return;
    lastPauseStatusRenderMs = nowMs;
    const listEl = $('pause-player-status');
    if (!listEl) return;
    const byId = new Map();
    for (const p of players) {
      if (p && p.id) byId.set(p.id, p);
    }
    listEl.replaceChildren();
    for (const id of ['PLAYER_1', 'PLAYER_2']) {
      const info = byId.get(id);
      const row = document.createElement('div');
      row.className = 'pause-status-row';

      const nameWrap = document.createElement('span');
      nameWrap.className = 'pause-status-name';
      const dot = document.createElement('span');
      dot.className = `pause-status-dot ${id === 'PLAYER_1' ? 'is-p1' : 'is-p2'}`;
      const label = document.createElement('span');
      label.textContent = id === 'PLAYER_1' ? 'PLAYER 1' : 'PLAYER 2';
      nameWrap.append(dot, label);

      const badge = document.createElement('span');
      const isOnline = Boolean(info && (info.state === 'ready' || info.state === 'joined' || info.state === 'open'));
      const rateVal = Number(rates?.get?.(id) || 0);
      badge.className = `pause-status-badge ${isOnline ? 'is-online' : 'is-offline'}`;
      badge.textContent = isOnline
        ? `연결됨 (${rateVal.toFixed(0)}Hz)`
        : (info?.state ? `상태: ${info.state}` : '미연결');

      row.append(nameWrap, badge);
      listEl.append(row);
    }
  }

  function start(onBackToLobby) {
    if ($('lobby-view')) $('lobby-view').hidden = true;
    if ($('ingame-view')) {
      $('ingame-view').hidden = false;
      $('ingame-view').classList.remove('lobby-bg-mode');
    }
    setPauseMenuOpen(false);
    if ($('pause-game-btn')) {
      $('pause-game-btn').onclick = () => setPauseMenuOpen(!pauseOpen);
    }
    if ($('pause-resume-btn')) {
      $('pause-resume-btn').onclick = () => setPauseMenuOpen(false);
    }
    if ($('back-to-lobby')) {
      $('back-to-lobby').onclick = () => {
        setPauseMenuOpen(false);
        onBackToLobby?.();
      };
    }
    const bgmSlider = $('pause-bgm-volume');
    const bgmValEl = $('pause-bgm-volume-val');
    if (bgmSlider) {
      const curBgmMaster = root.SoundManager?.getMasterBgmVolume?.() ?? 100;
      bgmSlider.value = String(curBgmMaster);
      if (bgmValEl) bgmValEl.textContent = `${Math.round(curBgmMaster)}%`;
      bgmSlider.oninput = () => {
        const next = root.SoundManager?.setMasterBgmVolume?.(bgmSlider.value) ?? Number(bgmSlider.value);
        if (bgmValEl) bgmValEl.textContent = `${Math.round(next)}%`;
      };
    }
    const sfxSlider = $('pause-sfx-volume');
    const sfxValEl = $('pause-sfx-volume-val');
    if (sfxSlider) {
      const curMaster = root.SoundManager?.getMasterSfxVolume?.() ?? 100;
      sfxSlider.value = String(curMaster);
      if (sfxValEl) sfxValEl.textContent = `${Math.round(curMaster)}%`;
      sfxSlider.oninput = () => {
        const next = root.SoundManager?.setMasterSfxVolume?.(sfxSlider.value) ?? Number(sfxSlider.value);
        if (sfxValEl) sfxValEl.textContent = `${Math.round(next)}%`;
      };
    }
    if ($('swap-views-btn')) $('swap-views-btn').onclick = () => toggleViewsSwapped();
    if ($('rematch-btn')) {
      $('rematch-btn').onclick = () => {
        root.EndMatchAnimation?.reset?.();
        resizeThree();
        root.InGameBack?.restartMatch?.();
      };
    }
    if ($('match-back-to-lobby-btn')) {
      $('match-back-to-lobby-btn').onclick = onBackToLobby;
    }
    root.SoundManager?.preloadAll?.();
    applyViewsSwappedUI();
    root.InGameDev?.init?.();
    initThree();
    if (!animId && renderer) animate();
  }

  function stop() {
    if (animId && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(animId);
    }
    animId = null;
    cameraFovs.PLAYER_1 = BASE_CAMERA_FOV;
    cameraFovs.PLAYER_2 = BASE_CAMERA_FOV;
    if (cameraP1) {
      cameraP1.fov = BASE_CAMERA_FOV;
      cameraP1.updateProjectionMatrix?.();
    }
    if (cameraP2) {
      cameraP2.fov = BASE_CAMERA_FOV;
      cameraP2.updateProjectionMatrix?.();
    }
    root.DoubleDamageEffect?.reset?.();
    root.HitSparkEffect?.reset?.();
    root.StartSetAnimation?.reset?.();
    root.EndSetAnimation?.reset?.();
    root.EndMatchAnimation?.reset?.();
    root.SoundManager?.stopAll?.();
    setPauseMenuOpen(false);
    lastPhase = '';
    prevPlayerStates.PLAYER_1 = 'IDLE';
    prevPlayerStates.PLAYER_2 = 'IDLE';
    if ($('ingame-view')) $('ingame-view').classList?.remove?.('is-match-end');
    if ($('match-winner-banner')) $('match-winner-banner').hidden = true;
    if ($('match-end-actions')) $('match-end-actions').hidden = true;
    currentArenaShiftX = 0;
    cameraShakeOffsets.PLAYER_1 = { x: 0, y: 0, z: 0 };
    cameraShakeOffsets.PLAYER_2 = { x: 0, y: 0, z: 0 };
    cameraStunPullbacks.PLAYER_1 = 0;
    cameraStunPullbacks.PLAYER_2 = 0;
    for (const id of [
      'p1-danger-glow',
      'p2-danger-glow',
      'p1-set-result',
      'p2-set-result',
      'p1-ready-overlay',
      'p2-ready-overlay',
    ]) {
      if ($(id)) $(id).hidden = true;
    }
    if ($('lobby-view')) $('lobby-view').hidden = false;
    showLobbyBackground();
  }

  // 기본 자세 쿼터니언 (0, 0, 0, 1)에서 목표 쿼터니언 q까지 비율 t만큼 구면 선형 보간(Slerp)
  function slerpFromIdentity(q, t) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    let qx = q.x / len;
    let qy = q.y / len;
    let qz = q.z / len;
    let qw = q.w / len;

    // 최단 경로 회전 보장 (w < 0이면 부호 반전)
    if (qw < 0) {
      qx = -qx;
      qy = -qy;
      qz = -qz;
      qw = -qw;
    }

    if (qw > 0.9995) {
      const lx = qx * t;
      const ly = qy * t;
      const lz = qz * t;
      const lw = 1 - t + qw * t;
      const lLen = Math.hypot(lx, ly, lz, lw) || 1;
      return { x: lx / lLen, y: ly / lLen, z: lz / lLen, w: lw / lLen };
    }

    const theta0 = Math.acos(Math.min(1, Math.max(-1, qw)));
    const sinTheta0 = Math.sin(theta0) || 1;
    const theta = theta0 * t;
    const s0 = Math.cos(theta) - (qw * Math.sin(theta)) / sinTheta0;
    const s1 = Math.sin(theta) / sinTheta0;

    return {
      x: s1 * qx,
      y: s1 * qy,
      z: s1 * qz,
      w: s0 + s1 * qw,
    };
  }

  // 로컬 벡터 v를 쿼터니언 q로 회전시킨 벡터 반환 (현재 검이 향하는 방향 기준 오프셋 계산용)
  function rotateVectorByQuat(v, q) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  function multiplyQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function invertQuat(q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return {
      x: -q.x / len,
      y: -q.y / len,
      z: -q.z / len,
      w: q.w / len,
    };
  }

  // 핸드폰 기본 파지 자세 매핑:
  function mapGripQuaternion(q) {
    // 1) 축 매핑 (둘 다 -를 유지해야 90도 회전 시 축이 뒤바뀌지 않음)
    const mx = -q.z;
    const my = -q.x;
    const mz = -q.y;
    const mw = q.w;

    // 2) Z축 -90도 회전 계산
    const addDegZ = -90;
    const halfRad = (addDegZ * Math.PI) / 180 / 2;
    const s = Math.sin(halfRad);
    const c = Math.cos(halfRad);

    const rx = mx * c + my * s;
    const ry = my * c - mx * s;
    const rz = mz * c + mw * s;
    const rw = mw * c - mz * s;

    // 3) 회전 계산이 끝난 뒤의 결과값(rx, ry, rz)에서 방향 부호만 조절
    return {
      x: rx,
      y: -ry, // <- 여기서 최종 y만 반전시키면 축이 바뀌지 않고 y 방향만 반대가 됩니다!
      z: rz,
      w: rw,
    };
  }

  function updatePose(playerId, data) {
    if (!data) return;
    const tilt = data.tilt || data.rotation_vector;
    if (!tilt) return;

    const rawQ = {
      x: Number(tilt.x) || 0,
      y: Number(tilt.y) || 0,
      z: Number(tilt.z) || 0,
      w: tilt.w !== undefined ? Number(tilt.w) : 1,
    };
    const q = mapGripQuaternion(rawQ);
    receivedAngles.set(playerId, q);

    const mesh = meshes.get(playerId);
    if (!mesh) return;

    const armPivot = mesh.userData?.armPivot;
    const baseWrist = mesh.userData?.baseWristOffset;
    const isDefending = data.state === 'DEFENSE' || data.state === 'STUN_DEFENSE' || data.button === 1;

    if (armPivot && mesh.quaternion?.set) {
      const qLen = Math.hypot(q.x, q.y, q.z, q.w) || 1;
      let qn = { x: q.x / qLen, y: q.y / qLen, z: q.z / qLen, w: q.w / qLen };

      const q0 = mapGripQuaternion({ x: 0, y: 0, z: 0, w: 1 });
      const q0Len = Math.hypot(q0.x, q0.y, q0.z, q0.w) || 1;
      const q0n = { x: q0.x / q0Len, y: q0.y / q0Len, z: q0.z / q0Len, w: q0.w / q0Len };

      const forwardVec = { x: 0, y: 0, z: -1 };
      const baseDir = rotateVectorByQuat(forwardVec, q0n);
      let bladeDir = rotateVectorByQuat(forwardVec, qn);

      const baseArmRadius = Math.abs(baseWrist?.z) || 0.95;

      // 기절(STUN) 상태일 때(단, 기절중 방어 STUN_DEFENSE 제외) 중앙 원 안으로 검이 들어오지 못하고 항상 검끝이 바깥쪽을 향하도록 보정
      const isPureStun = data.state === 'STUN';
      const stunRadius = Number.isFinite(Number(data.stunCircleRadius))
        ? Number(data.stunCircleRadius)
        : (root.InGameBack?.getStunCircleRadius?.() ?? currentStunCircleRadius);
      let stunOutwardAngle = Math.PI / 2;
      if (isPureStun && root.InGameBack?.applyStunCircleConstraint) {
        const constrained = root.InGameBack.applyStunCircleConstraint(
          qn,
          baseDir,
          bladeDir,
          stunRadius,
          baseArmRadius
        );
        qn = constrained.qn;
        bladeDir = constrained.bladeDir;
        if (Number.isFinite(constrained.angle)) {
          stunOutwardAngle = constrained.angle;
        }
      }

      const isStunned = data.state === 'STUN' || data.state === 'STUN_DEFENSE';
      const stunRemaining = isStunned ? Math.max(0, Number(data.stateDuration) || 0) : 0;
      const stunPhase = stunRemaining * 68;
      const stunTremorIntensity = stunRemaining > 0 ? Math.min(1, 0.35 + stunRemaining * 0.65) : 0;

      // 1) 검 회전: 검날은 목표 쿼터니언(qn) 방향을 향하며, 기절 시에는 고주파 떨림 회전(jitter) 추가
      if (stunTremorIntensity > 0) {
        const jx = Math.cos(stunPhase * 2.1) * 0.034 * stunTremorIntensity;
        const jy = Math.sin(stunPhase * 1.9) * 0.034 * stunTremorIntensity;
        const jz = Math.sin(stunPhase * 2.7) * 0.026 * stunTremorIntensity;
        const jq = multiplyQuat(qn, { x: jx, y: jy, z: jz, w: 1 });
        const jqLen = Math.hypot(jq.x, jq.y, jq.z, jq.w) || 1;
        mesh.quaternion.set(jq.x / jqLen, jq.y / jqLen, jq.z / jqLen, jq.w / jqLen);
      } else {
        mesh.quaternion.set(qn.x, qn.y, qn.z, qn.w);
      }

      // 2) 검끝 3D 방향 벡터 기반 양손 위치 이동:
      if (baseWrist && mesh.position?.set) {
        const armMultiplier = Number.isFinite(Number(data.armSwingMultiplier))
          ? Number(data.armSwingMultiplier)
          : (root.InGameBack?.getArmSwingMultiplier?.() ?? 0.55);

        const isAttacking = data.state === 'ATTACK';
        const targetExtension = isAttacking
          ? Math.max(0, Number.isFinite(Number(data.attackArmExtension))
            ? Number(data.attackArmExtension)
            : (root.InGameBack?.getAttackArmExtension?.() ?? currentAttackArmExtension))
          : 0;
        const prevExtension = playerArmExtensions.get(playerId) || 0;
        let currentExtension;
        if (targetExtension >= prevExtension) {
          // 공격 판정으로 팔이 늘어날 때는 즉시 최대 길이로 확장
          currentExtension = targetExtension;
        } else {
          // 공격 이후 팔이 줄어들 때는 감속 보간(Ease-Out)으로 자연스럽게 축소
          const step = Math.max((prevExtension - targetExtension) * ARM_RETRACT_SMOOTHING, 0.005);
          currentExtension = Math.max(targetExtension, prevExtension - step);
        }
        playerArmExtensions.set(playerId, currentExtension);

        const armRadius = Math.max(0.1, baseArmRadius + currentExtension);
        const accelOff = data.accelAimOffset || { x: 0, y: 0 };
        let dx = (bladeDir.x - baseDir.x) * armRadius * armMultiplier + (Number(accelOff.x) || 0);
        let dy = (bladeDir.y - baseDir.y) * armRadius * armMultiplier + (Number(accelOff.y) || 0);

        // 기절(STUN) 시 손잡이(손목) 위치도 중앙 진입금지 원 바깥에서 검끝과 동일한 방사형 바깥 각도(stunOutwardAngle)로 정렬
        if (isPureStun) {
          const minWristR = Math.min(armRadius * 0.9, Math.max(0, stunRadius));
          const wristDist = Math.max(Math.hypot(dx, dy), minWristR);
          dx = Math.cos(stunOutwardAngle) * wristDist;
          dy = Math.sin(stunOutwardAngle) * wristDist;
        }

        const xySq = Math.min(armRadius * armRadius * 0.92, dx * dx + dy * dy);

        let wx = baseWrist.x + dx;
        let wy = baseWrist.y + dy;
        let wz = -Math.sqrt(Math.max(0.04, armRadius * armRadius - xySq));

        if (stunTremorIntensity > 0) {
          wx += Math.sin(stunPhase * 1.7) * 0.028 * stunTremorIntensity;
          wy += Math.cos(stunPhase * 2.3) * 0.028 * stunTremorIntensity;
          wz += Math.sin(stunPhase * 1.3) * 0.016 * stunTremorIntensity;
        }

        // 팔(손목) 위치는 원래 길이대로 앞쪽에 유지하고, 방어 시에는 검만 검 손잡이 방향(+Z)으로 이동
        let sx = wx;
        let sy = wy;
        let sz = wz;
        if (isDefending) {
          const defenseOffsetZ = Number.isFinite(Number(data.defenseSwordOffset))
            ? Number(data.defenseSwordOffset)
            : (root.InGameBack?.getDefenseSwordOffset?.() ?? currentDefenseSwordOffset);
          const shift = rotateVectorByQuat(
            { x: DEFENSE_HAND_OFFSET.x, y: DEFENSE_HAND_OFFSET.y, z: defenseOffsetZ },
            qn
          );
          sx += shift.x;
          sy += shift.y;
          sz += shift.z;
        }

        if (stunTremorIntensity > 0) {
          sx += Math.sin(stunPhase * 2.4) * 0.022 * stunTremorIntensity;
          sy += Math.cos(stunPhase * 2.9) * 0.022 * stunTremorIntensity;
        }

        mesh.position.set(sx, sy, sz);
        mesh.userData?.updateLimbs?.(wx, wy, wz);
      }

      // 0) 검 정렬 키(button === 2) 입력 시 reset 효과음 랜덤 재생 & ATTACK 진입 시 swing 효과음 랜덤 재생
      const alignTs = Number(data.lastAlignTimestamp) || 0;
      if (alignTs > 0 && lastAlignTimestamps[playerId] !== alignTs) {
        lastAlignTimestamps[playerId] = alignTs;
        root.SoundManager?.playRandom?.('reset');
      }
      const curState = data.state || 'IDLE';
      if (curState === 'ATTACK' && prevPlayerStates[playerId] !== 'ATTACK') {
        root.SoundManager?.playRandom?.('swing');
      }
      prevPlayerStates[playerId] = curState;

      // 3) 피격(HIT) 시 고무줄을 당겼다 놓듯 피격 방향으로 빠르게 튕긴 뒤 정점에서 잠깐 멈췄다가 빠르게 원위치로 복귀
      //    + 몸통은 피격 방향으로 살짝 기울어지고 머리는 중심에서 피격 방향으로 살짝 회전
      const headGroup = mesh.userData?.headGroup;
      const bodyGroup = mesh.userData?.bodyGroup;
      const isHit = data.state === 'HIT' && Number(data.stateDuration) > 0;
      headGroup?.userData?.setEyeExpression?.(isHit ? 'HIT' : 'NORMAL');
      let hitCamFactor = 0;
      if (isHit && data.hitImpact) {
        const hitTs = Number(data.hitImpact.timestamp) || 0;
        if (hitTs > 0 && lastHitTimestamps[playerId] !== hitTs) {
          lastHitTimestamps[playerId] = hitTs;
          const fallbackPt = data.headCollider?.center || { x: 0, y: 1.4, z: 0 };
          root.HitSparkEffect?.spawn?.(data.hitImpact.worldPoint || fallbackPt, data.hitImpact.worldDir);
          root.SoundManager?.playRandom?.('hit');
        }
        const totalDur = Math.max(0.05, Number(data.hitImpact.totalDuration) || 1.0);
        const remaining = Math.max(0, Number(data.stateDuration) || 0);
        // 피격 유지시간(0 -> totalDur)에 정확히 동기화된 진행률 p (0.0 ~ 1.0)
        const p = Math.min(1, Math.max(0, (totalDur - remaining) / totalDur));
        const snapOutEnd = 0.14;  // 0% ~ 14%: 피격 방향으로 빠르게 확 이동
        const holdEnd = 0.58;     // 14% ~ 58%: 정점에서 잠깐 멈춰 버팀
        let hitMotion;
        if (p < snapOutEnd) {
          const u = p / snapOutEnd;
          hitMotion = 1 - Math.pow(1 - u, 3); // 빠른 Ease-Out
        } else if (p < holdEnd) {
          hitMotion = 1.0; // 끝에서 잠깐 정지
        } else {
          const u = (p - holdEnd) / (1 - holdEnd);
          hitMotion = 1 - Math.pow(u, 2.4); // 고무줄 놓듯 가속하며 빠르게 복귀
        }
        hitCamFactor = hitMotion;

        const lDir = data.hitImpact.localDir || { x: 0, y: 0, z: 1 };
        const wDir = data.hitImpact.worldDir || { x: 0, y: 0, z: 0 };

        headGroup?.userData?.setShakeOffset?.(
          lDir.x * hitMotion * 0.55,
          lDir.y * hitMotion * 0.55,
          lDir.z * hitMotion * 0.55
        );
        bodyGroup?.userData?.setShakeOffset?.(
          lDir.x * hitMotion * 0.55,
          lDir.y * hitMotion * 0.55,
          lDir.z * hitMotion * 0.55
        );
        // 몸통은 피격 방향으로 살짝 기울임 (+Z 뒤쪽 -> +rotX, +X 오른쪽 -> -rotZ)
        bodyGroup?.userData?.setRotationOffset?.(
          lDir.z * hitMotion * 0.26,
          -lDir.x * hitMotion * 0.12,
          -lDir.x * hitMotion * 0.26
        );
        // 머리는 중심에서 피격 방향으로 살짝 회전 (좌우 타격 시 고개가 피격 방향으로 꺾이고, 앞뒤/상하 타격 시 고개가 젖혀짐)
        headGroup?.userData?.setRotationOffset?.(
          (lDir.z * 0.38 + lDir.y * 0.42) * hitMotion,
          -lDir.x * hitMotion * 0.48,
          -lDir.x * hitMotion * 0.22
        );
        //카메라 흔들림 조정
        cameraShakeOffsets[playerId] = {
          x: wDir.x * hitCamFactor * 0.7,
          y: wDir.y * hitCamFactor * 0.7,
          z: wDir.z * hitCamFactor * 0.7,
        };
      } else {
        headGroup?.userData?.setShakeOffset?.(0, 0, 0);
        bodyGroup?.userData?.setShakeOffset?.(0, 0, 0);
        cameraShakeOffsets[playerId] = { x: 0, y: 0, z: 0 };
      }

      // 4) 피격(HIT) 및 기절(STUN, STUN_DEFENSE) 시 카메라 후방 밀림 적용
      if (isHit) {
        // 피격 시에는 피격 방향 이동(hitCamFactor)과 동일한 비율로 동시에 밀렸다가 한 번에 직선 복귀
        cameraStunPullbacks[playerId] = HIT_CAMERA_PULLBACK_MAX * hitCamFactor;
      } else {
        const prevPullback = Number(cameraStunPullbacks[playerId]) || 0;
        const targetPullback = isStunned && Number(data.stateDuration) > 0
          ? STUN_CAMERA_PULLBACK_MAX
          : 0;
        if (targetPullback > prevPullback) {
          cameraStunPullbacks[playerId] = prevPullback + (targetPullback - prevPullback) * 0.35;
        } else {
          const step = Math.max((prevPullback - targetPullback) * 0.14, 0.005);
          cameraStunPullbacks[playerId] = Math.max(0, prevPullback - step);
        }

        // 기절(STUN, STUN_DEFENSE) 시에는 뒤쪽(+Z) 방향으로 몸이 살짝 기울어지고 머리가 중심에서 뒤로 살짝 회전
        const stunTiltFactor = STUN_CAMERA_PULLBACK_MAX > 0
          ? Math.min(1, Math.max(0, cameraStunPullbacks[playerId] / STUN_CAMERA_PULLBACK_MAX))
          : 0;
        if (stunTiltFactor > 0.001) {
          const wobble = stunTremorIntensity > 0 ? Math.sin(stunPhase * 1.4) * 0.025 * stunTremorIntensity : 0;
          bodyGroup?.userData?.setRotationOffset?.(0.24 * stunTiltFactor, 0, wobble);
          headGroup?.userData?.setRotationOffset?.(0.36 * stunTiltFactor, wobble * 0.8, wobble);
        } else {
          bodyGroup?.userData?.setRotationOffset?.(0, 0, 0);
          headGroup?.userData?.setRotationOffset?.(0, 0, 0);
        }
      }

      // 5) 공격(ATTACK) 판정 시 본인 카메라 시야각(FOV)을 순간적으로 좁혔다가 복귀시켜 타격감 강조
      const cam = playerId === 'PLAYER_1' ? cameraP1 : (playerId === 'PLAYER_2' ? cameraP2 : null);
      if (cam && !root.StartSetAnimation?.isActive?.() && !root.EndSetAnimation?.isActive?.()) {
        const isAttackFov = data.state === 'ATTACK' && Number(data.stateDuration) > 0;
        const targetFov = isAttackFov ? ATTACK_CAMERA_FOV : BASE_CAMERA_FOV;
        const prevFov = Number(cameraFovs[playerId]) || BASE_CAMERA_FOV;
        const rate = targetFov < prevFov ? 0.42 : 0.16; // 좁아질 때는 빠르게, 복귀할 때는 부드럽게
        let nextFov = prevFov + (targetFov - prevFov) * rate;
        if (Math.abs(targetFov - nextFov) < 0.05) {
          nextFov = targetFov;
        }
        cameraFovs[playerId] = nextFov;
        if (Math.abs((Number(cam.fov) || BASE_CAMERA_FOV) - nextFov) > 0.01) {
          cam.fov = nextFov;
          cam.updateProjectionMatrix?.();
        }
      }

      applyPlayerDistanceLayout(currentPlayerDistance);
    } else if (mesh.quaternion?.set) {
      mesh.quaternion.set(q.x, q.y, q.z, q.w).normalize();
    }
  }

  function renderSetUI() {
    const setInfo = root.InGameBack?.getSetState?.();
    if (!setInfo) return;

    // 0) 세트 시작 인트로(INTRO) 및 종료 피니시(RESULT) 애니메이션 동기화
    const wasEndSetActive = Boolean(root.EndSetAnimation?.isActive?.());
    root.EndSetAnimation?.syncSetState?.(setInfo, {
      playerGroups,
      meshes,
      cameraP1,
      cameraP2,
      receivedPlayerInfo,
    });
    const isEndSetActive = Boolean(root.EndSetAnimation?.isActive?.());

    const wasStartSetActive = Boolean(root.StartSetAnimation?.isActive?.());
    root.StartSetAnimation?.syncSetState?.(setInfo, {
      playerGroups,
      meshes,
      cameraP1,
      cameraP2,
      playerDistance: currentPlayerDistance,
      cameraBackOffset: currentCameraBackOffset,
      cameraHeight: currentCameraHeight,
      cameraLookForward: CAMERA_LOOK_FORWARD,
      selfHeadOpacity: currentSelfHeadOpacity,
      armOpacity: currentArmOpacity,
    });
    const isStartSetActive = Boolean(root.StartSetAnimation?.isActive?.());
    root.StartSetAnimation?.updateReadyFightCue?.(setInfo);

    const wasMatchEndActive = Boolean(root.EndMatchAnimation?.isActive?.());
    root.EndMatchAnimation?.syncSetState?.(setInfo, {
      playerGroups,
      meshes,
      cameraP1,
      armOpacity: currentArmOpacity,
    });
    const isMatchEndActive = Boolean(root.EndMatchAnimation?.isActive?.());

    if ((wasEndSetActive && !isEndSetActive) || (wasStartSetActive && !isStartSetActive) || (wasMatchEndActive && !isMatchEndActive)) {
      if (!isStartSetActive && !isEndSetActive && !isMatchEndActive) {
        // 애니메이션 종료 직후 분할 화면 비율 및 카메라/플레이어 위치 즉시 복구
        resizeThree();
        applyPlayerDistanceLayout(currentPlayerDistance);
      }
    }

    // 0-1) 중앙 상단 5판 3선승제 승점 불빛 & 매치 종료 통합 화면 UI 갱신 (변경 시에만 DOM 갱신)
    const p1Score = Number(setInfo.scores?.PLAYER_1) || 0;
    const p2Score = Number(setInfo.scores?.PLAYER_2) || 0;
    const curSetNum = Number(setInfo.setNumber) || 1;
    const nextScoreKey = `${p1Score}:${p2Score}:${curSetNum}`;
    if (nextScoreKey !== lastScoreKey) {
      lastScoreKey = nextScoreKey;
      if (!cachedScoreDots && typeof document !== 'undefined') {
        cachedScoreDots = document.querySelectorAll?.('.score-dot') || [];
      }
      for (const dot of cachedScoreDots || []) {
        const pId = dot.dataset?.player;
        const idx = Number(dot.dataset?.index) || 0;
        const score = pId === 'PLAYER_1' ? p1Score : p2Score;
        dot.classList?.toggle?.('is-lit', idx > 0 && idx <= score);
      }
      if ($('score-round-label')) {
        $('score-round-label').textContent = `R${curSetNum}`;
      }
    }

    const ingameView = $('ingame-view');
    ingameView?.classList?.toggle?.('is-match-end', isMatchEndActive);
    const winnerBanner = $('match-winner-banner');
    const endActions = $('match-end-actions');
    if (winnerBanner) {
      winnerBanner.hidden = !isMatchEndActive;
      if (isMatchEndActive) {
        const mw = setInfo.matchWinner;
        winnerBanner.classList?.toggle?.('is-p2', mw === 'PLAYER_2');
        if ($('match-winner-name')) {
          $('match-winner-name').textContent = mw === 'PLAYER_2' ? 'PLAYER 2' : 'PLAYER 1';
        }
        if ($('match-winner-score')) {
          $('match-winner-score').textContent = `${p1Score} : ${p2Score}`;
        }
      }
    }
    if (endActions) {
      endActions.hidden = !isMatchEndActive;
    }

    // 1) 세트 밀어내기 위치 부드럽게 보간 (때리면 앞으로 전진, 맞으면 뒤로 후퇴, 리셋 시 중앙으로 복귀)
    const stepDist = Number.isFinite(Number(setInfo.stepDistance)) ? Number(setInfo.stepDistance) : 1.1;
    const targetShiftX = (Number(setInfo.balance) || 0) * stepDist;
    const diff = targetShiftX - currentArenaShiftX;
    if (Math.abs(diff) < 0.004) {
      currentArenaShiftX = targetShiftX;
    } else {
      currentArenaShiftX += diff * 0.16;
    }
    applyPlayerDistanceLayout(currentPlayerDistance);

    // 2) 패배까지 한 대 남았을 때(현재 데미지 배수 기준 1타 남음) 화면 하단 빨간 경고 표시
    const dmgStep = Math.max(1, Number(setInfo.damageMultiplier) || 1);
    const warnThreshold = Math.max(1, (Number(setInfo.maxSteps) || 4) - dmgStep);
    const p1Danger = !setInfo.winner && setInfo.balance <= -warnThreshold;
    const p2Danger = !setInfo.winner && setInfo.balance >= warnThreshold;
    if ($('p1-danger-glow')) $('p1-danger-glow').hidden = !p1Danger;
    if ($('p2-danger-glow')) $('p2-danger-glow').hidden = !p2Danger;

    // 2-1) 데미지 2배 카운트다운 및 바닥/화면 오오라 이펙트 갱신
    root.DoubleDamageEffect?.update?.(setInfo);

    // 2-2) 방어 성공 / 패리 시 검 충돌 지점 불똥 파티클 및 hit 효과음 발생
    const clash = setInfo.lastClashEffect;
    if (clash && clash.timestamp && clash.timestamp !== lastClashTimestamp) {
      lastClashTimestamp = clash.timestamp;
      root.HitSparkEffect?.spawn?.(clash.worldPoint, clash.worldDir);
      root.SoundManager?.playRandom?.('hit');
    }

    // 2-3) 게임 중 hum 루프 출력, 라운드 패배(RESULT) 시 lose 효과음 출력 및 BGM 상태(matchBgm -> mainBgm, 서든데스 1.3배속) 동기화
    const shouldPlayHum = Boolean(setInfo.phase === 'PLAYING' && !setInfo.winner && !pauseOpen);
    root.SoundManager?.setHumPlaying?.(shouldPlayHum);
    if (setInfo.phase === 'RESULT' && lastPhase !== 'RESULT') {
      root.SoundManager?.playRandom?.('lose');
    }
    lastPhase = setInfo.phase || '';

    const setNum = Number(setInfo.setNumber) || 1;
    let bgmMode = 'MAIN';
    if (setInfo.phase === 'MATCH_END') {
      bgmMode = 'WIN';
    } else if (setNum === 1 && (setInfo.phase === 'INTRO' || setInfo.phase === 'READY')) {
      bgmMode = 'MATCH';
    }
    const bgmRate = (setInfo.phase === 'PLAYING' && setInfo.isDoubleDamage && !setInfo.winner) ? 1.3 : 1.0;
    root.SoundManager?.setBgmState?.(bgmMode, bgmRate);

    // 3) 세트 시작 준비(영점 정렬) 안내 오버레이 표시 + 중앙 화면 전환 버튼 상시 노출 여부 갱신
    const isReadyPhase = setInfo.phase === 'READY';
    const swapZone = $('swap-views-zone');
    swapZone?.classList?.toggle?.('is-ready-visible', isReadyPhase);
    const p1ReadyOverlay = $('p1-ready-overlay');
    const p2ReadyOverlay = $('p2-ready-overlay');
    if (p1ReadyOverlay) p1ReadyOverlay.hidden = !isReadyPhase;
    if (p2ReadyOverlay) p2ReadyOverlay.hidden = !isReadyPhase;
    if (isReadyPhase) {
      const p1Done = Boolean(setInfo.ready?.PLAYER_1);
      const p2Done = Boolean(setInfo.ready?.PLAYER_2);
      const p1Status = $('p1-ready-status');
      const p2Status = $('p2-ready-status');
      if (p1Status) {
        p1Status.textContent = p1Done ? '준비 완료! 상대방 대기 중...' : '볼륨 업 키 입력 대기 중...';
        p1Status.className = p1Done ? 'ready-status is-ready' : 'ready-status';
      }
      if (p2Status) {
        p2Status.textContent = p2Done ? '준비 완료! 상대방 대기 중...' : '볼륨 업 키 입력 대기 중...';
        p2Status.className = p2Done ? 'ready-status is-ready' : 'ready-status';
      }
    }

    // 4) 세트 승패 시 양쪽 화면에 WIN / LOSE 배너 표시
    const p1Banner = $('p1-set-result');
    const p2Banner = $('p2-set-result');
    if (setInfo.winner === 'PLAYER_1') {
      if (p1Banner) {
        p1Banner.textContent = 'WIN';
        p1Banner.className = 'split-result-banner split-result-left is-win';
        p1Banner.hidden = false;
      }
      if (p2Banner) {
        p2Banner.textContent = 'LOSE';
        p2Banner.className = 'split-result-banner split-result-right is-lose';
        p2Banner.hidden = false;
      }
    } else if (setInfo.winner === 'PLAYER_2') {
      if (p1Banner) {
        p1Banner.textContent = 'LOSE';
        p1Banner.className = 'split-result-banner split-result-left is-lose';
        p1Banner.hidden = false;
      }
      if (p2Banner) {
        p2Banner.textContent = 'WIN';
        p2Banner.className = 'split-result-banner split-result-right is-win';
        p2Banner.hidden = false;
      }
    } else {
      if (p1Banner) p1Banner.hidden = true;
      if (p2Banner) p2Banner.hidden = true;
    }
  }

  let cachedScoreDots = null;
  let lastScoreKey = '';

  function updateGraphics(playerData) {
    if (!playerData || typeof playerData !== 'object') return;
    for (const [playerId, info] of Object.entries(playerData)) {
      if (info && typeof info === 'object') {
        receivedPlayerInfo.set(playerId, info);
      }
      updatePose(playerId, info);
    }
    renderSetUI();
    root.InGameDev?.renderFrontalSwordHud?.(receivedPlayerInfo);
    // requestAnimationFrame(animate) 루프가 이미 돌고 있으면 중복 WebGL 렌더링 방지
    if (!animId) {
      renderSplitView();
    }
  }

  function renderPackets(players, rates) {
    root.InGameDev?.renderPackets?.(players, rates, receivedPlayerInfo, receivedAngles);
  }

  root.InGameFront = {
    start,
    stop,
    showLobbyBackground,
    updatePose,
    updateGraphics,
    setPlayerDistance,
    getPlayerDistance: () => currentPlayerDistance,
    setCameraOffset,
    getCameraOffset: () => ({ back: currentCameraBackOffset, height: currentCameraHeight }),
    setSelfHeadOpacity,
    getSelfHeadOpacity: () => currentSelfHeadOpacity,
    setArmOpacity,
    getArmOpacity: () => currentArmOpacity,
    setHeadOffsetZ,
    getHeadOffsetZ: () => currentHeadOffsetZ,
    setHeadHitboxSize,
    getHeadHitboxSize: () => ({ ...currentHeadHitboxSize }),
    setAttackArmExtension,
    getAttackArmExtension: () => currentAttackArmExtension,
    setDefenseSwordOffset,
    getDefenseSwordOffset: () => currentDefenseSwordOffset,
    setStunCircleRadius,
    getStunCircleRadius: () => currentStunCircleRadius,
    toggleViewsSwapped,
    isViewsSwapped: () => viewsSwapped,
    setPauseMenuOpen,
    renderPausePlayerStatus,
    renderPackets,
    renderFrontalSwordHud: () => root.InGameDev?.renderFrontalSwordHud?.(receivedPlayerInfo),
    toggleFrontalSwordHud: (forceOpen) => root.InGameDev?.toggleFrontalSwordHud?.(forceOpen),
    toggleOverlay: () => root.InGameDev?.toggleOverlay?.(),
    toggleDurationPanel: (forceOpen) => root.InGameDev?.toggleDurationPanel?.(forceOpen),
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showLobbyBackground);
    } else {
      setTimeout(showLobbyBackground, 0);
    }
  }
})(globalThis);