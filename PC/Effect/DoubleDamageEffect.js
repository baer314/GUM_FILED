'use strict';
(function (root) {
  let styleInjected = false;
  let uiInitialized = false;
  let floorOverlayMesh = null;
  let floorOverlayMat = null;
  let floorHaloMesh = null;
  let floorHaloMat = null;
  let bgRefsCache = null;
  let savedAmberColor = null;
  let savedAmberEmissive = null;
  let savedOrangeColor = null;

  let countdownEl = null;
  let countdownLabelEl = null;
  let countdownNumberEl = null;
  let p1AuraEl = null;
  let p2AuraEl = null;

  let lastCountdownVal = 0;
  let wasDoubleDamage = false;
  let bannerTimer = 0;
  let lastUpdateMs = 0;

  function ensureStyles() {
    if (styleInjected || typeof document === 'undefined' || !document.head) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.id = 'double-damage-effect-style';
    style.textContent = `
      .dd-countdown-box {
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
      }
      .dd-countdown-label {
        font: 800 clamp(0.85rem, 1.5vw, 1.15rem)/1.2 system-ui, sans-serif;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #fde68a;
        background: rgba(20, 8, 8, 0.72);
        border: 1px solid rgba(248, 113, 113, 0.55);
        border-radius: 999px;
        padding: 5px 16px;
        margin-bottom: 6px;
        text-shadow: 0 0 12px rgba(239, 68, 68, 0.85);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      }
      .dd-countdown-number {
        font: 900 clamp(3.6rem, 8.5vw, 6.4rem)/1 system-ui, sans-serif;
        color: #fff5f5;
        text-shadow:
          0 0 18px rgba(239, 68, 68, 0.95),
          0 0 42px rgba(220, 38, 38, 0.85),
          0 6px 24px rgba(0, 0, 0, 0.85);
        will-change: transform, opacity;
      }
      .dd-countdown-number.is-pop {
        animation: ddCountPop 0.36s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .dd-countdown-box.is-banner .dd-countdown-label {
        color: #fecaca;
        border-color: rgba(255, 70, 70, 0.85);
        background: rgba(127, 29, 29, 0.82);
      }
      .dd-countdown-box.is-banner .dd-countdown-number {
        font-size: clamp(2.4rem, 5.2vw, 4.2rem);
        letter-spacing: 0.08em;
        color: #ffedd5;
        text-shadow:
          0 0 22px rgba(255, 45, 45, 1),
          0 0 54px rgba(220, 38, 38, 0.95),
          0 6px 24px rgba(0, 0, 0, 0.88);
      }
      @keyframes ddCountPop {
        0% { transform: scale(1.48); opacity: 0.45; }
        100% { transform: scale(1); opacity: 1; }
      }

      .dd-screen-aura {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 50%;
        pointer-events: none;
        z-index: 102;
        box-shadow:
          inset 0 0 28px 6px rgba(255, 42, 42, 0.85),
          inset 0 0 72px 14px rgba(239, 68, 68, 0.48),
          inset 0 0 120px 20px rgba(255, 115, 36, 0.24);
        border: 3px solid rgba(255, 110, 90, 0.82);
        animation: ddAuraPulse 1.15s ease-in-out infinite;
      }
      .dd-screen-aura::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse at top, rgba(255, 68, 52, 0.28), transparent 42%),
          radial-gradient(ellipse at bottom, rgba(255, 42, 42, 0.30), transparent 44%),
          radial-gradient(ellipse at left, rgba(255, 58, 42, 0.24), transparent 36%),
          radial-gradient(ellipse at right, rgba(255, 58, 42, 0.24), transparent 36%);
        animation: ddAuraShimmer 1.6s ease-in-out infinite alternate;
      }
      .dd-aura-left { left: 0; }
      .dd-aura-right { left: 50%; }
      @keyframes ddAuraPulse {
        0%, 100% {
          opacity: 0.72;
          box-shadow:
            inset 0 0 24px 5px rgba(255, 42, 42, 0.78),
            inset 0 0 64px 12px rgba(239, 68, 68, 0.42),
            inset 0 0 105px 16px rgba(255, 115, 36, 0.20);
        }
        50% {
          opacity: 1;
          box-shadow:
            inset 0 0 38px 10px rgba(255, 62, 52, 0.96),
            inset 0 0 92px 20px rgba(239, 68, 68, 0.62),
            inset 0 0 145px 26px rgba(255, 130, 48, 0.34);
        }
      }
      @keyframes ddAuraShimmer {
        0% { opacity: 0.68; }
        100% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureUI() {
    if (uiInitialized || typeof document === 'undefined') return;
    const splitUi = document.querySelector?.('.ingame-split-ui');
    if (!splitUi || typeof document.createElement !== 'function') return;

    ensureStyles();

    p1AuraEl = document.createElement('div');
    p1AuraEl.id = 'p1-double-damage-aura';
    p1AuraEl.className = 'dd-screen-aura dd-aura-left';
    p1AuraEl.hidden = true;

    p2AuraEl = document.createElement('div');
    p2AuraEl.id = 'p2-double-damage-aura';
    p2AuraEl.className = 'dd-screen-aura dd-aura-right';
    p2AuraEl.hidden = true;

    countdownEl = document.createElement('div');
    countdownEl.id = 'double-damage-countdown';
    countdownEl.className = 'dd-countdown-box';
    countdownEl.hidden = true;

    countdownLabelEl = document.createElement('div');
    countdownLabelEl.className = 'dd-countdown-label';
    countdownLabelEl.textContent = '2X DAMAGE IN';

    countdownNumberEl = document.createElement('div');
    countdownNumberEl.className = 'dd-countdown-number';
    countdownNumberEl.textContent = '';

    countdownEl.append(countdownLabelEl, countdownNumberEl);
    splitUi.append(p1AuraEl, p2AuraEl, countdownEl);
    uiInitialized = true;
  }

  // 바닥의 4방향 노란/주황 쐐기 문양과 동일한 좌표에 겹쳐지는 붉은 발광 텍스처 생성
  function createRedWedgeTexture(THREE, isHalo = false) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = S / 2;
    const cy = S / 2;
    ctx.clearRect(0, 0, S, S);

    const wedgeAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    wedgeAngles.forEach((ang) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);

      ctx.beginPath();
      ctx.moveTo(S * 0.145, -42);
      ctx.lineTo(S * 0.385, -108);
      ctx.lineTo(S * 0.385, 108);
      ctx.lineTo(S * 0.145, 42);
      ctx.closePath();

      if (isHalo) {
        ctx.shadowColor = 'rgba(255, 36, 36, 1)';
        ctx.shadowBlur = 46;
        ctx.fillStyle = 'rgba(255, 58, 42, 0.55)';
        ctx.fill();
        ctx.lineWidth = 14;
        ctx.strokeStyle = 'rgba(255, 140, 110, 0.78)';
        ctx.stroke();
      } else {
        const grad = ctx.createLinearGradient(S * 0.145, 0, S * 0.385, 0);
        grad.addColorStop(0, '#ff4d4d');
        grad.addColorStop(0.45, '#ff1f2d');
        grad.addColorStop(1, '#d90d1f');
        ctx.shadowColor = 'rgba(255, 30, 30, 0.95)';
        ctx.shadowBlur = 24;
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff9a8a';
        ctx.lineWidth = 5;
        ctx.stroke();

        // 내부 발광 코어 라인
        ctx.strokeStyle = 'rgba(255, 224, 210, 0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(S * 0.17, -28);
        ctx.lineTo(S * 0.36, -78);
        ctx.stroke();
      }

      ctx.restore();
    });

    // 중앙 링도 붉게 빛나도록 추가
    ctx.save();
    ctx.shadowColor = 'rgba(255, 36, 36, 0.95)';
    ctx.shadowBlur = isHalo ? 32 : 16;
    ctx.strokeStyle = isHalo ? 'rgba(255, 64, 52, 0.6)' : 'rgba(255, 86, 72, 0.85)';
    ctx.lineWidth = isHalo ? 14 : 7;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function initFloorEffect(THREE, bgRefs) {
    if (!THREE || !bgRefs || !bgRefs.arenaGroup) return;
    bgRefsCache = bgRefs;

    if (bgRefs.amberGlowMat) {
      savedAmberColor = bgRefs.amberGlowMat.color?.getHex?.() ?? 0xffb84d;
      savedAmberEmissive = bgRefs.amberGlowMat.emissive?.getHex?.() ?? 0xff8c24;
    }
    if (bgRefs.orangeAccentMat) {
      savedOrangeColor = bgRefs.orangeAccentMat.color?.getHex?.() ?? 0xd97a38;
    }

    if (floorOverlayMesh || !THREE.CircleGeometry || !THREE.MeshBasicMaterial) return;

    const deckRadius = Number(bgRefs.deckRadius) || 4.55;
    const redTex = createRedWedgeTexture(THREE, false);
    if (redTex) {
      floorOverlayMat = new THREE.MeshBasicMaterial({
        map: redTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      floorOverlayMesh = new THREE.Mesh(
        new THREE.CircleGeometry(deckRadius * 0.96, 8),
        floorOverlayMat
      );
      floorOverlayMesh.rotation.x = -Math.PI / 2;
      floorOverlayMesh.rotation.z = Math.PI / 8;
      floorOverlayMesh.position.y = 0.006;
      floorOverlayMesh.visible = false;
      bgRefs.arenaGroup.add(floorOverlayMesh);
    }

    const haloTex = createRedWedgeTexture(THREE, true);
    if (haloTex) {
      floorHaloMat = new THREE.MeshBasicMaterial({
        map: haloTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      floorHaloMesh = new THREE.Mesh(
        new THREE.CircleGeometry(deckRadius * 0.96, 8),
        floorHaloMat
      );
      floorHaloMesh.rotation.x = -Math.PI / 2;
      floorHaloMesh.rotation.z = Math.PI / 8;
      floorHaloMesh.position.y = 0.011;
      floorHaloMesh.visible = false;
      bgRefs.arenaGroup.add(floorHaloMesh);
    }
  }

  function updateFloorVisual(isDoubleDamage, nowMs) {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0065);

    if (floorOverlayMesh && floorOverlayMat) {
      floorOverlayMesh.visible = isDoubleDamage;
      floorOverlayMat.opacity = isDoubleDamage ? 0.84 + pulse * 0.16 : 0;
    }
    if (floorHaloMesh && floorHaloMat) {
      floorHaloMesh.visible = isDoubleDamage;
      floorHaloMat.opacity = isDoubleDamage ? 0.45 + pulse * 0.45 : 0;
    }

    if (bgRefsCache?.amberGlowMat) {
      const mat = bgRefsCache.amberGlowMat;
      if (isDoubleDamage) {
        mat.color?.setHex?.(0xff3838);
        mat.emissive?.setHex?.(0xff1414);
        mat.emissiveIntensity = 1.2 + pulse * 0.8;
      } else {
        if (savedAmberColor !== null) mat.color?.setHex?.(savedAmberColor);
        if (savedAmberEmissive !== null) mat.emissive?.setHex?.(savedAmberEmissive);
        mat.emissiveIntensity = 0.95;
      }
    }

    if (bgRefsCache?.orangeAccentMat) {
      const mat = bgRefsCache.orangeAccentMat;
      if (isDoubleDamage) {
        mat.color?.setHex?.(0xd62424);
        mat.emissive?.setHex?.(0x990c0c);
        mat.emissiveIntensity = 0.45 + pulse * 0.35;
      } else {
        if (savedOrangeColor !== null) mat.color?.setHex?.(savedOrangeColor);
        mat.emissive?.setHex?.(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  }

  function update(setInfo) {
    ensureUI();
    const nowMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const dtSec = lastUpdateMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - lastUpdateMs) / 1000)) : 1 / 60;
    lastUpdateMs = nowMs;

    const isPlaying = Boolean(setInfo && setInfo.phase === 'PLAYING' && !setInfo.winner);
    const isDoubleDamage = Boolean(isPlaying && setInfo.isDoubleDamage);
    const countdownVal = isPlaying && !isDoubleDamage
      ? Math.max(0, Math.floor(Number(setInfo.countdownRemaining) || 0))
      : 0;

    // 1) 2배 데미지 진입 순간 배너 타이머 시작
    if (isDoubleDamage && !wasDoubleDamage) {
      bannerTimer = 1.8;
    } else if (!isDoubleDamage) {
      bannerTimer = 0;
    } else if (bannerTimer > 0) {
      bannerTimer = Math.max(0, bannerTimer - dtSec);
    }
    wasDoubleDamage = isDoubleDamage;

    // 2) 바닥 붉은 발광 이펙트 갱신
    updateFloorVisual(isDoubleDamage, nowMs);

    // 3) 각 플레이어 화면 빛나는 오오라 갱신
    if (p1AuraEl) p1AuraEl.hidden = !isDoubleDamage;
    if (p2AuraEl) p2AuraEl.hidden = !isDoubleDamage;

    // 4) 화면 중앙 10초 카운트다운 및 2X DAMAGE! 진입 배너 갱신
    if (countdownEl && countdownLabelEl && countdownNumberEl) {
      if (countdownVal > 0) {
        countdownEl.hidden = false;
        countdownEl.classList?.remove?.('is-banner');
        countdownLabelEl.textContent = '2X DAMAGE IN';
        if (countdownVal !== lastCountdownVal) {
          countdownNumberEl.textContent = String(countdownVal);
          countdownNumberEl.classList?.remove?.('is-pop');
          // 애니메이션 재실행 트리거
          void countdownNumberEl.offsetWidth;
          countdownNumberEl.classList?.add?.('is-pop');
        }
      } else if (bannerTimer > 0) {
        countdownEl.hidden = false;
        countdownEl.classList?.add?.('is-banner');
        countdownLabelEl.textContent = 'SUDDEN DEATH';
        countdownNumberEl.textContent = '2X DAMAGE!';
      } else {
        countdownEl.hidden = true;
      }
    }
    lastCountdownVal = countdownVal;
  }

  function reset() {
    lastCountdownVal = 0;
    wasDoubleDamage = false;
    bannerTimer = 0;
    updateFloorVisual(false, 0);
    if (p1AuraEl) p1AuraEl.hidden = true;
    if (p2AuraEl) p2AuraEl.hidden = true;
    if (countdownEl) countdownEl.hidden = true;
  }

  root.DoubleDamageEffect = {
    initFloorEffect,
    update,
    reset,
  };
})(globalThis);
