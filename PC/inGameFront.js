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
  let currentHeadOffsetZ = 0.0;
  let currentHeadHitboxSize = { x: 0.88, y: 0.88, z: 0.88 };
  let currentAttackArmExtension = 0.65;
  let currentDefenseSwordOffset = 1.2;
  let currentDefenseAngleThreshold = 35;
  let currentStunCircleRadius = 0.55;
  const STUN_CAMERA_PULLBACK_MAX = 0.55;
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

  function applyPlayerDistanceLayout(distance = currentPlayerDistance) {
    const num = Number(distance);
    if (Number.isFinite(num) && num > 0) {
      currentPlayerDistance = num;
    }
    const halfDist = currentPlayerDistance / 2;

    const p1Group = playerGroups.get('PLAYER_1');
    if (p1Group?.position?.set) {
      p1Group.position.set(-halfDist, 1.1, 0);
    }
    const p2Group = playerGroups.get('PLAYER_2');
    if (p2Group?.position?.set) {
      p2Group.position.set(halfDist, 1.1, 0);
    }

    const shake1 = cameraShakeOffsets.PLAYER_1 || { x: 0, y: 0, z: 0 };
    const shake2 = cameraShakeOffsets.PLAYER_2 || { x: 0, y: 0, z: 0 };
    const stunBack1 = Number(cameraStunPullbacks.PLAYER_1) || 0;
    const stunBack2 = Number(cameraStunPullbacks.PLAYER_2) || 0;

    // 카메라 시선 각도(pitch)를 일정하게 유지하고 피격 흔들림(shake) 및 기절 시 카메라가 뒤로 살짝 빠지는 효과(stunBack)를 반영
    if (cameraP1) {
      const cam1X = -halfDist - currentCameraBackOffset - stunBack1;
      cameraP1.position?.set(cam1X + shake1.x, currentCameraHeight + shake1.y, shake1.z);
      cameraP1.lookAt?.(cam1X + CAMERA_LOOK_FORWARD + shake1.x * 0.6, 1.1 + shake1.y * 0.6, shake1.z * 0.6);
    }
    if (cameraP2) {
      const cam2X = halfDist + currentCameraBackOffset + stunBack2;
      cameraP2.position?.set(cam2X + shake2.x, currentCameraHeight + shake2.y, shake2.z);
      cameraP2.lookAt?.(cam2X - CAMERA_LOOK_FORWARD + shake2.x * 0.6, 1.1 + shake2.y * 0.6, shake2.z * 0.6);
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
    headGroup?.userData?.setOpacity?.(opacity);
  }

  function setSelfHeadOpacity(opacity) {
    const num = Number(opacity);
    if (Number.isFinite(num)) {
      currentSelfHeadOpacity = Math.min(1, Math.max(0, num));
    }
    renderSplitView();
    return currentSelfHeadOpacity;
  }

  function setHeadOffsetZ(offsetZ) {
    const num = Number(offsetZ);
    if (Number.isFinite(num)) {
      currentHeadOffsetZ = num;
    }
    for (const mesh of meshes.values()) {
      const headGroup = mesh?.userData?.headGroup;
      headGroup?.userData?.setOffsetZ?.(currentHeadOffsetZ);
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
    renderFrontalSwordHud();
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

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    if (root.devicePixelRatio) renderer.setPixelRatio(Math.min(root.devicePixelRatio, 2));

    // Graphic/Background.js 모듈을 사용해 배경 색상, 조명, 그리드 구성
    root.BackgroundGraphic?.setupBackground(THREE, scene);

    // Graphic/Arm.js, Graphic/Head.js 및 Graphic/Sword.js 모듈을 사용해 양팔, 머리(구), 검 메쉬 구성
    const createSwordMesh = (playerId, color, xPos, facingYRad) => {
      const baseGroup = new THREE.Group();
      baseGroup.position.set(xPos, 1.1, 0);
      baseGroup.rotation.y = facingYRad;

      const arm = root.ArmGraphic.createArm(THREE);
      const initialHeadOffsetZ = root.InGameBack?.getHeadOffsetZ?.() ?? currentHeadOffsetZ;
      currentHeadOffsetZ = Number.isFinite(Number(initialHeadOffsetZ)) ? Number(initialHeadOffsetZ) : 0;
      const headGroup = root.HeadGraphic?.createHead?.(THREE, color, currentHeadOffsetZ) || null;
      const swordGroup = root.SwordGraphic.createSword(THREE, color, arm.baseWristOffset);

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
        headGroup,
        leftForearm: arm.leftForearm,
        rightForearm: arm.rightForearm,
        defaultLimbLen: arm.defaultLimbLen,
        positionLimbBetween: arm.positionLimbBetween,
        updateLimbs: arm.updateLimbs,
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
    const halfWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(1, width - halfWidth);

    renderer.setScissorTest?.(true);

    // 좌측: 플레이어 1 화면 (본인 PLAYER_1 머리는 설정된 불투명도 적용, 상대 PLAYER_2 머리는 1.0)
    setPlayerHeadOpacity('PLAYER_1', currentSelfHeadOpacity);
    setPlayerHeadOpacity('PLAYER_2', 1.0);
    renderer.setViewport?.(0, 0, halfWidth, height);
    renderer.setScissor?.(0, 0, halfWidth, height);
    renderer.render(scene, cameraP1);

    // 우측: 플레이어 2 화면 (본인 PLAYER_2 머리는 설정된 불투명도 적용, 상대 PLAYER_1 머리는 1.0)
    setPlayerHeadOpacity('PLAYER_1', 1.0);
    setPlayerHeadOpacity('PLAYER_2', currentSelfHeadOpacity);
    renderer.setViewport?.(halfWidth, 0, rightWidth, height);
    renderer.setScissor?.(halfWidth, 0, rightWidth, height);
    renderer.render(scene, cameraP2);

    renderer.setScissorTest?.(false);
  }

  function animate() {
    renderSplitView();
    if (typeof root.requestAnimationFrame === 'function') {
      animId = root.requestAnimationFrame(animate);
    }
  }

  function toggleOverlay() {
    const overlay = $('ingame-overlay');
    if (!overlay) return false;
    overlay.hidden = !overlay.hidden;
    return !overlay.hidden;
  }

  function toggleFrontalSwordHud(forceOpen) {
    const hud = $('frontal-sword-hud');
    if (!hud) return false;
    const willOpen = forceOpen !== undefined ? Boolean(forceOpen) : Boolean(hud.hidden);
    hud.hidden = !willOpen;
    if (willOpen) {
      renderFrontalSwordHud();
    }
    return willOpen;
  }

  function buildFrontalSvgMarkup(ownSeg, oppSeg, ownColor, oppColor, mirrorX = false, headBox = { x: 0, y: 0.44, width: 0.88, height: 0.88 }) {
    const signX = mirrorX ? -1 : 1;
    const ox1 = ((ownSeg?.handle?.x || 0) * signX).toFixed(2);
    const oy1 = (-(ownSeg?.handle?.y || 0)).toFixed(2);
    const ox2 = ((ownSeg?.tip?.x || 0) * signX).toFixed(2);
    const oy2 = (-(ownSeg?.tip?.y || 0)).toFixed(2);

    const tx1 = ((oppSeg?.handle?.x || 0) * signX).toFixed(2);
    const ty1 = (-(oppSeg?.handle?.y || 0)).toFixed(2);
    const tx2 = ((oppSeg?.tip?.x || 0) * signX).toFixed(2);
    const ty2 = (-(oppSeg?.tip?.y || 0)).toFixed(2);

    const bw = Number(headBox?.width ?? 0.88);
    const bh = Number(headBox?.height ?? 0.88);
    const cx = Number(headBox?.x || 0) * signX;
    const cy = -Number(headBox?.y ?? 0.44);
    const rx = (cx - bw / 2).toFixed(2);
    const ry = (cy - bh / 2).toFixed(2);

    return [
      '<svg viewBox="-2.6 -2.6 5.2 5.2" role="img" aria-label="정면 검 선분 및 머리 직육면체 히트박스">',
      '<line x1="-2.6" y1="0" x2="2.6" y2="0" stroke="rgba(255,255,255,0.12)" stroke-width="0.04"/>',
      '<line x1="0" y1="-2.6" x2="0" y2="2.6" stroke="rgba(255,255,255,0.12)" stroke-width="0.04"/>',
      `<rect x="${rx}" y="${ry}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.45)" stroke-width="0.05" stroke-dasharray="0.12 0.08"/>`,
      `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${oppColor}" stroke-width="0.11" stroke-linecap="round" stroke-opacity="0.55" stroke-dasharray="0.18 0.12"/>`,
      `<circle cx="${tx1}" cy="${ty1}" r="0.13" fill="${oppColor}" fill-opacity="0.55"/>`,
      `<line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="${ownColor}" stroke-width="0.16" stroke-linecap="round"/>`,
      `<circle cx="${ox1}" cy="${oy1}" r="0.18" fill="#d9a441" stroke="${ownColor}" stroke-width="0.06"/>`,
      `<circle cx="${ox2}" cy="${oy2}" r="0.1" fill="#ffffff"/>`,
      '</svg>',
    ].join('');
  }

  function renderFrontalSwordHud() {
    const hud = $('frontal-sword-hud');
    if (!hud || hud.hidden) return;

    const p1 = receivedPlayerInfo.get('PLAYER_1') || root.InGameBack?.getPlayerData?.('PLAYER_1');
    const p2 = receivedPlayerInfo.get('PLAYER_2') || root.InGameBack?.getPlayerData?.('PLAYER_2');
    const seg1 = p1?.frontalSegment || p1?.swordCollider?.frontalSegment || { handle: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };
    const seg2 = p2?.frontalSegment || p2?.swordCollider?.frontalSegment || { handle: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };

    const angleDeg = root.InGameBack?.computeFrontalSwordAngleDeg?.(p1, p2);
    const thresh = root.InGameBack?.getDefenseAngleThreshold?.() ?? currentDefenseAngleThreshold;
    const angleText = angleDeg !== null && angleDeg !== undefined
      ? `두 검 각도: ${Number(angleDeg).toFixed(1)}° (방어기준 90°±${thresh}°)`
      : `두 검 각도: — (방어기준 90°±${thresh}°)`;

    const p1State = p1?.state || 'IDLE';
    const p1Dur = Number(p1?.stateDuration || 0).toFixed(2);
    const p2State = p2?.state || 'IDLE';
    const p2Dur = Number(p2?.stateDuration || 0).toFixed(2);

    const boxSize = root.InGameBack?.getHeadHitboxSize?.() ?? currentHeadHitboxSize;
    const defaultBoxW = Number(boxSize.x) > 0 ? Number(boxSize.x) : 0.88;
    const defaultBoxH = Number(boxSize.y) > 0 ? Number(boxSize.y) : 0.88;
    const defaultCenterY = 0.88 - defaultBoxH / 2;
    const headBox1 = {
      x: p1?.headCollider?.frontalCenter?.x ?? 0,
      y: p1?.headCollider?.frontalCenter?.y ?? defaultCenterY,
      width: p1?.headCollider?.size?.x ?? defaultBoxW,
      height: p1?.headCollider?.size?.y ?? defaultBoxH,
    };
    const headBox2 = {
      x: p2?.headCollider?.frontalCenter?.x ?? 0,
      y: p2?.headCollider?.frontalCenter?.y ?? defaultCenterY,
      width: p2?.headCollider?.size?.x ?? defaultBoxW,
      height: p2?.headCollider?.size?.y ?? defaultBoxH,
    };

    if ($('frontal-svg-p1')) {
      $('frontal-svg-p1').innerHTML = buildFrontalSvgMarkup(seg1, seg2, '#4fd1a5', '#f28b66', false, headBox1);
    }
    if ($('frontal-svg-p2')) {
      $('frontal-svg-p2').innerHTML = buildFrontalSvgMarkup(seg2, seg1, '#f28b66', '#4fd1a5', true, headBox2);
    }
    if ($('frontal-state-p1')) $('frontal-state-p1').textContent = `상태: ${p1State} (${p1Dur}s)`;
    if ($('frontal-state-p2')) $('frontal-state-p2').textContent = `상태: ${p2State} (${p2Dur}s)`;
    if ($('frontal-angle-p1')) $('frontal-angle-p1').textContent = angleText;
    if ($('frontal-angle-p2')) $('frontal-angle-p2').textContent = angleText;
  }

  function syncDurationInputs() {
    const dur = root.InGameBack?.JUDGMENT_DURATION;
    if (dur) {
      if ($('dur-attack')) $('dur-attack').value = String(dur.ATTACK ?? 0.5);
      if ($('dur-attack-hit')) $('dur-attack-hit').value = String(dur.ATTACK_SUCCESS_HIT ?? 1.0);
      if ($('dur-attack-fail')) $('dur-attack-fail').value = String(dur.ATTACK_FAIL_STUN ?? 1.0);
      if ($('dur-parry-stun')) $('dur-parry-stun').value = String(dur.PARRY_STUN ?? 1.0);
    }
    const mult = root.InGameBack?.getArmSwingMultiplier?.();
    if (mult !== undefined && $('arm-swing-multiplier')) {
      $('arm-swing-multiplier').value = String(mult);
    }
    const armExt = root.InGameBack?.getAttackArmExtension?.() ?? currentAttackArmExtension;
    if (armExt !== undefined && $('attack-arm-extension')) {
      $('attack-arm-extension').value = String(armExt);
    }
    const defOffset = root.InGameBack?.getDefenseSwordOffset?.() ?? currentDefenseSwordOffset;
    if (defOffset !== undefined && $('defense-sword-offset')) {
      $('defense-sword-offset').value = String(defOffset);
    }
    const defAngle = root.InGameBack?.getDefenseAngleThreshold?.() ?? currentDefenseAngleThreshold;
    if (defAngle !== undefined && $('defense-angle-threshold')) {
      $('defense-angle-threshold').value = String(defAngle);
    }
    const stunRad = root.InGameBack?.getStunCircleRadius?.() ?? currentStunCircleRadius;
    if (stunRad !== undefined && $('stun-circle-radius')) {
      $('stun-circle-radius').value = String(stunRad);
    }
    const dist = root.InGameBack?.getPlayerDistance?.() ?? currentPlayerDistance;
    if (dist !== undefined && $('player-distance')) {
      $('player-distance').value = String(dist);
    }
    const headOpacity = root.InGameBack?.getSelfHeadOpacity?.() ?? currentSelfHeadOpacity;
    if (headOpacity !== undefined && $('self-head-opacity')) {
      $('self-head-opacity').value = String(headOpacity);
    }
    const headOffset = root.InGameBack?.getHeadOffsetZ?.() ?? currentHeadOffsetZ;
    if (headOffset !== undefined && $('head-offset-z')) {
      $('head-offset-z').value = String(headOffset);
    }
    const headBox = root.InGameBack?.getHeadHitboxSize?.() ?? currentHeadHitboxSize;
    if (headBox) {
      if ($('head-box-x')) $('head-box-x').value = String(headBox.x ?? 0.88);
      if ($('head-box-y')) $('head-box-y').value = String(headBox.y ?? 0.88);
      if ($('head-box-z')) $('head-box-z').value = String(headBox.z ?? 0.88);
    }
    const camOffset = root.InGameBack?.getCameraOffset?.() ?? {
      back: currentCameraBackOffset,
      height: currentCameraHeight,
    };
    if (camOffset) {
      if ($('camera-back-offset')) $('camera-back-offset').value = String(camOffset.back ?? 2.4);
      if ($('camera-height')) $('camera-height').value = String(camOffset.height ?? 2.3);
    }
    const angThresh = root.InGameBack?.getAttackAngularThreshold?.();
    if (angThresh) {
      if ($('ang-vel-thresh-x')) $('ang-vel-thresh-x').value = String(angThresh.x ?? 5.0);
      if ($('ang-vel-thresh-y')) $('ang-vel-thresh-y').value = String(angThresh.y ?? 5.0);
      if ($('ang-vel-thresh-z')) $('ang-vel-thresh-z').value = String(angThresh.z ?? 5.0);
    }
  }

  function toggleDurationPanel(forceOpen) {
    const panel = $('ingame-duration-panel');
    if (!panel) return false;
    const willOpen = forceOpen !== undefined ? Boolean(forceOpen) : Boolean(panel.hidden);
    panel.hidden = !willOpen;
    if (willOpen) {
      syncDurationInputs();
    }
    return willOpen;
  }

  function bindInGameKeys() {
    if (keyBound) return;
    const target = root.window || root;
    if (typeof target.addEventListener !== 'function') return;
    keyBound = true;

    const applyDurationFromInputs = () => {
      root.InGameBack?.setJudgmentDurations?.({
        ATTACK: $('dur-attack')?.value,
        ATTACK_SUCCESS_HIT: $('dur-attack-hit')?.value,
        ATTACK_FAIL_STUN: $('dur-attack-fail')?.value,
        PARRY_STUN: $('dur-parry-stun')?.value,
      });
      if ($('arm-swing-multiplier')) {
        root.InGameBack?.setArmSwingMultiplier?.($('arm-swing-multiplier').value);
      }
      if ($('attack-arm-extension')) {
        const nextExt = $('attack-arm-extension').value;
        if (root.InGameBack?.setAttackArmExtension) {
          root.InGameBack.setAttackArmExtension(nextExt);
        } else {
          setAttackArmExtension(nextExt);
        }
      }
      if ($('defense-sword-offset')) {
        const nextDefOffset = $('defense-sword-offset').value;
        if (root.InGameBack?.setDefenseSwordOffset) {
          root.InGameBack.setDefenseSwordOffset(nextDefOffset);
        } else {
          setDefenseSwordOffset(nextDefOffset);
        }
      }
      if ($('defense-angle-threshold')) {
        const nextAngle = Number($('defense-angle-threshold').value);
        if (Number.isFinite(nextAngle) && nextAngle >= 0) {
          currentDefenseAngleThreshold = nextAngle;
          root.InGameBack?.setDefenseAngleThreshold?.(nextAngle);
          renderFrontalSwordHud();
        }
      }
      if ($('stun-circle-radius')) {
        const nextStunRad = $('stun-circle-radius').value;
        if (root.InGameBack?.setStunCircleRadius) {
          root.InGameBack.setStunCircleRadius(nextStunRad);
        } else {
          setStunCircleRadius(nextStunRad);
        }
      }
      if ($('player-distance')) {
        const nextDist = $('player-distance').value;
        if (root.InGameBack?.setPlayerDistance) {
          root.InGameBack.setPlayerDistance(nextDist);
        } else {
          setPlayerDistance(nextDist);
        }
      }
      if ($('self-head-opacity')) {
        const nextOpacity = $('self-head-opacity').value;
        if (root.InGameBack?.setSelfHeadOpacity) {
          root.InGameBack.setSelfHeadOpacity(nextOpacity);
        } else {
          setSelfHeadOpacity(nextOpacity);
        }
      }
      if ($('head-offset-z')) {
        const nextOffsetZ = $('head-offset-z').value;
        if (root.InGameBack?.setHeadOffsetZ) {
          root.InGameBack.setHeadOffsetZ(nextOffsetZ);
        } else {
          setHeadOffsetZ(nextOffsetZ);
        }
      }
      if ($('head-box-x') || $('head-box-y') || $('head-box-z')) {
        const boxUpdates = {
          x: $('head-box-x')?.value,
          y: $('head-box-y')?.value,
          z: $('head-box-z')?.value,
        };
        if (root.InGameBack?.setHeadHitboxSize) {
          root.InGameBack.setHeadHitboxSize(boxUpdates);
        } else {
          setHeadHitboxSize(boxUpdates);
        }
      }
      if ($('camera-back-offset') || $('camera-height')) {
        const camUpdates = {
          back: $('camera-back-offset')?.value,
          height: $('camera-height')?.value,
        };
        if (root.InGameBack?.setCameraOffset) {
          root.InGameBack.setCameraOffset(camUpdates);
        } else {
          setCameraOffset(camUpdates);
        }
      }
      root.InGameBack?.setAttackAngularThreshold?.({
        x: $('ang-vel-thresh-x')?.value,
        y: $('ang-vel-thresh-y')?.value,
        z: $('ang-vel-thresh-z')?.value,
      });
    };

    for (const inputId of [
      'dur-attack',
      'dur-attack-hit',
      'dur-attack-fail',
      'dur-parry-stun',
      'arm-swing-multiplier',
      'attack-arm-extension',
      'defense-sword-offset',
      'defense-angle-threshold',
      'stun-circle-radius',
      'player-distance',
      'self-head-opacity',
      'head-offset-z',
      'head-box-x',
      'head-box-y',
      'head-box-z',
      'camera-back-offset',
      'camera-height',
      'ang-vel-thresh-x',
      'ang-vel-thresh-y',
      'ang-vel-thresh-z',
    ]) {
      $(inputId)?.addEventListener?.('input', applyDurationFromInputs);
      $(inputId)?.addEventListener?.('change', applyDurationFromInputs);
    }

    if ($('close-duration-panel')) {
      $('close-duration-panel').onclick = () => toggleDurationPanel(false);
    }

    target.addEventListener('keydown', (event) => {
      if ($('ingame-view')?.hidden) return;
      const activeTag = event.target?.tagName?.toUpperCase?.() || '';
      const isEditingInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if (event.key === 'Tab' || event.code === 'Tab') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleOverlay();
        }
      } else if (event.key === '9' || event.code === 'Digit9' || event.code === 'Numpad9') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleFrontalSwordHud();
        }
      } else if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleDurationPanel();
        }
      } else if (event.key === 'Escape' || event.code === 'Escape') {
        if (!$('ingame-duration-panel')?.hidden) {
          event.preventDefault?.();
          toggleDurationPanel(false);
        }
      }
    });
  }

  function start(onBackToLobby) {
    if ($('lobby-view')) $('lobby-view').hidden = true;
    if ($('ingame-view')) $('ingame-view').hidden = false;
    if ($('back-to-lobby')) $('back-to-lobby').onclick = onBackToLobby;
    bindInGameKeys();
    syncDurationInputs();
    initThree();
    if (!animId && renderer) animate();
  }

  function stop() {
    if (animId && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(animId);
    }
    animId = null;
    if ($('ingame-view')) $('ingame-view').hidden = true;
    if ($('lobby-view')) $('lobby-view').hidden = false;
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
        let dx = (bladeDir.x - baseDir.x) * armRadius * armMultiplier;
        let dy = (bladeDir.y - baseDir.y) * armRadius * armMultiplier;

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

      // 3) 피격(HIT) 시 검이 맞은 방향(hitImpact)에 따라 머리(구)와 카메라가 흔들리는 효과 적용
      const headGroup = mesh.userData?.headGroup;
      if (data.state === 'HIT' && Number(data.stateDuration) > 0 && data.hitImpact) {
        const totalDur = Math.max(0.05, Number(data.hitImpact.totalDuration) || 1.0);
        const remaining = Math.max(0, Number(data.stateDuration) || 0);
        const elapsed = Math.max(0, totalDur - remaining);
        const decay = Math.pow(Math.min(1, remaining / totalDur), 1.25);
        const knock = Math.sin(Math.min(1, elapsed / 0.1) * Math.PI * 0.5) * decay;
        const osc = Math.cos(elapsed * 44) * decay;
        const factor = 0.55 * knock + 0.45 * osc;

        const lDir = data.hitImpact.localDir || { x: 0, y: 0, z: 1 };
        const wDir = data.hitImpact.worldDir || { x: 0, y: 0, z: 0 };

        headGroup?.userData?.setShakeOffset?.(
          lDir.x * factor * 0.28,
          lDir.y * factor * 0.28,
          lDir.z * factor * 0.28
        );
        cameraShakeOffsets[playerId] = {
          x: wDir.x * factor * 0.36,
          y: wDir.y * factor * 0.36,
          z: wDir.z * factor * 0.36,
        };
      } else {
        headGroup?.userData?.setShakeOffset?.(0, 0, 0);
        cameraShakeOffsets[playerId] = { x: 0, y: 0, z: 0 };
      }

      // 4) 기절(STUN 또는 STUN_DEFENSE) 시 카메라가 뒤로 살짝 빠지는 효과 적용
      const prevPullback = Number(cameraStunPullbacks[playerId]) || 0;
      const targetPullback = isStunned && Number(data.stateDuration) > 0
        ? STUN_CAMERA_PULLBACK_MAX
        : 0;
      if (targetPullback > prevPullback) {
        cameraStunPullbacks[playerId] = prevPullback + (targetPullback - prevPullback) * 0.35;
      } else {
        const step = Math.max((prevPullback - targetPullback) * 0.16, 0.005);
        cameraStunPullbacks[playerId] = Math.max(0, prevPullback - step);
      }

      applyPlayerDistanceLayout(currentPlayerDistance);
    } else if (mesh.quaternion?.set) {
      mesh.quaternion.set(q.x, q.y, q.z, q.w).normalize();
    }
  }

  function updateGraphics(playerData) {
    if (!playerData || typeof playerData !== 'object') return;
    for (const [playerId, info] of Object.entries(playerData)) {
      if (info && typeof info === 'object') {
        receivedPlayerInfo.set(playerId, info);
      }
      updatePose(playerId, info);
    }
    renderFrontalSwordHud();
    renderSplitView();
  }

  function renderPackets(players, rates) {
    const container = $('ingame-packets');
    if (!container) return;
    container.replaceChildren();
    if (!players.length) {
      const empty = document.createElement('section');
      empty.className = 'packet-card';
      const text = document.createElement('p');
      text.className = 'packet-meta';
      text.textContent = '연결된 컨트롤러가 없습니다.';
      empty.append(text);
      container.append(empty);
      return;
    }
    const ordered = [...players].sort((a, b) => a.id.localeCompare(b.id));
    for (const s of ordered) {
      const card = document.createElement('section');
      card.className = 'packet-card';
      card.dataset.player = s.id;
      const heading = document.createElement('h3');
      heading.textContent = `${s.id} (${s.state})`;
      const meta = document.createElement('p');
      meta.className = 'packet-meta';
      meta.textContent = `수신율 ${(rates.get(s.id) || 0).toFixed(1)}회/초 · 누적 ${s.count} · 누락 ${s.missing ?? '미측정(seq 없음)'} · 오류 ${s.invalid}`;
      const pre = document.createElement('pre');
      pre.textContent = s.latest ? JSON.stringify(s.latest, null, 2) : '센서 패킷 수신 대기 중...';

      const playerInfo = receivedPlayerInfo.get(s.id) || root.InGameBack?.getPlayerData?.(s.id);
      const q = receivedAngles.get(s.id) || playerInfo?.tilt || { x: 0, y: 0, z: 0, w: 1 };
      const av = playerInfo?.angularVelocity || { x: 0, y: 0, z: 0 };

      const angleBox = document.createElement('p');
      angleBox.className = 'sword-angle-info';
      const qx = Number(q.x || 0).toFixed(2);
      const qy = Number(q.y || 0).toFixed(2);
      const qz = Number(q.z || 0).toFixed(2);
      const qw = Number(q.w ?? 1).toFixed(2);
      const gameState = playerInfo?.state ? ` · 게임상태 ${playerInfo.state}` : '';
      const durationText = playerInfo?.stateDuration !== undefined
        ? ` (${Number(playerInfo.stateDuration).toFixed(2)}s)`
        : '';
      angleBox.textContent = `검 쿼터니언(XYZW): X ${qx} · Y ${qy} · Z ${qz} · W ${qw}${gameState}${durationText}`;

      const angVelBox = document.createElement('p');
      angVelBox.className = 'sword-angle-info';
      const avx = Number(av.x || 0).toFixed(2);
      const avy = Number(av.y || 0).toFixed(2);
      const avz = Number(av.z || 0).toFixed(2);
      angVelBox.textContent = `검 각속도(XYZ): X ${avx} · Y ${avy} · Z ${avz}`;

      card.append(heading, meta, pre, angleBox, angVelBox);
      container.append(card);
    }
  }

  root.InGameFront = {
    start,
    stop,
    updatePose,
    updateGraphics,
    setPlayerDistance,
    getPlayerDistance: () => currentPlayerDistance,
    setCameraOffset,
    getCameraOffset: () => ({ back: currentCameraBackOffset, height: currentCameraHeight }),
    setSelfHeadOpacity,
    getSelfHeadOpacity: () => currentSelfHeadOpacity,
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
    renderPackets,
    renderFrontalSwordHud,
    toggleFrontalSwordHud,
    toggleOverlay,
    toggleDurationPanel,
  };
})(globalThis);
