'use strict';
(function (root) {
  // 어깨너비(SHOULDER_HALF_WIDTH * 2 = 0.88)를 지름으로 갖는 구형 머리 모델
  const DEFAULT_SHOULDER_HALF_WIDTH = 0.44;

  // =========================================================
  // 디자인 커스텀 설정값 (필요 시 이 부분만 수정)
  // =========================================================
  // 정면 방향: 화면에서 얼굴이 뒤를 보고 있으면 1 <-> -1 로 변경
  const FACE_DIR_Z = -1;
  // 머리 외피 색상
  const SHELL_COLOR = null;
  // LED 눈 색상: null로 두면 P1/P2 각자 전달받은 팀 색상(color)으로 발광
  const EYE_COLOR = null;
  // 플레이어 2 줄무늬 색상 및 두께
  const P2_STRIPE_COLOR = 0xff7a1a;
  const STRIPE_HALF_WIDTH = 0.015;

  function getHeadRadius() {
    return root.ArmGraphic?.SHOULDER_HALF_WIDTH ?? DEFAULT_SHOULDER_HALF_WIDTH;
  }

  function resolveRgb(THREE, colorVal, fallback = { r: 77, g: 166, b: 255 }) {
    if (THREE.Color && colorVal !== null && colorVal !== undefined) {
      const c = new THREE.Color(colorVal);
      return {
        r: Math.round(c.r * 255),
        g: Math.round(c.g * 255),
        b: Math.round(c.b * 255),
      };
    }
    return fallback;
  }

  // 전달된 팀 색상(color)을 기준으로 플레이어 2(주황/난색 계열) 여부 판별
  function isPlayer2Color(THREE, colorVal) {
    if (colorVal === null || colorVal !== undefined) return false;
    const { r, g, b } = resolveRgb(THREE, colorVal, { r: 142, g: 202, b: 177 });
    return r > b + 30 && r >= g - 15 && r > 120;
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // 화이트 원형 쉘 + (P2 전용) 시안 위치에 맞춘 부분 주황 줄무늬 텍스처 생성
  function createShellTexture(THREE, shellColorVal, stripeColorVal, withStripes) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const shellRgb = resolveRgb(THREE, shellColorVal, { r: 244, g: 246, b: 248 });
    ctx.fillStyle = `rgb(${shellRgb.r}, ${shellRgb.g}, ${shellRgb.b})`;
    ctx.fillRect(0, 0, W, H);

    if (withStripes) {
      const stripeRgb = resolveRgb(THREE, stripeColorVal, { r: 255, g: 122, b: 26 });
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      const aa = 0.006;

      for (let py = 0; py < H; py++) {
        const theta = ((py + 0.5) / H) * Math.PI;
        const sinT = Math.sin(theta);
        const ny = Math.cos(theta);

        for (let px = 0; px < W; px++) {
          const phi = ((px + 0.5) / W) * Math.PI * 2;
          const nx = -Math.cos(phi) * sinT;
          const nz = FACE_DIR_Z * Math.sin(phi) * sinT;

          // 정면 반구(nz >= 0, 바이저 테두리 ~ 외곽 실루엣까지만) 제한 마스크
          const frontMask = smoothstep(-0.015, 0.015, nz);
          if (frontMask <= 0.001) continue;

          // 1) 이마 위 세로 2줄: 바이저 상단(ny ≈ 0.36)부터 정수리 끝(nz = 0)까지만
          let topAlpha = 0;
          if (ny > 0.34) {
            const topStartMask = smoothstep(0.34, 0.38, ny);
            const dTopLeft = Math.abs(nx + 0.19);
            const dTopRight = Math.abs(nx - 0.19);
            const dTop = Math.min(dTopLeft, dTopRight);
            topAlpha = (1 - smoothstep(STRIPE_HALF_WIDTH - aa, STRIPE_HALF_WIDTH + aa, dTop)) * topStartMask;
          }

          // 2) 좌우 측면 가로 2쌍: 바이저 좌우 테두리(|nx| ≈ 0.52)부터 옆면 외곽(nz = 0)까지만
          let sideAlpha = 0;
          const absX = Math.abs(nx);
          if (absX > 0.50) {
            const sideStartMask = smoothstep(0.50, 0.55, absX);
            const tiltedY = ny - 0.08 * (absX - 0.55);
            const dSideUpper = Math.abs(tiltedY + 0.03);
            const dSideLower = Math.abs(tiltedY + 0.16);
            const dSide = Math.min(dSideUpper, dSideLower);
            sideAlpha = (1 - smoothstep(STRIPE_HALF_WIDTH - aa, STRIPE_HALF_WIDTH + aa, dSide)) * sideStartMask;
          }

          const alpha = Math.max(topAlpha, sideAlpha) * frontMask;

          if (alpha > 0.001) {
            const idx = (py * W + px) * 4;
            data[idx] = Math.round(shellRgb.r * (1 - alpha) + stripeRgb.r * alpha);
            data[idx + 1] = Math.round(shellRgb.g * (1 - alpha) + stripeRgb.g * alpha);
            data[idx + 2] = Math.round(shellRgb.b * (1 - alpha) + stripeRgb.b * alpha);
            data[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 둥근 아치형 블랙 글로시 바이저 텍스처 생성
  function createVisorTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 512;
    const H = 400;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(256, 354);
    ctx.bezierCurveTo(396, 354, 466, 322, 462, 230);
    ctx.bezierCurveTo(458, 120, 376, 50, 256, 50);
    ctx.bezierCurveTo(136, 50, 54, 120, 50, 230);
    ctx.bezierCurveTo(46, 322, 116, 354, 256, 354);
    ctx.closePath();

    const baseGrad = ctx.createRadialGradient(295, 135, 18, 256, 210, 240);
    baseGrad.addColorStop(0, '#1a1f26');
    baseGrad.addColorStop(0.55, '#07080a');
    baseGrad.addColorStop(1, '#020203');
    ctx.fillStyle = baseGrad;
    ctx.fill();

    ctx.clip();
    const sheenGrad = ctx.createLinearGradient(360, 40, 215, 255);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
    sheenGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
    sheenGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheenGrad;
    ctx.beginPath();
    ctx.ellipse(342, 126, 125, 82, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 수평 스캔라인이 들어간 발광 LED 눈 텍스처 생성
  function createEyeTexture(THREE, eyeColorVal) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 512;
    const H = 400;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const { r, g, b } = resolveRgb(THREE, eyeColorVal);
    const coreR = Math.min(255, r + 115);
    const coreG = Math.min(255, g + 95);
    const coreB = Math.min(255, b + 60);
    const deepR = Math.max(0, Math.round(r * 0.55));
    const deepG = Math.max(0, Math.round(g * 0.65));
    const deepB = Math.max(0, Math.round(b * 0.92));

    const eyes = [
      { x: 176, y: 224, rx: 58, ry: 42, rot: 0.16 },
      { x: 336, y: 224, rx: 58, ry: 42, rot: -0.16 },
    ];

    eyes.forEach((eye) => {
      ctx.save();
      ctx.translate(eye.x, eye.y);
      ctx.rotate(eye.rot);
      ctx.scale(1, eye.ry / eye.rx);
      const glowGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, eye.rx * 1.45);
      glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.58)`);
      glowGrad.addColorStop(0.55, `rgba(${deepR}, ${deepG}, ${deepB}, 0.25)`);
      glowGrad.addColorStop(1, `rgba(${deepR}, ${deepG}, ${deepB}, 0)`);
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, eye.rx * 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = W;
    scanCanvas.height = H;
    const sctx = scanCanvas.getContext('2d');

    if (sctx) {
      eyes.forEach((eye) => {
        sctx.save();
        sctx.translate(eye.x, eye.y);
        sctx.rotate(eye.rot);
        sctx.scale(1, eye.ry / eye.rx);
        const eyeGrad = sctx.createRadialGradient(0, 0, 4, 0, 0, eye.rx);
        eyeGrad.addColorStop(0, `rgb(${coreR}, ${coreG}, ${coreB})`);
        eyeGrad.addColorStop(0.48, `rgb(${r}, ${g}, ${b})`);
        eyeGrad.addColorStop(0.84, `rgb(${deepR}, ${deepG}, ${deepB})`);
        eyeGrad.addColorStop(1, `rgba(${deepR}, ${deepG}, ${deepB}, 0)`);
        sctx.fillStyle = eyeGrad;
        sctx.beginPath();
        sctx.arc(0, 0, eye.rx, 0, Math.PI * 2);
        sctx.fill();
        sctx.restore();
      });

      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
      for (let y = 0; y < H; y += 8) {
        sctx.fillRect(0, y, W, 3);
      }
      sctx.globalCompositeOperation = 'source-over';

      ctx.drawImage(scanCanvas, 0, 0);
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 피격(HIT) 시 표시되는 X 모양 발광 LED 눈 텍스처 생성
  function createHitEyeTexture(THREE, eyeColorVal) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 512;
    const H = 400;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const { r, g, b } = resolveRgb(THREE, eyeColorVal);
    const coreR = Math.min(255, r + 130);
    const coreG = Math.min(255, g + 110);
    const coreB = Math.min(255, b + 80);
    const deepR = Math.max(0, Math.round(r * 0.55));
    const deepG = Math.max(0, Math.round(g * 0.65));
    const deepB = Math.max(0, Math.round(b * 0.92));

    const eyes = [
      { x: 176, y: 224, sizeX: 38, sizeY: 36, rot: 0.08 },
      { x: 336, y: 224, sizeX: 38, sizeY: 36, rot: -0.08 },
    ];

    // 1) 부드러운 외곽 발광 헤일로
    eyes.forEach((eye) => {
      ctx.save();
      ctx.translate(eye.x, eye.y);
      const glowGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, 76);
      glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.62)`);
      glowGrad.addColorStop(0.55, `rgba(${deepR}, ${deepG}, ${deepB}, 0.24)`);
      glowGrad.addColorStop(1, `rgba(${deepR}, ${deepG}, ${deepB}, 0)`);
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 76, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 2) 스캔라인이 적용된 선명한 X 눈 본체
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = W;
    scanCanvas.height = H;
    const sctx = scanCanvas.getContext('2d');

    if (sctx) {
      eyes.forEach((eye) => {
        sctx.save();
        sctx.translate(eye.x, eye.y);
        sctx.rotate(eye.rot);
        sctx.lineCap = 'round';

        const drawX = (strokeStyle, lineWidth, shadowBlur) => {
          sctx.strokeStyle = strokeStyle;
          sctx.lineWidth = lineWidth;
          sctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.95)`;
          sctx.shadowBlur = shadowBlur;
          sctx.beginPath();
          sctx.moveTo(-eye.sizeX, -eye.sizeY);
          sctx.lineTo(eye.sizeX, eye.sizeY);
          sctx.moveTo(eye.sizeX, -eye.sizeY);
          sctx.lineTo(-eye.sizeX, eye.sizeY);
          sctx.stroke();
        };

        drawX(`rgb(${r}, ${g}, ${b})`, 20, 18);
        drawX(`rgb(${coreR}, ${coreG}, ${coreB})`, 10, 6);
        sctx.restore();
      });

      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      for (let y = 0; y < H; y += 8) {
        sctx.fillRect(0, y, W, 3);
      }
      sctx.globalCompositeOperation = 'source-over';

      ctx.drawImage(scanCanvas, 0, 0);
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function createHead(THREE, color = 0x8ecab1, initialOffsetZ = 0, options = {}) {
    const radius = getHeadRadius();
    const offsetZ = Number.isFinite(Number(initialOffsetZ)) ? Number(initialOffsetZ) : 0;
    const headGroup = new THREE.Group();
    // armPivot 기준 양쪽 어깨 중심(y = 0, z = offsetZ)에 구의 바닥면이 접하도록 중심을 (0, radius, offsetZ)에 배치
    headGroup.position.set(0, radius, offsetZ);

    const hasStripes = typeof options?.stripes === 'boolean'
      ? options.stripes
      : isPlayer2Color(THREE, color);

    let headMesh = null;
    let headMat = null;
    let visorMesh = null;
    let visorMat = null;
    let eyeMesh = null;
    let eyeMat = null;
    let normalEyeTex = null;
    let hitEyeTex = null;
    let currentEyeExpression = 'NORMAL';

    if (THREE.SphereGeometry && THREE.MeshStandardMaterial) {
      // 1. 유광 원형 머리 본체 (P2는 시안 위치에만 부분 주황 줄무늬 포함)
      const resolvedShellColor = SHELL_COLOR !== null ? SHELL_COLOR : color;
      const shellTex = createShellTexture(THREE, resolvedShellColor, P2_STRIPE_COLOR, hasStripes);

      headMat = new THREE.MeshStandardMaterial({
        color: shellTex ? 0xffffff : resolvedShellColor,
        map: shellTex || null,
        roughness: 0.16,
        metalness: 0.08,
        transparent: true,
        opacity: 1.0,
      });
      headMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 20),
        headMat
      );
      headGroup.add(headMesh);

      // 2. 원형 구 표면을 감싸는 곡면 블랙 바이저 & 발광 LED 눈
      const visorTex = createVisorTexture(THREE);
      const resolvedEyeColor = EYE_COLOR !== null ? EYE_COLOR : color;
      normalEyeTex = createEyeTexture(THREE, resolvedEyeColor);
      hitEyeTex = createHitEyeTexture(THREE, resolvedEyeColor);

      if (visorTex) {
        const phiLength = Math.PI * 0.56;
        const centerPhi = FACE_DIR_Z >= 0 ? Math.PI * 0.5 : Math.PI * 1.5;
        const phiStart = centerPhi - phiLength / 2;
        const thetaStart = Math.PI * 0.30;
        const thetaLength = Math.PI * 0.44;

        visorMat = new THREE.MeshStandardMaterial({
          map: visorTex,
          roughness: 0.08,
          metalness: 0.25,
          transparent: true,
          opacity: 1.0,
          depthWrite: false,
        });
        visorMesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 1.01, 24, 16, phiStart, phiLength, thetaStart, thetaLength),
          visorMat
        );
        visorMesh.renderOrder = 1;
        headGroup.add(visorMesh);

        if (normalEyeTex) {
          const EyeMaterialCtor = THREE.MeshBasicMaterial || THREE.MeshStandardMaterial;
          eyeMat = new EyeMaterialCtor({
            map: normalEyeTex,
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
          });
          eyeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 1.016, 24, 16, phiStart, phiLength, thetaStart, thetaLength),
            eyeMat
          );
          eyeMesh.renderOrder = 2;
          headGroup.add(eyeMesh);
        }
      }
    }

    function setStripes(enabled) {
      if (!headMat) return;
      const resolvedShellColor = SHELL_COLOR !== null ? SHELL_COLOR : color;
      const nextTex = createShellTexture(THREE, resolvedShellColor, P2_STRIPE_COLOR, Boolean(enabled));
      if (headMat.map && headMat.map.dispose) headMat.map.dispose();
      headMat.map = nextTex;
      headMat.color?.setHex(nextTex ? 0xffffff : resolvedShellColor);
      headMat.needsUpdate = true;
      headGroup.userData.hasStripes = Boolean(enabled);
    }

    let lastAppliedOpacity = 1.0;

    function setOpacity(opacity) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
      if (Math.abs(clamped - lastAppliedOpacity) < 0.001) return;
      lastAppliedOpacity = clamped;
      const isVisible = clamped > 0;

      if (headMesh) headMesh.visible = isVisible;
      if (visorMesh) visorMesh.visible = isVisible;
      if (eyeMesh) eyeMesh.visible = isVisible;

      // transparent=true를 고정 유지해 매 프레임 셰이더 재컴파일(needsUpdate=true) 방지
      if (headMat) {
        headMat.opacity = clamped;
        headMat.depthWrite = clamped >= 1;
      }
      if (visorMat) {
        visorMat.opacity = clamped;
      }
      if (eyeMat) {
        eyeMat.opacity = clamped;
      }
    }

    function setOffsetZ(nextOffsetZ) {
      const z = Number.isFinite(Number(nextOffsetZ)) ? Number(nextOffsetZ) : 0;
      headGroup.userData.offsetZ = z;
      const shake = headGroup.userData.shakeOffset || { x: 0, y: 0, z: 0 };
      headGroup.position?.set(shake.x, radius + shake.y, z + shake.z);
    }

    function setShakeOffset(x = 0, y = 0, z = 0) {
      const sx = Number.isFinite(Number(x)) ? Number(x) : 0;
      const sy = Number.isFinite(Number(y)) ? Number(y) : 0;
      const sz = Number.isFinite(Number(z)) ? Number(z) : 0;
      headGroup.userData.shakeOffset = { x: sx, y: sy, z: sz };
      const baseZ = Number.isFinite(Number(headGroup.userData.offsetZ)) ? Number(headGroup.userData.offsetZ) : 0;
      headGroup.position?.set(sx, radius + sy, baseZ + sz);
    }

    function setRotationOffset(rx = 0, ry = 0, rz = 0) {
      const x = Number.isFinite(Number(rx)) ? Number(rx) : 0;
      const y = Number.isFinite(Number(ry)) ? Number(ry) : 0;
      const z = Number.isFinite(Number(rz)) ? Number(rz) : 0;
      headGroup.userData.rotationOffset = { x, y, z };
      headGroup.rotation?.set(x, y, z);
    }

    function setEyeExpression(expression = 'NORMAL') {
      const nextExpr = expression === 'HIT' ? 'HIT' : 'NORMAL';
      if (currentEyeExpression === nextExpr) return;
      currentEyeExpression = nextExpr;
      headGroup.userData.eyeExpression = nextExpr;
      if (!eyeMat) return;
      const targetTex = nextExpr === 'HIT' ? (hitEyeTex || normalEyeTex) : normalEyeTex;
      if (targetTex && eyeMat.map !== targetTex) {
        eyeMat.map = targetTex;
        eyeMat.needsUpdate = true;
      }
    }

    headGroup.userData = {
      headMesh,
      headMat,
      visorMesh,
      visorMat,
      eyeMesh,
      eyeMat,
      radius,
      diameter: radius * 2,
      offsetZ,
      hasStripes,
      eyeExpression: currentEyeExpression,
      shakeOffset: { x: 0, y: 0, z: 0 },
      rotationOffset: { x: 0, y: 0, z: 0 },
      setStripes,
      setOpacity,
      setOffsetZ,
      setShakeOffset,
      setRotationOffset,
      setEyeExpression,
    };

    return headGroup;
  }

  root.HeadGraphic = {
    DEFAULT_SHOULDER_HALF_WIDTH,
    getHeadRadius,
    getHeadDiameter: () => getHeadRadius() * 2,
    createHead,
  };
})(globalThis);