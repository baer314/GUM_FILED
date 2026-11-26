'use strict';
(function (root) {
  let active = false;
  let startTimeMs = 0;
  let totalDurationSec = 3.474; // /Sound/ready.mp3 기본 길이 (메타데이터 로드 시 자동 갱신)
  let currentSetNumber = 1;
  let assembleIds = new Set();

  let readyAudio = null;
  let readyAudioDurationSec = 3.474;
  const READY_AUDIO_URL = '/Sound/ready.mp3';

  let styleInjected = false;
  let roundBannerEl = null;
  let roundTitleEl = null;
  let cueBannerEl = null;
  let cueTextEl = null;
  let lastCueMode = '';

  let trackedMeshes = null;
  let trackedPlayerGroups = null;
  let camP1 = null;
  let camP2 = null;
  let layoutSnapshot = {
    playerDistance: 3.0,
    cameraBackOffset: 2.4,
    cameraHeight: 2.3,
    cameraLookForward: 6.0,
    selfHeadOpacity: 0.35,
    armOpacity: 1.0,
  };

  // 타임라인 비율 (ready.mp3 길이에 맞춰 자동 스케일링):
  // 0% ~ 70%: 옆면(+Z)에서 카메라가 점점 다가오며 몸통 -> 검(위쪽 정렬) -> 머리 순으로 위에서 내려와 조립
  // 70% ~ 100%: 각 플레이어의 3인칭 시점 카메라로 자연스럽게 곡선 이동 전환
  const APPROACH_END_RATIO = 0.70;
  const DROP_HEIGHT = 4.8;

  const STAGE_BODY_RATIO = { start: 0.05, end: 0.25 };
  const STAGE_SWORD_RATIO = { start: 0.22, end: 0.44 };
  const STAGE_HEAD_RATIO = { start: 0.41, end: 0.64 };

  function getApproachEndSec() {
    return totalDurationSec * APPROACH_END_RATIO;
  }

  function getStageWindow(ratioStage) {
    return {
      start: totalDurationSec * ratioStage.start,
      end: totalDurationSec * ratioStage.end,
    };
  }

  function ensureReadyAudio() {
    if (readyAudio || typeof root.Audio !== 'function') return readyAudio;
    readyAudio = new root.Audio(READY_AUDIO_URL);
    readyAudio.preload = 'auto';
    readyAudio.addEventListener?.('loadedmetadata', () => {
      const dur = Number(readyAudio?.duration);
      if (Number.isFinite(dur) && dur >= 0.5 && dur <= 30) {
        readyAudioDurationSec = Number(dur.toFixed(3));
        totalDurationSec = readyAudioDurationSec;
        root.InGameBack?.setIntroDuration?.(readyAudioDurationSec);
      }
    });
    return readyAudio;
  }

  // 페이지 로드 시 ready.mp3 메타데이터(길이)를 미리 읽어 둠
  ensureReadyAudio();

  // 검날(-Z)이 위쪽(+Y)을 똑바로 향하도록 하는 X축 +90도 회전 쿼터니언
  const SWORD_UP_QUAT = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

  function ensureRoundBannerUI() {
    if (typeof document === 'undefined') return;
    if (!styleInjected && document.head) {
      styleInjected = true;
      const style = document.createElement('style');
      style.id = 'start-set-round-banner-style';
      style.textContent = `
        .start-set-round-banner {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 105;
          text-align: center;
          transition: opacity 0.35s ease;
        }
        .start-set-round-eyebrow {
          font: 800 clamp(0.85rem, 1.4vw, 1.1rem)/1.2 system-ui, sans-serif;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: #a7f3d0;
          background: rgba(10, 22, 19, 0.76);
          border: 1px solid rgba(110, 231, 183, 0.48);
          border-radius: 999px;
          padding: 5px 18px;
          margin-bottom: 10px;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        }
        .start-set-round-title {
          font: 900 clamp(3rem, 7vw, 5.4rem)/1.05 system-ui, sans-serif;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #ffffff;
          text-shadow:
            0 0 24px rgba(79, 209, 165, 0.9),
            0 0 48px rgba(79, 209, 165, 0.45),
            0 8px 28px rgba(0, 0, 0, 0.85);
          animation: startSetRoundPop 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes startSetRoundPop {
          0% { transform: scale(1.38); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .start-set-cue-banner {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 106;
          text-align: center;
          transition: opacity 0.2s ease;
        }
        .start-set-cue-text {
          font: 900 clamp(3.6rem, 8.5vw, 6.4rem)/1 system-ui, sans-serif;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          will-change: transform, opacity;
        }
        .start-set-cue-banner.is-ready .start-set-cue-text {
          color: #fef3c7;
          text-shadow:
            0 0 24px rgba(251, 191, 36, 0.92),
            0 0 52px rgba(245, 158, 11, 0.55),
            0 8px 28px rgba(0, 0, 0, 0.85);
          animation: startSetCuePop 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .start-set-cue-banner.is-fight .start-set-cue-text {
          font-size: clamp(4.2rem, 10vw, 7.6rem);
          color: #fff7ed;
          text-shadow:
            0 0 26px rgba(255, 72, 42, 0.98),
            0 0 64px rgba(239, 68, 68, 0.85),
            0 10px 30px rgba(0, 0, 0, 0.9);
          animation: startSetFightPunch 0.34s cubic-bezier(0.18, 0.9, 0.32, 1.25);
        }
        @keyframes startSetCuePop {
          0% { transform: scale(1.45); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes startSetFightPunch {
          0% { transform: scale(0.55); opacity: 0; }
          65% { transform: scale(1.14); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!roundBannerEl) {
      const splitUi = document.querySelector?.('.ingame-split-ui');
      if (!splitUi || typeof document.createElement !== 'function') return;

      roundBannerEl = document.createElement('div');
      roundBannerEl.id = 'start-set-round-banner';
      roundBannerEl.className = 'start-set-round-banner';
      roundBannerEl.hidden = true;

      const eyebrow = document.createElement('div');
      eyebrow.className = 'start-set-round-eyebrow';
      eyebrow.textContent = 'GUM FIELD · DUEL';

      roundTitleEl = document.createElement('div');
      roundTitleEl.className = 'start-set-round-title';
      roundTitleEl.textContent = 'ROUND 1';

      roundBannerEl.append(eyebrow, roundTitleEl);
      splitUi.append(roundBannerEl);
    }

    if (!cueBannerEl) {
      const splitUi = document.querySelector?.('.ingame-split-ui');
      if (!splitUi || typeof document.createElement !== 'function') return;

      cueBannerEl = document.createElement('div');
      cueBannerEl.id = 'start-set-cue-banner';
      cueBannerEl.className = 'start-set-cue-banner';
      cueBannerEl.hidden = true;

      cueTextEl = document.createElement('div');
      cueTextEl.className = 'start-set-cue-text';
      cueTextEl.textContent = '';

      cueBannerEl.append(cueTextEl);
      splitUi.append(cueBannerEl);
    }
  }

  function getNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function smoothstep(t) {
    const u = clamp01(t);
    return u * u * (3 - 2 * u);
  }

  // 위에서 내려와 안착할 때 살짝 탄성 있게 착지하는 커브 (0 -> 1)
  function easeOutDrop(t) {
    const u = clamp01(t);
    if (u >= 1) return 1;
    const inv = 1 - u;
    return 1 - inv * inv * inv;
  }

  // 착지 직후 미세한 기계적 안착 바운스 오프셋 (y)
  function landingBounce(t) {
    if (t < 0.82 || t >= 1) return 0;
    const u = (t - 0.82) / 0.18;
    return Math.sin(u * Math.PI) * 0.06;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // 2차 베지어 곡선 보간 (카메라가 캐릭터를 통과하지 않고 옆에서 자연스럽게 돌아 들어가도록)
  function quadBezier(p0, p1, p2, t) {
    const inv = 1 - t;
    return {
      x: inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x,
      y: inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y,
      z: inv * inv * p0.z + 2 * inv * t * p1.z + t * t * p2.z,
    };
  }

  function getLiveArmOpacity() {
    const live = root.InGameFront?.getArmOpacity?.() ?? root.InGameBack?.getArmOpacity?.();
    if (Number.isFinite(Number(live))) {
      return Math.min(1, Math.max(0, Number(live)));
    }
    return layoutSnapshot.armOpacity;
  }

  function restorePlayerParts(playerId) {
    const mesh = trackedMeshes?.get?.(playerId);
    if (!mesh) return;
    const bodyGroup = mesh.userData?.bodyGroup;
    const headGroup = mesh.userData?.headGroup;
    const baseWrist = mesh.userData?.baseWristOffset;

    mesh.visible = true;
    if (baseWrist && mesh.position?.set) {
      mesh.position.set(baseWrist.x, baseWrist.y, baseWrist.z);
      mesh.userData?.updateLimbs?.(baseWrist.x, baseWrist.y, baseWrist.z);
    }
    mesh.userData?.setArmOpacity?.(getLiveArmOpacity());
    bodyGroup?.userData?.setShakeOffset?.(0, 0, 0);
    bodyGroup?.userData?.setRotationOffset?.(0, 0, 0);
    bodyGroup?.userData?.setOpacity?.(1.0);
    headGroup?.userData?.setShakeOffset?.(0, 0, 0);
    headGroup?.userData?.setRotationOffset?.(0, 0, 0);
    headGroup?.userData?.setEyeExpression?.('NORMAL');
    headGroup?.userData?.setOpacity?.(1.0);
  }

  function start(options = {}) {
    const {
      setNumber = 1,
      assemblePlayers = ['PLAYER_1', 'PLAYER_2'],
      duration = readyAudioDurationSec,
      playerGroups,
      meshes,
      cameraP1,
      cameraP2,
      playerDistance = 3.0,
      cameraBackOffset = 2.4,
      cameraHeight = 2.3,
      cameraLookForward = 6.0,
      selfHeadOpacity = 0.35,
      armOpacity = 1.0,
    } = options;

    active = true;
    startTimeMs = getNowMs();
    const smDur = Number(root.SoundManager?.getReadyDurationSec?.());
    if (Number.isFinite(smDur) && smDur >= 0.5 && smDur <= 30) {
      readyAudioDurationSec = Number(smDur.toFixed(3));
      root.InGameBack?.setIntroDuration?.(readyAudioDurationSec);
    }
    totalDurationSec = Math.max(0.5, Number(readyAudioDurationSec) || Number(duration) || 3.474);
    currentSetNumber = Math.max(1, Math.floor(Number(setNumber) || 1));

    // 라운드 표시 애니메이션 시작 시 Web Audio 기반 SoundManager로 ready.mp3 안정 재생
    if (root.SoundManager?.playReady) {
      root.SoundManager.playReady();
    } else {
      const audio = ensureReadyAudio();
      if (audio) {
        try {
          audio.pause?.();
          audio.currentTime = 0;
          const playPromise = audio.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch {}
      }
    }
    assembleIds = new Set(Array.isArray(assemblePlayers) ? assemblePlayers : ['PLAYER_1', 'PLAYER_2']);
    trackedPlayerGroups = playerGroups || null;
    trackedMeshes = meshes || null;
    camP1 = cameraP1 || null;
    camP2 = cameraP2 || null;
    layoutSnapshot = {
      playerDistance: Number(playerDistance) || 3.0,
      cameraBackOffset: Number(cameraBackOffset) || 2.4,
      cameraHeight: Number(cameraHeight) || 2.3,
      cameraLookForward: Number(cameraLookForward) || 6.0,
      selfHeadOpacity: Number.isFinite(Number(selfHeadOpacity)) ? Number(selfHeadOpacity) : 0.35,
      armOpacity: Number.isFinite(Number(armOpacity)) ? Number(armOpacity) : 1.0,
    };

    ensureRoundBannerUI();
    if (roundBannerEl && roundTitleEl) {
      roundTitleEl.textContent = `ROUND ${currentSetNumber}`;
      roundBannerEl.style.opacity = '1';
      roundBannerEl.hidden = false;
    }

    // 두 플레이어를 중앙 기준 위치로 정렬
    const halfDist = layoutSnapshot.playerDistance / 2;
    const p1Group = trackedPlayerGroups?.get?.('PLAYER_1');
    if (p1Group?.position?.set) {
      p1Group.position.set(-halfDist, 1.14, 0);
      p1Group.rotation?.set?.(0, -Math.PI / 2, 0);
    }
    const p2Group = trackedPlayerGroups?.get?.('PLAYER_2');
    if (p2Group?.position?.set) {
      p2Group.position.set(halfDist, 1.14, 0);
      p2Group.rotation?.set?.(0, Math.PI / 2, 0);
    }

    for (const id of ['PLAYER_1', 'PLAYER_2']) {
      restorePlayerParts(id);
    }
  }

  function applyAssemblyForPlayer(playerId, elapsedSec) {
    const mesh = trackedMeshes?.get?.(playerId);
    if (!mesh) return;
    const bodyGroup = mesh.userData?.bodyGroup;
    const headGroup = mesh.userData?.headGroup;
    const baseWrist = mesh.userData?.baseWristOffset || { x: 0, y: 0.12, z: -0.95 };

    if (!assembleIds.has(playerId)) {
      // 전 라운드 승자는 이미 조립된 상태로 대기 (검은 센서값과 무관하게 위쪽을 향하도록 고정)
      mesh.visible = true;
      mesh.quaternion?.set?.(SWORD_UP_QUAT.x, SWORD_UP_QUAT.y, SWORD_UP_QUAT.z, SWORD_UP_QUAT.w);
      mesh.position?.set?.(baseWrist.x, baseWrist.y, baseWrist.z);
      mesh.userData?.updateLimbs?.(baseWrist.x, baseWrist.y, baseWrist.z);
      mesh.userData?.setArmOpacity?.(getLiveArmOpacity());
      bodyGroup?.userData?.setShakeOffset?.(0, 0, 0);
      headGroup?.userData?.setShakeOffset?.(0, 0, 0);
      return;
    }

    // 1) 몸통 (Body) 위에서 내려와 안착
    const stageBody = getStageWindow(STAGE_BODY_RATIO);
    const tBody = (elapsedSec - stageBody.start) / Math.max(0.05, stageBody.end - stageBody.start);
    if (tBody <= 0) {
      bodyGroup?.userData?.setOpacity?.(0);
      bodyGroup?.userData?.setShakeOffset?.(0, DROP_HEIGHT, 0);
    } else {
      const pBody = easeOutDrop(tBody);
      const yBody = (1 - pBody) * DROP_HEIGHT + landingBounce(tBody);
      bodyGroup?.userData?.setShakeOffset?.(0, yBody, 0);
      bodyGroup?.userData?.setOpacity?.(Math.min(1, tBody * 4));
    }

    // 2) 검 (Sword) & 양팔 위에서 내려와 결합 (센서값과 무관하게 검이 항상 위쪽을 향함)
    const stageSword = getStageWindow(STAGE_SWORD_RATIO);
    const tSword = (elapsedSec - stageSword.start) / Math.max(0.05, stageSword.end - stageSword.start);
    if (tSword <= 0) {
      mesh.visible = false;
      mesh.userData?.setArmOpacity?.(0);
    } else {
      mesh.visible = true;
      const pSword = easeOutDrop(tSword);
      const ySwordOffset = (1 - pSword) * DROP_HEIGHT + landingBounce(tSword);
      const wy = baseWrist.y + ySwordOffset;
      mesh.quaternion?.set?.(SWORD_UP_QUAT.x, SWORD_UP_QUAT.y, SWORD_UP_QUAT.z, SWORD_UP_QUAT.w);
      mesh.position?.set?.(baseWrist.x, wy, baseWrist.z);
      mesh.userData?.updateLimbs?.(baseWrist.x, wy, baseWrist.z);
      mesh.userData?.setArmOpacity?.(getLiveArmOpacity() * clamp01((tSword - 0.35) / 0.45));
    }

    // 3) 머리 (Head) 위에서 내려와 목 위에 결합
    const stageHead = getStageWindow(STAGE_HEAD_RATIO);
    const tHead = (elapsedSec - stageHead.start) / Math.max(0.05, stageHead.end - stageHead.start);
    if (tHead <= 0) {
      headGroup?.userData?.setOpacity?.(0);
      headGroup?.userData?.setShakeOffset?.(0, DROP_HEIGHT, 0);
    } else {
      const pHead = easeOutDrop(tHead);
      const yHead = (1 - pHead) * DROP_HEIGHT + landingBounce(tHead);
      headGroup?.userData?.setShakeOffset?.(0, yHead, 0);
      headGroup?.userData?.setOpacity?.(Math.min(1, tHead * 4));
    }
  }

  function getTransitionProgress(elapsedSec) {
    const approachEnd = getApproachEndSec();
    const transDur = Math.max(0.2, totalDurationSec - approachEnd);
    return smoothstep((elapsedSec - approachEnd) / transDur);
  }

  function updateFrame() {
    if (!active) return;
    const elapsedSec = Math.max(0, (getNowMs() - startTimeMs) / 1000);
    const approachEnd = getApproachEndSec();

    // 0) 중앙 라운드 배너 표시 및 카메라 전환 시 자연스럽게 페이드아웃
    if (roundBannerEl) {
      const fadeStart = approachEnd + 0.1;
      const fadeEnd = Math.max(fadeStart + 0.3, totalDurationSec - 0.2);
      if (elapsedSec <= fadeStart) {
        roundBannerEl.hidden = false;
        roundBannerEl.style.opacity = '1';
      } else if (elapsedSec < fadeEnd) {
        roundBannerEl.hidden = false;
        roundBannerEl.style.opacity = String(1 - clamp01((elapsedSec - fadeStart) / (fadeEnd - fadeStart)));
      } else {
        roundBannerEl.hidden = true;
      }
    }

    // 1) 플레이어 파츠 조립 애니메이션 갱신
    applyAssemblyForPlayer('PLAYER_1', elapsedSec);
    applyAssemblyForPlayer('PLAYER_2', elapsedSec);

    // 2) 카메라 연출:
    //    - 0 ~ 2.2초: 경기장 옆(+Z)에서 점점 다가오며 양 플레이어 조립 장면을 비춤
    //    - 2.2 ~ 3.2초: 각 플레이어 뒤쪽 3인칭 시점 카메라로 부드럽게 곡선 전환
    const halfDist = layoutSnapshot.playerDistance / 2;
    const sideStart = { x: 0, y: 3.3, z: 9.2 };
    const sideEnd = { x: 0, y: 2.15, z: 4.5 };
    const centerLook = { x: 0, y: 1.25, z: 0 };

    const p1TargetPos = {
      x: -halfDist - layoutSnapshot.cameraBackOffset,
      y: layoutSnapshot.cameraHeight,
      z: 0,
    };
    const p1TargetLook = {
      x: p1TargetPos.x + layoutSnapshot.cameraLookForward,
      y: 1.1,
      z: 0,
    };

    const p2TargetPos = {
      x: halfDist + layoutSnapshot.cameraBackOffset,
      y: layoutSnapshot.cameraHeight,
      z: 0,
    };
    const p2TargetLook = {
      x: p2TargetPos.x - layoutSnapshot.cameraLookForward,
      y: 1.1,
      z: 0,
    };

    if (elapsedSec <= approachEnd) {
      const a = smoothstep(elapsedSec / Math.max(0.1, approachEnd));
      const cx = lerp(sideStart.x, sideEnd.x, a);
      const cy = lerp(sideStart.y, sideEnd.y, a);
      const cz = lerp(sideStart.z, sideEnd.z, a);

      if (camP1) {
        camP1.up?.set(0, 1, 0);
        camP1.position?.set(cx, cy, cz);
        camP1.lookAt?.(centerLook.x, centerLook.y, centerLook.z);
      }
      if (camP2) {
        camP2.up?.set(0, 1, 0);
        camP2.position?.set(cx, cy, cz);
        camP2.lookAt?.(centerLook.x, centerLook.y, centerLook.z);
      }
    } else {
      const u = getTransitionProgress(elapsedSec);
      // 옆면(+Z)에서 각 플레이어 등 뒤(±X, z=0)로 부드럽게 돌아 들어가는 제어점
      const p1Ctrl = { x: p1TargetPos.x * 0.85, y: lerp(sideEnd.y, p1TargetPos.y, 0.5), z: sideEnd.z * 0.78 };
      const p2Ctrl = { x: p2TargetPos.x * 0.85, y: lerp(sideEnd.y, p2TargetPos.y, 0.5), z: sideEnd.z * 0.78 };

      const pos1 = quadBezier(sideEnd, p1Ctrl, p1TargetPos, u);
      const pos2 = quadBezier(sideEnd, p2Ctrl, p2TargetPos, u);

      if (camP1) {
        camP1.up?.set(0, 1, 0);
        camP1.position?.set(pos1.x, pos1.y, pos1.z);
        camP1.lookAt?.(
          lerp(centerLook.x, p1TargetLook.x, u),
          lerp(centerLook.y, p1TargetLook.y, u),
          lerp(centerLook.z, p1TargetLook.z, u)
        );
      }
      if (camP2) {
        camP2.up?.set(0, 1, 0);
        camP2.position?.set(pos2.x, pos2.y, pos2.z);
        camP2.lookAt?.(
          lerp(centerLook.x, p2TargetLook.x, u),
          lerp(centerLook.y, p2TargetLook.y, u),
          lerp(centerLook.z, p2TargetLook.z, u)
        );
      }
    }
  }

  // 렌더링 시 각 시점별 본인 머리/몸통 투명도 보간값 반환 (옆면 시점에서는 1.0, 전환되면서 설정 불투명도로 보간)
  function getSelfOpacityForCamera(playerId, baseSelfOpacity) {
    if (!active) return baseSelfOpacity;
    const elapsedSec = Math.max(0, (getNowMs() - startTimeMs) / 1000);
    if (elapsedSec <= getApproachEndSec()) {
      return 1.0;
    }
    const u = getTransitionProgress(elapsedSec);
    return lerp(1.0, baseSelfOpacity, u);
  }

  // 파츠별 현재 조립 가시성 배수 (조립 전 파츠는 0으로 유지)
  function getPartRevealOpacity(playerId, part) {
    if (!active || !assembleIds.has(playerId)) return 1.0;
    const elapsedSec = Math.max(0, (getNowMs() - startTimeMs) / 1000);
    const stage = getStageWindow(part === 'head' ? STAGE_HEAD_RATIO : STAGE_BODY_RATIO);
    const t = (elapsedSec - stage.start) / Math.max(0.05, stage.end - stage.start);
    if (t <= 0) return 0;
    return Math.min(1, t * 4);
  }

  function reset() {
    root.SoundManager?.stopReady?.();
    if (readyAudio) {
      try {
        readyAudio.pause?.();
        readyAudio.currentTime = 0;
      } catch {}
    }
    if (trackedMeshes) {
      for (const id of ['PLAYER_1', 'PLAYER_2']) {
        restorePlayerParts(id);
      }
    }
    if (roundBannerEl) {
      roundBannerEl.hidden = true;
      roundBannerEl.style.opacity = '0';
    }
    if (cueBannerEl) {
      cueBannerEl.hidden = true;
      cueBannerEl.style.opacity = '0';
    }
    lastCueMode = '';
    active = false;
    assembleIds.clear();
    trackedMeshes = null;
    trackedPlayerGroups = null;
    camP1 = null;
    camP2 = null;
  }

  function syncSetState(setInfo, ctx = {}) {
    const isIntro = Boolean(setInfo && setInfo.phase === 'INTRO');
    if (isIntro) {
      if (!active) {
        start({
          setNumber: setInfo.setNumber,
          assemblePlayers: setInfo.introAssemblePlayers,
          duration: setInfo.introDuration,
          playerGroups: ctx.playerGroups,
          meshes: ctx.meshes,
          cameraP1: ctx.cameraP1,
          cameraP2: ctx.cameraP2,
          playerDistance: ctx.playerDistance,
          cameraBackOffset: ctx.cameraBackOffset,
          cameraHeight: ctx.cameraHeight,
          cameraLookForward: ctx.cameraLookForward,
          selfHeadOpacity: ctx.selfHeadOpacity,
          armOpacity: ctx.armOpacity,
        });
      }
    } else if (active) {
      reset();
    }
  }

  function updateReadyFightCue(setInfo) {
    ensureRoundBannerUI();
    if (!cueBannerEl || !cueTextEl) return;

    const isReadyCue = Boolean(setInfo && setInfo.phase === 'READY_CUE');
    const fightRemaining = setInfo && setInfo.phase === 'PLAYING' && !setInfo.winner
      ? Math.max(0, Number(setInfo.fightBannerTimer) || 0)
      : 0;
    const isFightCue = fightRemaining > 0;

    if (isReadyCue) {
      if (lastCueMode !== 'READY') {
        cueBannerEl.className = 'start-set-cue-banner is-ready';
        cueTextEl.textContent = 'READY';
        void cueTextEl.offsetWidth;
        lastCueMode = 'READY';
      }
      cueBannerEl.hidden = false;
      cueBannerEl.style.opacity = '1';
    } else if (isFightCue) {
      if (lastCueMode !== 'FIGHT') {
        cueBannerEl.className = 'start-set-cue-banner is-fight';
        cueTextEl.textContent = 'FIGHT!';
        void cueTextEl.offsetWidth;
        lastCueMode = 'FIGHT';
      }
      cueBannerEl.hidden = false;
      const fadeAlpha = fightRemaining < 0.25 ? clamp01(fightRemaining / 0.25) : 1;
      cueBannerEl.style.opacity = String(fadeAlpha);
    } else {
      cueBannerEl.hidden = true;
      lastCueMode = '';
    }
  }

  root.StartSetAnimation = {
    start,
    updateFrame,
    syncSetState,
    updateReadyFightCue,
    reset,
    getSelfOpacityForCamera,
    getPartRevealOpacity,
    isActive: () => active,
  };
})(globalThis);
