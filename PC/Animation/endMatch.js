'use strict';
(function (root) {
  let active = false;
  let winnerId = null;
  let loserId = null;
  let startTimeMs = 0;

  let trackedPlayerGroups = null;
  let trackedMeshes = null;
  let mainCamera = null;
  let savedArmOpacity = 1.0;

  // 검을 하늘 위로 치켜드는 기본 쿼터니언 (+90도 X축 회전)
  const SWORD_UP_QUAT = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

  function getNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function multiplyQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function start(options = {}) {
    const {
      winner,
      playerGroups,
      meshes,
      camera,
      armOpacity = 1.0,
    } = options;
    if (!winner || !playerGroups || !meshes) return;

    active = true;
    winnerId = winner;
    loserId = winner === 'PLAYER_1' ? 'PLAYER_2' : 'PLAYER_1';
    startTimeMs = getNowMs();
    trackedPlayerGroups = playerGroups;
    trackedMeshes = meshes;
    mainCamera = camera || null;
    savedArmOpacity = Number.isFinite(Number(armOpacity)) ? Number(armOpacity) : 1.0;

    for (const id of ['PLAYER_1', 'PLAYER_2']) {
      const mesh = trackedMeshes.get(id);
      if (!mesh) continue;
      mesh.visible = true;
      const liveArmOpacity = root.InGameFront?.getArmOpacity?.() ?? root.InGameBack?.getArmOpacity?.() ?? savedArmOpacity;
      mesh.userData?.setArmOpacity?.(liveArmOpacity);
      mesh.userData?.bodyGroup?.userData?.setShakeOffset?.(0, 0, 0);
      mesh.userData?.bodyGroup?.userData?.setRotationOffset?.(0, 0, 0);
      mesh.userData?.headGroup?.userData?.setShakeOffset?.(0, 0, 0);
      mesh.userData?.headGroup?.userData?.setRotationOffset?.(0, 0, 0);
      mesh.userData?.headGroup?.userData?.setEyeExpression?.(id === loserId ? 'HIT' : 'NORMAL');
    }
  }

  function updateFrame(width = 1280, height = 720) {
    if (!active || !trackedPlayerGroups || !trackedMeshes) return;

    const t = Math.max(0, (getNowMs() - startTimeMs) / 1000);

    // 1) 승자: 무대 중앙(0, y, 0)에서 카메라(-Z)를 바라보며 환호 점프 & 검 흔들기
    const winGroup = trackedPlayerGroups.get(winnerId);
    const winMesh = trackedMeshes.get(winnerId);
    if (winGroup) {
      const hopPhase = t * 5.2;
      const hop = Math.abs(Math.sin(hopPhase));
      const jumpY = hop * 0.62;
      winGroup.position?.set(0, 1.14 + jumpY, 0);
      // 로컬 -Z가 정면이므로 rotation.y = 0이면 -Z 쪽 카메라를 정면으로 바라봄
      const cheerTiltZ = Math.sin(hopPhase * 0.5) * 0.08;
      winGroup.rotation?.set(0, Math.sin(t * 2.1) * 0.14, cheerTiltZ);
    }
    if (winMesh) {
      const baseWrist = winMesh.userData?.baseWristOffset || { x: 0, y: 0.12, z: -0.95 };
      const wave = Math.sin(t * 6.5);
      const wx = wave * 0.24;
      const wy = baseWrist.y + 0.52 + Math.abs(Math.sin(t * 5.2)) * 0.22;
      const wz = baseWrist.z * 0.62;
      winMesh.position?.set(wx, wy, wz);
      winMesh.userData?.updateLimbs?.(wx, wy, wz);

      // 검을 위로 치켜든 채 좌우로 환호하듯 흔듦
      const halfRoll = (wave * 0.32) / 2;
      const rollQ = { x: 0, y: 0, z: Math.sin(halfRoll), w: Math.cos(halfRoll) };
      const cheerQ = multiplyQuat(rollQ, SWORD_UP_QUAT);
      const len = Math.hypot(cheerQ.x, cheerQ.y, cheerQ.z, cheerQ.w) || 1;
      winMesh.quaternion?.set(cheerQ.x / len, cheerQ.y / len, cheerQ.z / len, cheerQ.w / len);
      winMesh.userData?.headGroup?.userData?.setEyeExpression?.('NORMAL');
    }

    // 2) 패자: 무대 뒤쪽(+Z) 우주 공간에서 무중력 상태로 천천히 유영하며 빙글빙글 회전
    const loseGroup = trackedPlayerGroups.get(loserId);
    const loseMesh = trackedMeshes.get(loserId);
    if (loseGroup) {
      const driftX = Math.sin(t * 0.55 + 0.4) * 5.2;
      const driftY = 2.65 + Math.sin(t * 0.95) * 0.95;
      const driftZ = 7.4 + Math.cos(t * 0.42) * 1.8;
      loseGroup.position?.set(driftX, driftY, driftZ);
      loseGroup.rotation?.set(
        t * 0.72,
        t * 0.58,
        t * 0.46
      );
    }
    if (loseMesh) {
      const baseWrist = loseMesh.userData?.baseWristOffset || { x: 0, y: 0.12, z: -0.95 };
      loseMesh.position?.set(baseWrist.x, baseWrist.y, baseWrist.z);
      loseMesh.userData?.updateLimbs?.(baseWrist.x, baseWrist.y, baseWrist.z);
      loseMesh.userData?.headGroup?.userData?.setEyeExpression?.('HIT');
    }

    // 3) 통합 단일 카메라: 무대 정면(-Z)에서 중앙 승자와 뒤쪽 우주를 유영하는 패자를 함께 비춤
    if (mainCamera) {
      const targetAspect = width / Math.max(1, height);
      if (Math.abs((Number(mainCamera.aspect) || 1) - targetAspect) > 0.001) {
        mainCamera.aspect = targetAspect;
        mainCamera.updateProjectionMatrix?.();
      }
      if (Math.abs((Number(mainCamera.fov) || 60) - 56) > 0.05) {
        mainCamera.fov = 56;
        mainCamera.updateProjectionMatrix?.();
      }
      const camOrbitX = Math.sin(t * 0.35) * 1.1;
      const camY = 2.15 + Math.sin(t * 0.7) * 0.12;
      mainCamera.up?.set(0, 1, 0);
      mainCamera.position?.set(camOrbitX, camY, -5.6);
      mainCamera.lookAt?.(0, 1.5, 0.8);
    }
  }

  function reset() {
    if (trackedPlayerGroups) {
      const p1 = trackedPlayerGroups.get('PLAYER_1');
      if (p1?.rotation?.set) p1.rotation.set(0, -Math.PI / 2, 0);
      const p2 = trackedPlayerGroups.get('PLAYER_2');
      if (p2?.rotation?.set) p2.rotation.set(0, Math.PI / 2, 0);
    }
    if (trackedMeshes) {
      for (const id of ['PLAYER_1', 'PLAYER_2']) {
        const mesh = trackedMeshes.get(id);
        mesh?.userData?.headGroup?.userData?.setEyeExpression?.('NORMAL');
      }
    }
    if (mainCamera) {
      mainCamera.up?.set(0, 1, 0);
      mainCamera.fov = 60;
      mainCamera.updateProjectionMatrix?.();
    }

    active = false;
    winnerId = null;
    loserId = null;
    trackedPlayerGroups = null;
    trackedMeshes = null;
    mainCamera = null;
  }

  function syncSetState(setInfo, ctx = {}) {
    const isMatchEnd = Boolean(setInfo && setInfo.phase === 'MATCH_END' && setInfo.matchWinner);
    if (isMatchEnd) {
      if (!active || winnerId !== setInfo.matchWinner) {
        start({
          winner: setInfo.matchWinner,
          playerGroups: ctx.playerGroups,
          meshes: ctx.meshes,
          camera: ctx.cameraP1,
          armOpacity: ctx.armOpacity,
        });
      }
    } else if (active) {
      reset();
    }
  }

  root.EndMatchAnimation = {
    start,
    updateFrame,
    syncSetState,
    reset,
    isActive: () => active,
    getWinnerId: () => winnerId,
    getLoserId: () => loserId,
  };
})(globalThis);
