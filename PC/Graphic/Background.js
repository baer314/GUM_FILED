'use strict';
(function (root) {
  // 결정적 난수 생성기 (새로고침해도 소행성·별 배치가 항상 일정하게 유지됨)
  function createRng(seed = 20261124) {
    let s = seed >>> 0;
    return function next() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // 1. 가오갤풍 파스텔 성운 스카이돔 텍스처 (보라·청록·코랄)
  function createNebulaSkyTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 딥 인디고 우주 기본 그라데이션
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0.0, '#101428');
    bg.addColorStop(0.42, '#1b1d36');
    bg.addColorStop(0.68, '#231e36');
    bg.addColorStop(1.0, '#121324');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 좌우 경계 이음새 없이 부드럽게 감기는 성운 구름 그리기
    function drawWrappedCloud(cx, cy, rx, ry, rot, r, g, b, alpha) {
      for (const shiftX of [-W, 0, W]) {
        ctx.save();
        ctx.translate(cx + shiftX, cy);
        ctx.rotate(rot);
        ctx.scale(1, ry / rx);
        const grad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.45})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const rng = createRng(7741);

    // 큰 성운 컬러 덩어리 (보라, 청록, 코랄 오렌지)
    const heroClouds = [
      // P1 시야 쪽 (+X 부근) 보라 + 코랄 성운
      [W * 0.12, H * 0.36, 210, 130, -0.35, 92, 54, 156, 0.52],
      [W * 0.24, H * 0.48, 195, 115, 0.28, 224, 118, 86, 0.46],
      [W * 0.34, H * 0.32, 180, 120, -0.2, 46, 136, 134, 0.42],
      // P2 시야 쪽 (-X 부근) 청록 + 보라 + 은은한 코랄 성운
      [W * 0.54, H * 0.35, 220, 125, 0.22, 42, 132, 128, 0.48],
      [W * 0.68, H * 0.46, 200, 120, -0.3, 214, 120, 92, 0.38],
      [W * 0.80, H * 0.36, 225, 135, 0.18, 102, 58, 162, 0.50],
      [W * 0.94, H * 0.48, 185, 110, -0.25, 222, 124, 88, 0.40],
      // 하단 우주 안개 톤 보강
      [W * 0.25, H * 0.72, 240, 120, 0.1, 74, 52, 118, 0.34],
      [W * 0.75, H * 0.72, 240, 120, -0.1, 48, 92, 106, 0.34],
    ];

    heroClouds.forEach((c) => drawWrappedCloud(...c));

    // 회화적 붓터치 느낌의 잔구름 레이어
    const palette = [
      [112, 66, 178],
      [52, 150, 146],
      [232, 132, 96],
      [158, 84, 152],
      [76, 104, 168],
    ];
    for (let i = 0; i < 42; i++) {
      const col = palette[Math.floor(rng() * palette.length)];
      drawWrappedCloud(
        rng() * W,
        H * (0.18 + rng() * 0.64),
        45 + rng() * 95,
        24 + rng() * 55,
        (rng() - 0.5) * 1.4,
        col[0],
        col[1],
        col[2],
        0.12 + rng() * 0.14
      );
    }

    // 배경 원거리 미세 별점
    for (let i = 0; i < 240; i++) {
      const x = rng() * W;
      const y = H * (0.06 + rng() * 0.82);
      const r = 0.6 + rng() * 1.4;
      const a = 0.35 + rng() * 0.6;
      ctx.fillStyle = `rgba(244, 246, 255, ${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 2. 만화풍 4각 반짝임 별 스프라이트 텍스처
  function createSparkleTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const S = 128;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = S / 2;
    const cy = S / 2;

    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, S * 0.42);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    glow.addColorStop(0.35, 'rgba(210, 236, 255, 0.35)');
    glow.addColorStop(1, 'rgba(210, 236, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // 4각 십자 반짝임 실루엣
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, 10);
    ctx.quadraticCurveTo(cx + 5, cy - 5, S - 10, cy);
    ctx.quadraticCurveTo(cx + 5, cy + 5, cx, S - 10);
    ctx.quadraticCurveTo(cx - 5, cy + 5, 10, cy);
    ctx.quadraticCurveTo(cx - 5, cy - 5, cx, 10);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 3. 매트 파스텔 줄무늬 행성 & 고리 텍스처
  function createPlanetTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const W = 512;
    const H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bands = [
      [0.0, '#c8b4a8'],
      [0.14, '#e6d3bd'],
      [0.27, '#d9aa8e'],
      [0.40, '#ecdac4'],
      [0.52, '#c89e8c'],
      [0.65, '#e2c5ab'],
      [0.78, '#b69896'],
      [0.90, '#c9b3a4'],
      [1.0, '#a88d92'],
    ];

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    bands.forEach(([stop, color]) => grad.addColorStop(stop, color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 은은한 가로 띠 결
    for (let i = 0; i < 14; i++) {
      const y = (i / 14) * H;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 246, 234, 0.14)' : 'rgba(92, 68, 76, 0.12)';
      ctx.fillRect(0, y, W, 6 + (i % 3) * 4);
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function createPlanetRingTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const S = 512;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = S / 2;
    const cy = S / 2;
    const grad = ctx.createRadialGradient(cx, cy, S * 0.27, cx, cy, S * 0.5);
    grad.addColorStop(0.0, 'rgba(220, 200, 184, 0)');
    grad.addColorStop(0.08, 'rgba(210, 186, 170, 0.65)');
    grad.addColorStop(0.28, 'rgba(238, 222, 204, 0.82)');
    grad.addColorStop(0.44, 'rgba(182, 160, 152, 0.30)');
    grad.addColorStop(0.54, 'rgba(120, 108, 120, 0.08)');
    grad.addColorStop(0.64, 'rgba(226, 208, 192, 0.72)');
    grad.addColorStop(0.84, 'rgba(202, 182, 174, 0.52)');
    grad.addColorStop(1.0, 'rgba(180, 166, 170, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.5, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 4. 팔각형 우주 전초기지 상판 매트 텍스처 (청록 슬레이트 + 주황 포인트 패널)
  function createOutpostDeckTexture(THREE) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = S / 2;
    const cy = S / 2;

    // 매트 청록-슬레이트 기본 금속 바닥
    ctx.fillStyle = '#486c75';
    ctx.fillRect(0, 0, S, S);

    // 외곽 어두운 메탈 프레임 링
    ctx.strokeStyle = '#2d3b46';
    ctx.lineWidth = 44;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.445, 0, Math.PI * 2);
    ctx.stroke();

    // 4방향 주황색 포인트 쐐기 패널 (시안 1 배색)
    const wedgeAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    wedgeAngles.forEach((ang) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);

      ctx.fillStyle = '#db7c3a';
      ctx.beginPath();
      ctx.moveTo(S * 0.145, -42);
      ctx.lineTo(S * 0.385, -108);
      ctx.lineTo(S * 0.385, 108);
      ctx.lineTo(S * 0.145, 42);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#25323b';
      ctx.lineWidth = 8;
      ctx.stroke();

      // 패널 안쪽 밝은 하이라이트 라인
      ctx.strokeStyle = 'rgba(255, 224, 190, 0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(S * 0.17, -28);
      ctx.lineTo(S * 0.36, -78);
      ctx.stroke();

      ctx.restore();
    });

    // 대각선 패널 구분선 & 볼트 디테일
    ctx.strokeStyle = '#2a3942';
    ctx.lineWidth = 7;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * S * 0.14, cy + Math.sin(a) * S * 0.14);
      ctx.lineTo(cx + Math.cos(a) * S * 0.43, cy + Math.sin(a) * S * 0.43);
      ctx.stroke();
    }

    // 중간 격자 링
    ctx.strokeStyle = '#2f4550';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.29, 0, Math.PI * 2);
    ctx.stroke();

    // 중앙 결투 코어 패널
    ctx.fillStyle = '#3c5963';
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.145, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#24313a';
    ctx.lineWidth = 10;
    ctx.stroke();

    // 중앙 은은한 민트 가이드 링
    ctx.strokeStyle = 'rgba(130, 224, 212, 0.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.11, 0, Math.PI * 2);
    ctx.stroke();

    // 리벳(볼트) 포인트
    ctx.fillStyle = '#27343e';
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const rx = cx + Math.cos(a) * S * 0.41;
      const ry = cy + Math.sin(a) * S * 0.41;
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // 5. 각진 로우폴리 소행성/바위 지오메트리 (정점 균열 없는 일관된 변형)
  function createFacetedRockGeometry(THREE, radius, detail, rng, irregularity = 0.24) {
    const geom = detail > 0 && THREE.IcosahedronGeometry
      ? new THREE.IcosahedronGeometry(radius, detail)
      : new THREE.DodecahedronGeometry(radius, 0);

    const pos = geom.attributes && geom.attributes.position;
    if (!pos) return geom;

    const scaleMap = new Map();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;
      let s = scaleMap.get(key);
      if (s === undefined) {
        s = 1 + (rng() * 2 - 1) * irregularity;
        scaleMap.set(key, s);
      }
      pos.setXYZ(i, x * s, y * s, z * s);
    }
    geom.computeVertexNormals();
    return geom;
  }

  function setupBackground(THREE, scene) {
    if (!THREE || !scene) return;

    const rng = createRng(20261124);

    scene.background = new THREE.Color(0x14172b);
    // 원거리 소행성이 성운 안개 속으로 부드럽게 녹아드는 우주 안개
    if (THREE.FogExp2) {
      scene.fog = new THREE.FogExp2(0x28243d, 0.013);
    }

    // ---------------------------------------------------------
    // 1) 조명 구성 (매트 툰 질감 + 캐릭터 입체감 유지)
    // ---------------------------------------------------------
    const ambientLight = new THREE.AmbientLight(0xdce2f5, 0.42);
    scene.add(ambientLight);

    let hemiLight = null;
    if (THREE.HemisphereLight) {
      hemiLight = new THREE.HemisphereLight(0xb5c6f2, 0x4c3a4f, 0.58);
      scene.add(hemiLight);
    }

    const dirLight = new THREE.DirectionalLight(0xfff1dc, 0.88);
    dirLight.position.set(5, 10, 6);
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x64ced8, 0.36);
    rimLight.position.set(-7, 5, -7);
    scene.add(rimLight);

    // ---------------------------------------------------------
    // 2) 성운 스카이돔 (카메라 far=100 안에 들어오도록 반지름 74)
    // ---------------------------------------------------------
    let skyDome = null;
    if (THREE.SphereGeometry && THREE.MeshBasicMaterial) {
      const skyTex = createNebulaSkyTexture(THREE);
      const skyMat = new THREE.MeshBasicMaterial({
        map: skyTex || null,
        color: skyTex ? 0xffffff : 0x1a1d36,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      skyDome = new THREE.Mesh(new THREE.SphereGeometry(74, 32, 20), skyMat);
      scene.add(skyDome);
    }

    // ---------------------------------------------------------
    // 3) 3D 별 필드 + 만화풍 4각 반짝임 별
    // ---------------------------------------------------------
    let starPoints = null;
    if (THREE.BufferGeometry && THREE.Float32BufferAttribute && THREE.PointsMaterial && THREE.Points) {
      const starCount = 420;
      const positions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = 52 + rng() * 16;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      const starGeom = new THREE.BufferGeometry();
      starGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const starMat = new THREE.PointsMaterial({
        color: 0xf4f7ff,
        size: 0.32,
        transparent: true,
        opacity: 0.85,
        fog: false,
      });
      starPoints = new THREE.Points(starGeom, starMat);
      scene.add(starPoints);
    }

    const sparkleGroup = new THREE.Group();
    const sparkleTex = createSparkleTexture(THREE);
    if (sparkleTex && THREE.SpriteMaterial && THREE.Sprite) {
      const sparkleCoords = [
        // P2 시야 상단 (행성 주변 반짝임)
        [-38, 12.2, -3.5, 1.35],
        [-39, 10.6, -1.8, 0.85],
        [-37, 13.6, -14.5, 1.85],
        [-38, 11.4, -16.8, 1.10],
        [-40, 9.2, -13.2, 0.75],
        [-36, 12.8, 5.2, 1.05],
        // P1 시야 상단 은은한 반짝임
        [38, 11.8, 7.5, 1.30],
        [40, 10.0, 9.8, 0.90],
        [37, 13.2, -8.5, 1.15],
      ];
      sparkleCoords.forEach(([x, y, z, scale]) => {
        const mat = new THREE.SpriteMaterial({
          map: sparkleTex,
          color: 0xffffff,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          fog: false,
        });
        const sp = new THREE.Sprite(mat);
        sp.position.set(x, y, z);
        sp.scale.set(scale, scale, 1);
        sparkleGroup.add(sp);
      });
      scene.add(sparkleGroup);
    }

    // ---------------------------------------------------------
    // 4) 거대 매트 고리 행성 (P2 시야 우상단에 배치)
    // ---------------------------------------------------------
    const planetGroup = new THREE.Group();
    if (THREE.SphereGeometry && THREE.MeshStandardMaterial) {
      const planetTex = createPlanetTexture(THREE);
      const planetMat = new THREE.MeshStandardMaterial({
        map: planetTex || null,
        color: planetTex ? 0xffffff : 0xdec4ac,
        emissive: 0x45353c,
        emissiveIntensity: 0.38,
        roughness: 0.92,
        metalness: 0.0,
        fog: false,
      });
      const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(5.6, 32, 24), planetMat);
      planetGroup.add(planetMesh);

      if (THREE.RingGeometry && THREE.MeshBasicMaterial) {
        const ringTex = createPlanetRingTexture(THREE);
        const ringMat = new THREE.MeshBasicMaterial({
          map: ringTex || null,
          color: 0xefe0d0,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          fog: false,
        });
        const ringMesh = new THREE.Mesh(new THREE.RingGeometry(7.2, 11.6, 64), ringMat);
        ringMesh.rotation.x = Math.PI * 0.41;
        ringMesh.rotation.y = 0.24;
        planetGroup.add(ringMesh);
      }

      planetGroup.position.set(-44, 9.6, -10.2);
      planetGroup.rotation.z = -0.22;
      scene.add(planetGroup);
    }

    // ---------------------------------------------------------
    // 5) 로우폴리 팔각형 우주 전초기지 결투장 플랫폼 (상단 면 y = 0)
    // ---------------------------------------------------------
    const arenaGroup = new THREE.Group();
    const deckRadius = 4.55;

    if (THREE.CylinderGeometry && THREE.MeshStandardMaterial) {
      // 외곽 메탈 베이스 본체
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x354450,
        roughness: 0.85,
        metalness: 0.12,
        flatShading: true,
      });
      const baseMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(deckRadius, deckRadius * 0.9, 0.56, 8),
        baseMat
      );
      baseMesh.rotation.y = Math.PI / 8;
      baseMesh.position.y = -0.285;
      arenaGroup.add(baseMesh);

      // 하단 매달린 암석 기둥
      const underRockMat = new THREE.MeshStandardMaterial({
        color: 0x4f4a50,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      });
      const underCore = new THREE.Mesh(
        new THREE.CylinderGeometry(deckRadius * 0.78, deckRadius * 0.22, 2.2, 7),
        underRockMat
      );
      underCore.position.y = -1.62;
      arenaGroup.add(underCore);
    }

    // 팔각형 매트 도색 상판 (y = 0)
    let deckMesh = null;
    let deckMat = null;
    if (THREE.CircleGeometry && THREE.MeshStandardMaterial) {
      const deckTex = createOutpostDeckTexture(THREE);
      deckMat = new THREE.MeshStandardMaterial({
        map: deckTex || null,
        color: deckTex ? 0xffffff : 0x486c75,
        roughness: 0.86,
        metalness: 0.08,
      });
      deckMesh = new THREE.Mesh(new THREE.CircleGeometry(deckRadius * 0.96, 8), deckMat);
      deckMesh.rotation.x = -Math.PI / 2;
      deckMesh.rotation.z = Math.PI / 8;
      deckMesh.position.y = 0.002;
      arenaGroup.add(deckMesh);
    }

    // 팔각형 외곽 범퍼, 파이프 레일, 측면 발광 비콘(주황/청록)
    let orangeAccentMat = null;
    let amberGlowMat = null;
    if (THREE.BoxGeometry && THREE.MeshStandardMaterial) {
      const trimMat = new THREE.MeshStandardMaterial({
        color: 0x2a3640,
        roughness: 0.82,
        metalness: 0.15,
        flatShading: true,
      });
      orangeAccentMat = new THREE.MeshStandardMaterial({
        color: 0xd97a38,
        roughness: 0.78,
        metalness: 0.08,
        flatShading: true,
      });
      const cyanGlowMat = new THREE.MeshStandardMaterial({
        color: 0x62f2ff,
        emissive: 0x3ad8e8,
        emissiveIntensity: 0.95,
        roughness: 0.3,
      });
      amberGlowMat = new THREE.MeshStandardMaterial({
        color: 0xffb84d,
        emissive: 0xff8c24,
        emissiveIntensity: 0.95,
        roughness: 0.3,
      });

      const edgeApothem = deckRadius * Math.cos(Math.PI / 8); // 약 4.20
      const edgeLen = 2 * deckRadius * Math.sin(Math.PI / 8); // 약 3.48

      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const ex = Math.cos(ang) * (edgeApothem - 0.06);
        const ez = Math.sin(ang) * (edgeApothem - 0.06);

        const edgeGroup = new THREE.Group();
        edgeGroup.position.set(ex, 0, ez);
        edgeGroup.rotation.y = -ang + Math.PI / 2;

        // 외곽 턱(범퍼)
        const curb = new THREE.Mesh(new THREE.BoxGeometry(edgeLen * 0.92, 0.12, 0.24), trimMat);
        curb.position.y = 0.04;
        edgeGroup.add(curb);

        // 대각선·측면 외벽에 주황 장갑판과 발광 라이트 배치
        const bumper = new THREE.Mesh(
          new THREE.BoxGeometry(edgeLen * 0.42, 0.34, 0.26),
          i % 2 === 1 ? orangeAccentMat : trimMat
        );
        bumper.position.set(0, -0.24, 0.18);
        edgeGroup.add(bumper);

        const lightMat = i % 2 === 0 ? cyanGlowMat : amberGlowMat;
        [-0.36, 0.36].forEach((lx) => {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.08), lightMat);
          lamp.position.set(lx, -0.26, 0.31);
          edgeGroup.add(lamp);
        });

        // 양쪽 측면(±Z)에만 낮은 안전 난간 배치 (카메라 시야선 ±X는 완전히 비워둠)
        if (i === 2 || i === 6) {
          const topBar = new THREE.Mesh(new THREE.BoxGeometry(edgeLen * 0.62, 0.055, 0.055), trimMat);
          topBar.position.set(0, 0.46, 0.04);
          edgeGroup.add(topBar);

          const midBar = new THREE.Mesh(new THREE.BoxGeometry(edgeLen * 0.62, 0.045, 0.045), trimMat);
          midBar.position.set(0, 0.28, 0.04);
          edgeGroup.add(midBar);

          [-edgeLen * 0.28, 0, edgeLen * 0.28].forEach((px) => {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.06), trimMat);
            post.position.set(px, 0.23, 0.04);
            edgeGroup.add(post);
          });
        }

        arenaGroup.add(edgeGroup);
      }

      // 대각선 모서리 소품 (로우폴리 컨테이너 상자 & 전초기지 단말기)
      const crateColors = [0x4c6b4b, 0xc8743c, 0x5c6876, 0x7b634b];
      const crateSpots = [
        { x: 2.55, z: -2.65, w: 0.46, h: 0.38, d: 0.46, rot: 0.35, c: 0 },
        { x: 2.88, z: -2.28, w: 0.36, h: 0.30, d: 0.36, rot: -0.2, c: 1 },
        { x: 2.58, z: -2.62, y: 0.38, w: 0.32, h: 0.26, d: 0.32, rot: 0.6, c: 2 },
        { x: -2.62, z: 2.58, w: 0.48, h: 0.36, d: 0.42, rot: -0.4, c: 1 },
        { x: -2.22, z: 2.92, w: 0.36, h: 0.30, d: 0.36, rot: 0.25, c: 0 },
        { x: -2.60, z: 2.56, y: 0.36, w: 0.30, h: 0.24, d: 0.30, rot: 0.15, c: 3 },
      ];
      crateSpots.forEach((item) => {
        const mat = new THREE.MeshStandardMaterial({
          color: crateColors[item.c],
          roughness: 0.88,
          metalness: 0.05,
          flatShading: true,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.w, item.h, item.d), mat);
        mesh.position.set(item.x, (item.y || 0) + item.h / 2, item.z);
        mesh.rotation.y = item.rot;
        arenaGroup.add(mesh);
      });

      // 대각선 반대 모서리 로우폴리 단말기/비콘 2기
      const pylonSpots = [
        { x: 2.75, z: 2.75, rotY: -Math.PI * 0.75 },
        { x: -2.75, z: -2.75, rotY: Math.PI * 0.25 },
      ];
      pylonSpots.forEach((p) => {
        const pylon = new THREE.Group();
        pylon.position.set(p.x, 0, p.z);
        pylon.rotation.y = p.rotY;

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.72, 0.56), trimMat);
        body.position.y = 0.36;
        pylon.add(body);

        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.46), orangeAccentMat);
        cap.position.y = 0.80;
        pylon.add(cap);

        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.05), cyanGlowMat);
        screen.position.set(0, 0.50, 0.28);
        pylon.add(screen);

        arenaGroup.add(pylon);
      });
    }

    // 플랫폼 테두리를 감싸는 각진 로우폴리 암석 덩어리
    if (THREE.DodecahedronGeometry && THREE.MeshStandardMaterial) {
      const rimRockColors = [0x6a615c, 0x575258, 0x7a6c60, 0x4d4c56];
      for (let i = 0; i < 16; i++) {
        const ang = (i * Math.PI * 2) / 16 + (rng() - 0.5) * 0.16;
        const dist = deckRadius * (0.96 + rng() * 0.16);
        const rx = Math.cos(ang) * dist;
        const rz = Math.sin(ang) * dist;
        const rad = 0.48 + rng() * 0.46;

        const mat = new THREE.MeshStandardMaterial({
          color: rimRockColors[i % rimRockColors.length],
          roughness: 0.94,
          metalness: 0.03,
          flatShading: true,
        });
        const rock = new THREE.Mesh(createFacetedRockGeometry(THREE, rad, 0, rng, 0.28), mat);
        // 카메라 시야선(±X 중앙) 근처 바위는 아래로 낮춰 시야 확보
        const isCamCorridor = Math.abs(rz) < 1.3;
        rock.position.set(rx, isCamCorridor ? -0.58 - rng() * 0.25 : -0.32 - rng() * 0.35, rz);
        rock.scale.set(1.15, 0.78 + rng() * 0.35, 1.05);
        rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        arenaGroup.add(rock);
      }
    }

    scene.add(arenaGroup);

    // ---------------------------------------------------------
    // 6) 공중에 떠 있는 로우폴리 소행성 무리 (P1/P2 양쪽 시야 모두 배치)
    // ---------------------------------------------------------
    const asteroids = [];
    const asteroidGroup = new THREE.Group();
    if (THREE.DodecahedronGeometry && THREE.MeshStandardMaterial) {
      const asteroidPalette = [0x8b7669, 0x61727e, 0x73637d, 0x9c8878, 0x545e6d];

      // 시안 1 구도에 맞춘 대표(Hero) 소행성 배치
      const heroAsteroids = [
        // P1 좌상단 대형 각진 소행성
        { x: 17.5, y: 5.8, z: -5.4, r: 1.85, detail: 1, col: 0x8f7766, sx: 0.9, sy: 1.15, sz: 0.85 },
        // P1 우측 중거리 소행성
        { x: 19.5, y: 2.2, z: 5.8, r: 1.25, detail: 0, col: 0x5f7480, sx: 1.25, sy: 0.85, sz: 1.0 },
        { x: 24.0, y: 7.4, z: 7.2, r: 1.45, detail: 0, col: 0x6f5f7a, sx: 1.0, sy: 1.2, sz: 0.9 },
        // P2 좌상단 & 우측 소행성
        { x: -16.5, y: 5.6, z: 5.2, r: 1.55, detail: 0, col: 0x647886, sx: 1.05, sy: 0.95, sz: 1.1 },
        { x: -20.5, y: 4.0, z: -8.6, r: 1.75, detail: 1, col: 0x9b897a, sx: 1.1, sy: 0.9, sz: 1.0 },
        { x: -14.5, y: 0.6, z: -5.6, r: 0.88, detail: 0, col: 0x84746a, sx: 1.15, sy: 0.85, sz: 0.95 },
      ];

      heroAsteroids.forEach((a) => {
        const mat = new THREE.MeshStandardMaterial({
          color: a.col,
          roughness: 0.92,
          metalness: 0.04,
          flatShading: true,
        });
        const mesh = new THREE.Mesh(createFacetedRockGeometry(THREE, a.r, a.detail, rng, 0.22), mat);
        mesh.position.set(a.x, a.y, a.z);
        mesh.scale.set(a.sx, a.sy, a.sz);
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        asteroidGroup.add(mesh);
        asteroids.push(mesh);
      });

      // 사방 원거리 떠다니는 소행성 띠 (38개)
      for (let i = 0; i < 38; i++) {
        const ang = (i / 38) * Math.PI * 2 + (rng() - 0.5) * 0.22;
        const dist = 12.5 + rng() * 25.0;
        const ax = Math.cos(ang) * dist;
        const az = Math.sin(ang) * dist;
        const ay = -3.8 + rng() * 14.5;
        const rad = 0.34 + rng() * 0.95;

        const mat = new THREE.MeshStandardMaterial({
          color: asteroidPalette[Math.floor(rng() * asteroidPalette.length)],
          roughness: 0.93,
          metalness: 0.03,
          flatShading: true,
        });
        const mesh = new THREE.Mesh(
          createFacetedRockGeometry(THREE, rad, rad > 0.85 ? 1 : 0, rng, 0.25),
          mat
        );
        mesh.position.set(ax, ay, az);
        mesh.scale.set(0.8 + rng() * 0.5, 0.75 + rng() * 0.5, 0.8 + rng() * 0.5);
        mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        asteroidGroup.add(mesh);
        asteroids.push(mesh);
      }

      scene.add(asteroidGroup);
    }

    return {
      ambientLight,
      hemiLight,
      dirLight,
      rimLight,
      grid: arenaGroup,
      arenaGroup,
      deckRadius,
      deckMesh,
      deckMat,
      orangeAccentMat,
      amberGlowMat,
      skyDome,
      starPoints,
      sparkleGroup,
      planetGroup,
      asteroidGroup,
      asteroids,
    };
  }

  root.BackgroundGraphic = {
    setupBackground,
  };
})(globalThis);