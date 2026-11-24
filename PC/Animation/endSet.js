'use strict';
(function (root) {
  let active = false;
  let winnerId = null;
  let loserId = null;
  let startTimeMs = 0;
  let lastFrameMs = 0;

  let loserBaseGroup = null;
  let loserHeadGroup = null;
  let winnerCamera = null;
  let loserCamera = null;

  let loserOriginalFacingY = 0;
  let loserStartPos = { x: 0, y: 1.1, z: 0 };
  let winnerCamAnchor = { x: 0, y: 2.3, z: 0 };
  let launchVelocity = { x: 0, y: 3.5, z: 0 };
  let spinVelocity = { x: 2.8, y: 3.2, z: 1.8 };

  const LAUNCH_SPEED = 11.5;
  const SPACE_GRAVITY = 2.2;

  function getNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function normalizeVec3(v, fallback = { x: 1, y: 0.35, z: 0 }) {
    const x = Number(v?.x) || 0;
    const y = Number(v?.y) || 0;
    const z = Number(v?.z) || 0;
    const len = Math.hypot(x, y, z);
    if (len < 1e-4) {
      const fLen = Math.hypot(fallback.x, fallback.y, fallback.z) || 1;
      return { x: fallback.x / fLen, y: fallback.y / fLen, z: fallback.z / fLen };
    }
    return { x: x / len, y: y / len, z: z / len };
  }

  function start(options = {}) {
    const {
      winner,
      loser,
      loserGroup,
      headGroup,
      winCam,
      loseCam,
      hitWorldDir,
      loserFacingY,
    } = options;

    if (!winner || !loser || !loserGroup) return;

    active = true;
    winnerId = winner;
    loserId = loser;
    loserBaseGroup = loserGroup;
    loserHeadGroup = headGroup || null;
    winnerCamera = winCam || null;
    loserCamera = loseCam || null;
    loserOriginalFacingY = Number.isFinite(Number(loserFacingY))
      ? Number(loserFacingY)
      : (loser === 'PLAYER_1' ? -Math.PI / 2 : Math.PI / 2);

    startTimeMs = getNowMs();
    lastFrameMs = startTimeMs;

    loserStartPos = {
      x: Number(loserGroup.position?.x) || 0,
      y: Number(loserGroup.position?.y) || 1.1,
      z: Number(loserGroup.position?.z) || 0,
    };

    if (winnerCamera?.position) {
      winnerCamAnchor = {
        x: Number(winnerCamera.position.x) || 0,
        y: Number(winnerCamera.position.y) || 2.3,
        z: Number(winnerCamera.position.z) || 0,
      };
    }

    // 피격 방향(hitWorldDir)으로 날아가되, 바닥을 뚫고 들어가지 않도록 위쪽(+Y) 성분을 보강
    const fallbackAwayX = loser === 'PLAYER_1' ? -1 : 1;
    const baseDir = normalizeVec3(hitWorldDir, { x: fallbackAwayX, y: 0.35, z: 0 });
    const boostedDir = normalizeVec3({
      x: baseDir.x,
      y: Math.max(0.28, baseDir.y + 0.32),
      z: baseDir.z,
    }, { x: fallbackAwayX, y: 0.38, z: 0 });

    launchVelocity = {
      x: boostedDir.x * LAUNCH_SPEED,
      y: boostedDir.y * LAUNCH_SPEED,
      z: boostedDir.z * LAUNCH_SPEED,
    };

    // 피격 방향에 따라 자연스럽게 구르며 날아가도록 회전 속도 설정
    const spinSign = loser === 'PLAYER_1' ? 1 : -1;
    spinVelocity = {
      x: (2.6 + Math.abs(boostedDir.x) * 2.2) * spinSign,
      y: (boostedDir.z >= 0 ? 1 : -1) * (2.4 + Math.abs(boostedDir.z) * 2.5),
      z: -boostedDir.x * 2.0,
    };

    // 날아가는 동안 패자 머리의 X 눈 표정 유지
    loserHeadGroup?.userData?.setEyeExpression?.('HIT');
  }

  function updateFrame(THREE) {
    if (!active || !loserBaseGroup) return;

    const nowMs = getNowMs();
    const elapsedSec = Math.max(0, (nowMs - startTimeMs) / 1000);
    lastFrameMs = nowMs;

    // 1) 패자 본체: 피격 방향으로 포물선을 그리며 날아가고 공중에서 회전
    const px = loserStartPos.x + launchVelocity.x * elapsedSec;
    const py = loserStartPos.y + launchVelocity.y * elapsedSec - 0.5 * SPACE_GRAVITY * elapsedSec * elapsedSec;
    const pz = loserStartPos.z + launchVelocity.z * elapsedSec;
    loserBaseGroup.position?.set(px, py, pz);

    if (loserBaseGroup.rotation?.set) {
      loserBaseGroup.rotation.set(
        spinVelocity.x * elapsedSec,
        loserOriginalFacingY + spinVelocity.y * elapsedSec,
        spinVelocity.z * elapsedSec
      );
    }

    // 날아가는 동안 패자의 X 눈 유지
    loserHeadGroup?.userData?.setEyeExpression?.('HIT');

    // 월드 행렬 최신화 (머리 눈 위치 및 승자 카메라 추적 대상 계산용)
    loserBaseGroup.updateMatrixWorld?.(true);

    // 2) 승자 카메라: 현재 카메라 위치에 고정된 채 날아가는 패자(머리 중심 또는 본체)를 계속 비춤
    if (winnerCamera) {
      winnerCamera.position?.set(winnerCamAnchor.x, winnerCamAnchor.y, winnerCamAnchor.z);
      winnerCamera.up?.set(0, 1, 0);
      if (THREE?.Vector3 && loserHeadGroup?.getWorldPosition) {
        const targetPos = new THREE.Vector3();
        loserHeadGroup.getWorldPosition(targetPos);
        winnerCamera.lookAt?.(targetPos);
      } else {
        winnerCamera.lookAt?.(px, py + 0.3, pz);
      }
    }

    // 3) 패자 카메라: 패자 머리의 눈 위치로 이동해 회전하며 날아가는 1인칭 시점을 그대로 보여줌
    if (loserCamera && THREE?.Vector3 && THREE?.Quaternion && loserHeadGroup?.matrixWorld) {
      const headRadius = Number(loserHeadGroup.userData?.radius) || 0.44;
      // Head.js 기준 얼굴 정면은 로컬 -Z 방향
      const eyeLocal = new THREE.Vector3(0, 0.04, -headRadius * 1.06);
      const lookLocal = new THREE.Vector3(0, 0.04, -headRadius * 1.06 - 10.0);

      const eyeWorld = eyeLocal.applyMatrix4(loserHeadGroup.matrixWorld);
      const lookWorld = lookLocal.applyMatrix4(loserHeadGroup.matrixWorld);

      const headWorldQuat = new THREE.Quaternion();
      loserHeadGroup.getWorldQuaternion?.(headWorldQuat);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(headWorldQuat).normalize();

      loserCamera.position?.copy(eyeWorld);
      loserCamera.up?.copy(upWorld);
      loserCamera.lookAt?.(lookWorld);
    } else if (loserCamera) {
      loserCamera.position?.set(px, py + 0.35, pz);
      loserCamera.lookAt?.(winnerCamAnchor.x, winnerCamAnchor.y, winnerCamAnchor.z);
    }
  }

  function reset() {
    if (loserBaseGroup?.rotation?.set) {
      loserBaseGroup.rotation.set(0, loserOriginalFacingY, 0);
    }
    if (loserCamera?.up?.set) {
      loserCamera.up.set(0, 1, 0);
    }
    if (winnerCamera?.up?.set) {
      winnerCamera.up.set(0, 1, 0);
    }
    loserHeadGroup?.userData?.setEyeExpression?.('NORMAL');

    active = false;
    winnerId = null;
    loserId = null;
    loserBaseGroup = null;
    loserHeadGroup = null;
    winnerCamera = null;
    loserCamera = null;
  }

  function syncSetState(setInfo, ctx = {}) {
    const isResult = Boolean(setInfo && setInfo.phase === 'RESULT' && setInfo.winner);
    if (isResult) {
      if (!active || winnerId !== setInfo.winner) {
        const winner = setInfo.winner;
        const loser = winner === 'PLAYER_1' ? 'PLAYER_2' : 'PLAYER_1';
        const loserGroup = ctx.playerGroups?.get?.(loser);
        const loserMesh = ctx.meshes?.get?.(loser);
        const headGroup = loserMesh?.userData?.headGroup || null;
        const winCam = winner === 'PLAYER_1' ? ctx.cameraP1 : ctx.cameraP2;
        const loseCam = loser === 'PLAYER_1' ? ctx.cameraP1 : ctx.cameraP2;
        const loserInfo = ctx.receivedPlayerInfo?.get?.(loser) || root.InGameBack?.getPlayerData?.(loser);
        const hitWorldDir = loserInfo?.hitImpact?.worldDir || null;

        start({
          winner,
          loser,
          loserGroup,
          headGroup,
          winCam,
          loseCam,
          hitWorldDir,
          loserFacingY: loser === 'PLAYER_1' ? -Math.PI / 2 : Math.PI / 2,
        });
      }
    } else if (active) {
      reset();
    }
  }

  root.EndSetAnimation = {
    start,
    updateFrame,
    syncSetState,
    reset,
    isActive: () => active,
    getWinnerId: () => winnerId,
    getLoserId: () => loserId,
  };
})(globalThis);
