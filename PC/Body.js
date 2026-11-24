'use strict';
(function (root) {
  const DEFAULT_SHOULDER_HALF_WIDTH = 0.44;
  // inGameFront.js 기준 로컬 -Z가 상대방을 바라보는 정면
  const FACE_DIR_Z = -1;
  // null로 두면 Head.js의 눈과 동일하게 각 플레이어 팀 색상(color)을 그대로 사용
  const BODY_COLOR = null;

  // =========================================================
  // 근육 볼륨 / 음영 조절값 (원하는 느낌에 맞게 숫자만 조정)
  // =========================================================
  const MUSCLE_DEPTH = 1.0;   // 0.7(슬림) ~ 1.3(강한 벌크업)
  const GROOVE_SHADOW = 0.28; // 근육 굴곡 음영 강도 (0.0 ~ 0.45)

  function getShoulderHalfWidth() {
    return root.ArmGraphic?.SHOULDER_HALF_WIDTH ?? DEFAULT_SHOULDER_HALF_WIDTH;
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function gauss(x, mu, sigma) {
    const d = (x - mu) / sigma;
    return Math.exp(-0.5 * d * d);
  }

  // 역삼각형 남성 체형 + 대흉근/복근/광배근/등 굴곡을 3D 메쉬로 조각
  function createMuscularTorsoGeometry(THREE, shoulderHalfWidth, bodyHeight) {
    const geom = new THREE.CylinderGeometry(1, 1, 1, 64, 48, false);
    const pos = geom.attributes && geom.attributes.position;
    if (!pos) return geom;

    const widthScale = shoulderHalfWidth / DEFAULT_SHOULDER_HALF_WIDTH;
    const count = pos.count;
    const colors = THREE.BufferAttribute ? new Float32Array(count * 3) : null;
    const topY = -0.03;
    const spanY = bodyHeight - 0.03;

    for (let i = 0; i < count; i++) {
      const ox = pos.getX(i);
      const oy = pos.getY(i);
      const oz = pos.getZ(i);

      // t: 0(목/어깨 상단) -> 1(골반/하단)
      const t = Math.min(1, Math.max(0, 0.5 - oy));
      const radial = Math.hypot(ox, oz);

      let y = topY - t * spanY;

      // 상/하단 캡 중심점 처리
      if (radial < 1e-5) {
        if (t < 0.5) y = topY - 0.02;
        pos.setXYZ(i, 0, y, 0);
        if (colors) {
          colors[i * 3] = 0.85;
          colors[i * 3 + 1] = 0.85;
          colors[i * 3 + 2] = 0.85;
        }
        continue;
      }

      const ux = ox / radial;
      const uz = oz / radial;
      const front = uz * FACE_DIR_Z; // +1: 정면 중앙, -1: 등 중앙, 0: 양옆
      const back = -front;
      const absX = Math.abs(ux);
      const wallMask = smoothstep(0.65, 1.0, radial);

      // 1) 기본 역삼각형(V-테이퍼) 남성 실루엣
      let baseRx = (
        0.205
        + 0.185 * gauss(t, 0.22, 0.20) // 넓은 가슴/어깨
        + 0.055 * gauss(t, 0.86, 0.11) // 탄탄한 골반 라인
      ) * widthScale;

      let baseRz = (
        0.152
        + 0.068 * gauss(t, 0.24, 0.22) // 두꺼운 흉곽
        + 0.025 * gauss(t, 0.86, 0.12)
      ) * widthScale;

      // 상단(승모근 쪽)과 하단(로봇 바디 끝) 둥글게 마감
      let roundFactor = 1.0;
      if (t < 0.09) {
        const u = (0.09 - t) / 0.09;
        roundFactor *= 0.58 + 0.42 * Math.sqrt(Math.max(0, 1 - u * u));
      }
      if (t > 0.88) {
        const u = (t - 0.88) / 0.12;
        roundFactor *= 0.28 + 0.72 * Math.sqrt(Math.max(0, 1 - u * u));
      }

      // 원통보다 각진 남성형 상체 단면(스쿼클 보정)
      const angle = Math.atan2(uz, ux);
      const squircle = 1 + 0.055 * Math.pow(Math.sin(2 * angle), 2);

      // 승모근 경사: 목 중앙은 살짝 높고 어깨 바깥쪽으로 자연스럽게 내려감
      if (t < 0.14) {
        const trapSlope = (1 - t / 0.14) * (1 - absX) * 0.024 * wallMask;
        y += trapSlope;
      }

      // 2) 대흉근 (Pectorals) + 가슴 중앙 골(Sternum)
      const pecFront = smoothstep(0.08, 0.52, front);
      const pecVert = gauss(t, 0.255, 0.082) * smoothstep(0.41, 0.325, t) * smoothstep(0.07, 0.15, t);
      const pecLobe = gauss(absX, 0.43, 0.27) * smoothstep(0.03, 0.19, absX);
      const pecDisp = 0.056 * pecVert * pecLobe * pecFront * MUSCLE_DEPTH;

      const sternumMask = gauss(absX, 0, 0.085) * gauss(t, 0.27, 0.11) * smoothstep(0.50, 0.95, front);
      const sternumGroove = -0.019 * sternumMask * MUSCLE_DEPTH;
      const underPecCrease = gauss(t, 0.378, 0.022) * smoothstep(0.10, 0.30, absX) * smoothstep(0.85, 0.55, absX) * pecFront;

      // 3) 6팩 복근 (Abdominals) + 중앙 세로선(Linea Alba)
      const abFront = smoothstep(0.42, 0.84, front);
      const abCol = gauss(absX, 0.21, 0.115) * smoothstep(0.02, 0.105, absX);
      const abRow1 = gauss(t, 0.455, 0.036);
      const abRow2 = gauss(t, 0.565, 0.036);
      const abRow3 = gauss(t, 0.680, 0.042);
      const abSum = abRow1 + abRow2 + 0.92 * abRow3;
      const abDisp = 0.028 * abSum * abCol * abFront * MUSCLE_DEPTH;

      const abCenterMask = gauss(absX, 0, 0.055) * smoothstep(0.37, 0.43, t) * smoothstep(0.77, 0.69, t) * smoothstep(0.68, 0.98, front);
      const abCenterGroove = -0.012 * abCenterMask * MUSCLE_DEPTH;
      const abHorizCrease = (
        gauss(t, 0.510, 0.015) + gauss(t, 0.620, 0.015)
      ) * smoothstep(0.05, 0.15, absX) * smoothstep(0.42, 0.30, absX) * abFront;

      // 4) 옆구리 외복사근(Obliques) & 광배근(Lats)
      const obliqueDisp = 0.020 * gauss(absX, 0.74, 0.17) * gauss(t, 0.62, 0.12) * smoothstep(-0.10, 0.45, front) * MUSCLE_DEPTH;
      const latDispX = 0.040 * gauss(t, 0.28, 0.12) * smoothstep(0.55, 0.95, absX) * smoothstep(0.45, -0.35, front) * MUSCLE_DEPTH;

      // 5) 등 근육(견갑골/광배 상부 + 척추기립근) & 척추 홈 (본인 3인칭 뒷모습 디테일)
      const backMask = smoothstep(0.14, 0.62, back);
      const upperBack = 0.036 * gauss(t, 0.25, 0.12) * gauss(absX, 0.40, 0.24) * smoothstep(0.05, 0.19, absX) * backMask * MUSCLE_DEPTH;
      const lowerBack = 0.020 * gauss(t, 0.58, 0.14) * gauss(absX, 0.24, 0.14) * smoothstep(0.04, 0.14, absX) * backMask * MUSCLE_DEPTH;
      const spineMask = gauss(absX, 0, 0.085) * smoothstep(0.08, 0.18, t) * smoothstep(0.88, 0.72, t) * smoothstep(0.55, 0.95, back);
      const spineGroove = -0.024 * spineMask * MUSCLE_DEPTH;

      // 최종 정점 좌표 계산
      const rx = baseRx * roundFactor * radial * squircle;
      const rz = baseRz * roundFactor * radial * squircle;

      const signX = ux >= 0 ? 1 : -1;
      const finalX = ux * rx + signX * latDispX * wallMask * widthScale;
      const frontBump = (pecDisp + sternumGroove + abDisp + abCenterGroove + obliqueDisp) * wallMask;
      const backBump = (upperBack + lowerBack + spineGroove) * wallMask;
      const finalZ = uz * rz + FACE_DIR_Z * frontBump - FACE_DIR_Z * backBump;

      pos.setXYZ(i, finalX, y, finalZ);

      // 근육 굴곡 음영(Vertex AO): 홈은 살짝 어둡게, 근육 봉우리는 밝게 처리해 굴곡 강조
      if (colors) {
        const crease = Math.min(1,
          sternumMask * 0.95
          + underPecCrease * 0.85
          + abCenterMask * 0.75
          + abHorizCrease * 0.65
          + spineMask * 0.90
        ) * wallMask;

        const highlight = Math.min(1, (pecVert * pecLobe * pecFront) * 0.5 + (abSum * abCol * abFront) * 0.35) * wallMask;
        const shade = Math.min(1.0, Math.max(0.55, 1.0 - crease * GROOVE_SHADOW + highlight * 0.06));
        colors[i * 3] = shade;
        colors[i * 3 + 1] = shade;
        colors[i * 3 + 2] = shade;
      }
    }

    if (colors) {
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geom.computeVertexNormals();
    return geom;
  }

  function createBody(THREE, color = 0x8ecab1, initialOffsetZ = 0) {
    const shoulderHalfWidth = getShoulderHalfWidth();
    const offsetZ = Number.isFinite(Number(initialOffsetZ)) ? Number(initialOffsetZ) : 0;
    const bodyGroup = new THREE.Group();
    bodyGroup.position.set(0, 0, offsetZ);

    const materials = [];
    const meshes = [];

    const resolvedBodyColor = BODY_COLOR !== null ? BODY_COLOR : color;
    const topRadius = shoulderHalfWidth * 0.875;
    // baseGroup(1.1) + armPivot(-0.22) = 0.88 이므로 바닥(y=0)에 닿지 않게 0.82로 설정
    const bodyHeight = 0.82;

    if (THREE.MeshStandardMaterial) {
      // 1. 유광 로봇 재질 + 근육 굴곡 음영이 적용된 남성형 몸통
      const bodyMat = new THREE.MeshStandardMaterial({
        color: resolvedBodyColor,
        emissive: resolvedBodyColor,
        emissiveIntensity: 0.08,
        roughness: 0.24,
        metalness: 0.16,
        vertexColors: Boolean(THREE.BufferAttribute),
        transparent: true,
        opacity: 1.0,
      });
      materials.push(bodyMat);

      let torsoMesh = null;
      if (THREE.CylinderGeometry) {
        const torsoGeom = createMuscularTorsoGeometry(THREE, shoulderHalfWidth, bodyHeight);
        torsoMesh = new THREE.Mesh(torsoGeom, bodyMat);
        bodyGroup.add(torsoMesh);
        meshes.push(torsoMesh);
      }

      // 2. 어깨 삼각근 로봇 아머 캡 (몸통 상단과 Arm.js 어깨 관절을 자연스럽게 연결)
      if (THREE.SphereGeometry) {
        const deltMat = new THREE.MeshStandardMaterial({
          color: resolvedBodyColor,
          emissive: resolvedBodyColor,
          emissiveIntensity: 0.08,
          roughness: 0.22,
          metalness: 0.16,
          transparent: true,
          opacity: 1.0,
        });
        materials.push(deltMat);

        [-1, 1].forEach((side) => {
          const deltMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), deltMat);
          deltMesh.scale.set(0.92, 1.18, 1.05);
          deltMesh.position.set(side * (shoulderHalfWidth * 0.85), -0.105, 0.0);
          deltMesh.rotation.z = side * -0.22;
          bodyGroup.add(deltMesh);
          meshes.push(deltMesh);
        });
      }

      // 3. 머리와 몸통 사이 목 관절 섀도우 링
      if (THREE.CylinderGeometry) {
        const neckMat = new THREE.MeshStandardMaterial({
          color: 0x11151c,
          roughness: 0.32,
          metalness: 0.25,
          transparent: true,
          opacity: 1.0,
        });
        materials.push(neckMat);

        const neckMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(topRadius * 0.48, topRadius * 0.56, 0.045, 28),
          neckMat
        );
        neckMesh.position.y = -0.025;
        bodyGroup.add(neckMesh);
        meshes.push(neckMesh);
      }

      // 4. 대흉근 중앙 홈(가슴뼈)에 안착되는 블랙 베젤 + 팀 컬러 LED 코어
      if (THREE.SphereGeometry) {
        const bezelMat = new THREE.MeshStandardMaterial({
          color: 0x0b0e14,
          roughness: 0.12,
          metalness: 0.28,
          transparent: true,
          opacity: 1.0,
        });
        materials.push(bezelMat);

        const bezelMesh = new THREE.Mesh(new THREE.SphereGeometry(0.054, 20, 16), bezelMat);
        bezelMesh.scale.set(1.25, 0.95, 0.28);
        bezelMesh.position.set(0, -0.235, FACE_DIR_Z * 0.212);
        bodyGroup.add(bezelMesh);
        meshes.push(bezelMesh);

        let coreColor = resolvedBodyColor;
        if (THREE.Color) {
          coreColor = new THREE.Color(resolvedBodyColor).lerp(new THREE.Color(0xffffff), 0.38);
        }
        const coreMat = new THREE.MeshStandardMaterial({
          color: coreColor,
          emissive: resolvedBodyColor,
          emissiveIntensity: 0.95,
          roughness: 0.15,
          transparent: true,
          opacity: 1.0,
        });
        materials.push(coreMat);

        const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.042, 20, 16), coreMat);
        coreMesh.scale.set(0.95, 0.68, 0.24);
        coreMesh.position.set(0, -0.235, FACE_DIR_Z * 0.228);
        bodyGroup.add(coreMesh);
        meshes.push(coreMesh);
      }
    }

    function setOpacity(opacity) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
      const isVisible = clamped > 0;
      for (const m of meshes) {
        if (m) m.visible = isVisible;
      }
      for (const mat of materials) {
        if (mat) {
          mat.opacity = clamped;
          mat.transparent = clamped < 1;
          mat.depthWrite = clamped >= 1;
          mat.needsUpdate = true;
        }
      }
    }

    function setOffsetZ(nextOffsetZ) {
      const z = Number.isFinite(Number(nextOffsetZ)) ? Number(nextOffsetZ) : 0;
      bodyGroup.userData.offsetZ = z;
      const shake = bodyGroup.userData.shakeOffset || { x: 0, y: 0, z: 0 };
      bodyGroup.position?.set(shake.x, shake.y, z + shake.z);
    }

    function setShakeOffset(x = 0, y = 0, z = 0) {
      const sx = Number.isFinite(Number(x)) ? Number(x) : 0;
      const sy = Number.isFinite(Number(y)) ? Number(y) : 0;
      const sz = Number.isFinite(Number(z)) ? Number(z) : 0;
      bodyGroup.userData.shakeOffset = { x: sx, y: sy, z: sz };
      const baseZ = Number.isFinite(Number(bodyGroup.userData.offsetZ)) ? Number(bodyGroup.userData.offsetZ) : 0;
      bodyGroup.position?.set(sx, sy, baseZ + sz);
    }

    bodyGroup.userData = {
      meshes,
      materials,
      height: bodyHeight,
      topRadius,
      offsetZ,
      shakeOffset: { x: 0, y: 0, z: 0 },
      setOpacity,
      setOffsetZ,
      setShakeOffset,
    };

    return bodyGroup;
  }

  root.BodyGraphic = {
    DEFAULT_SHOULDER_HALF_WIDTH,
    createBody,
  };
})(globalThis);