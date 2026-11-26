'use strict';
(function (root) {
  const DEFAULT_SHOULDER_HALF_WIDTH = 0.44;
  // inGameFront.js 기준 로컬 -Z가 상대방을 바라보는 정면
  const FACE_DIR_Z = -1;
  // null로 두면 Head.js의 눈과 동일하게 각 플레이어 팀 색상(color)을 그대로 사용
  const BODY_COLOR = null;

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

  // 매끈한 기계형(로봇 아머) 역삼각형 상체 3D 메쉬 생성
  function createSmoothRobotTorsoGeometry(THREE, shoulderHalfWidth, bodyHeight) {
    const geom = new THREE.CylinderGeometry(1, 1, 1, 32, 24, false);
    const pos = geom.attributes && geom.attributes.position;
    if (!pos) return geom;

    const widthScale = shoulderHalfWidth / DEFAULT_SHOULDER_HALF_WIDTH;
    const count = pos.count;
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
        continue;
      }

      const ux = ox / radial;
      const uz = oz / radial;
      const absX = Math.abs(ux);
      const wallMask = smoothstep(0.65, 1.0, radial);

      // 1) 매끈한 역삼각형(V-테이퍼) 로봇 섀시 실루엣
      const baseRx = (
        0.205
        + 0.190 * gauss(t, 0.22, 0.21) // 넓은 상체/어깨 장갑
        + 0.052 * gauss(t, 0.86, 0.12) // 깔끔한 하단 골반 마감
      ) * widthScale;

      const baseRz = (
        0.155
        + 0.068 * gauss(t, 0.24, 0.23) // 매끄러운 흉곽 볼륨
        + 0.024 * gauss(t, 0.86, 0.13)
      ) * widthScale;

      // 상단(목/어깨)과 하단(로봇 바디 끝) 둥글고 매끈하게 마감
      let roundFactor = 1.0;
      if (t < 0.09) {
        const u = (0.09 - t) / 0.09;
        roundFactor *= 0.58 + 0.42 * Math.sqrt(Math.max(0, 1 - u * u));
      }
      if (t > 0.88) {
        const u = (t - 0.88) / 0.12;
        roundFactor *= 0.28 + 0.72 * Math.sqrt(Math.max(0, 1 - u * u));
      }

      // 원통보다 세련된 기계형 상체 단면(스쿼클 보정)
      const angle = Math.atan2(uz, ux);
      const squircle = 1 + 0.05 * Math.pow(Math.sin(2 * angle), 2);

      // 목 주변 상단 경사
      if (t < 0.14) {
        const trapSlope = (1 - t / 0.14) * (1 - absX) * 0.022 * wallMask;
        y += trapSlope;
      }

      const rx = baseRx * roundFactor * radial * squircle;
      const rz = baseRz * roundFactor * radial * squircle;

      pos.setXYZ(i, ux * rx, y, uz * rz);
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
      // 1. 유광 메탈릭 로봇 재질의 매끈한 기계형 몸통
      const bodyMat = new THREE.MeshStandardMaterial({
        color: resolvedBodyColor,
        emissive: resolvedBodyColor,
        emissiveIntensity: 0.08,
        roughness: 0.16,
        metalness: 0.24,
        transparent: true,
        opacity: 1.0,
      });
      materials.push(bodyMat);

      let torsoMesh = null;
      if (THREE.CylinderGeometry) {
        const torsoGeom = createSmoothRobotTorsoGeometry(THREE, shoulderHalfWidth, bodyHeight);
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
          roughness: 0.16,
          metalness: 0.24,
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
        bezelMesh.position.set(0, -0.235, FACE_DIR_Z * 0.218);
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
        coreMesh.position.set(0, -0.235, FACE_DIR_Z * 0.230);
        bodyGroup.add(coreMesh);
        meshes.push(coreMesh);
      }
    }

    let lastAppliedOpacity = 1.0;

    function setOpacity(opacity) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
      if (Math.abs(clamped - lastAppliedOpacity) < 0.001) return;
      lastAppliedOpacity = clamped;
      const isVisible = clamped > 0;
      for (const m of meshes) {
        if (m) m.visible = isVisible;
      }
      // transparent=true를 고정 유지해 매 프레임 셰이더 재컴파일(needsUpdate=true) 방지
      for (const mat of materials) {
        if (mat) {
          mat.opacity = clamped;
          mat.depthWrite = clamped >= 1;
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

    function setRotationOffset(rx = 0, ry = 0, rz = 0) {
      const x = Number.isFinite(Number(rx)) ? Number(rx) : 0;
      const y = Number.isFinite(Number(ry)) ? Number(ry) : 0;
      const z = Number.isFinite(Number(rz)) ? Number(rz) : 0;
      bodyGroup.userData.rotationOffset = { x, y, z };
      bodyGroup.rotation?.set(x, y, z);
    }

    bodyGroup.userData = {
      meshes,
      materials,
      height: bodyHeight,
      topRadius,
      offsetZ,
      shakeOffset: { x: 0, y: 0, z: 0 },
      rotationOffset: { x: 0, y: 0, z: 0 },
      setOpacity,
      setOffsetZ,
      setShakeOffset,
      setRotationOffset,
    };

    return bodyGroup;
  }

  root.BodyGraphic = {
    DEFAULT_SHOULDER_HALF_WIDTH,
    createBody,
  };
})(globalThis);