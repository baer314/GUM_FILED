'use strict';
(function (root) {
  // =========================================================
  // 광선검 & 잔상 커스텀 설정값 (필요 시 이 부분만 조절)
  // =========================================================
  const TRAIL_SAMPLES = 18;        // 잔상 곡선 분할 수 (클수록 부드러움)
  const TRAIL_LIFETIME_MS = 350;   // 잔상 유지 시간 (ms, 길게 하려면 240~300)
  const TRAIL_INTENSITY = 1.2;    // 잔상 밝기 강도 (0.4: 은은함 ~ 1.0: 강함)
  const INNER_GLOW_OPACITY = 0.46; // 1차 광선검 발광 강도
  const OUTER_GLOW_OPACITY = 0.18; // 2차 외곽 글로우 강도

  function slerpQuat(out, a, b, t) {
    let ax = a.x, ay = a.y, az = a.z, aw = a.w;
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    let dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) {
      dot = -dot;
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let s0, s1;
    if (1 - dot > 0.0005) {
      const omega = Math.acos(Math.min(1, Math.max(-1, dot)));
      const sinO = Math.sin(omega) || 1;
      s0 = Math.sin((1 - t) * omega) / sinO;
      s1 = Math.sin(t * omega) / sinO;
    } else {
      s0 = 1 - t;
      s1 = t;
    }
    out.x = s0 * ax + s1 * bx;
    out.y = s0 * ay + s1 * by;
    out.z = s0 * az + s1 * bz;
    out.w = s0 * aw + s1 * bw;
    const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
    out.x /= len; out.y /= len; out.z /= len; out.w /= len;
    return out;
  }

  function transformLocalPoint(out, lx, ly, lz, pos, q) {
    const tx = 2 * (q.y * lz - q.z * ly);
    const ty = 2 * (q.z * lx - q.x * lz);
    const tz = 2 * (q.x * ly - q.y * lx);
    out.x = lx + q.w * tx + (q.y * tz - q.z * ty) + pos.x;
    out.y = ly + q.w * ty + (q.z * tx - q.x * tz) + pos.y;
    out.z = lz + q.w * tz + (q.x * ty - q.y * tx) + pos.z;
    return out;
  }

  function createSword(THREE, color, wristOffset = { x: 0, y: 0.12, z: -0.95 }) {
    const swordGroup = new THREE.Group();
    swordGroup.position.set(wristOffset.x, wristOffset.y, wristOffset.z);

    // 플레이어 몸 색상(color) 기반 광선검 코어/발광 색상 계산
    const baseColor = THREE.Color ? new THREE.Color(color) : null;
    const coreColor = baseColor
      ? baseColor.clone().lerp(new THREE.Color(0xffffff), 0.82)
      : 0xffffff;
    const trailLeadColor = baseColor
      ? baseColor.clone().lerp(new THREE.Color(0xffffff), 0.30)
      : null;

    // ---------------------------------------------------------
    // 1. 광선검 검날 (길이 2.2 유지: z = -0.06 ~ -2.20)
    //    백열 코어 + 1차 발광층 + 2차 외곽 글로우 3중 구조
    // ---------------------------------------------------------
    const BladeBasicMat = THREE.MeshBasicMaterial || THREE.MeshStandardMaterial;
    let coreBlade = null;

    if (THREE.CylinderGeometry && BladeBasicMat) {
      const bladeLen = 2.08;
      const bladeCenterZ = -1.10;
      const tipZ = -2.14;

      // (1) 중앙 백열 코어 (항상 선명하게 빛남)
      const coreMat = new BladeBasicMat({ color: coreColor });
      coreBlade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.044, 0.048, bladeLen, 16),
        coreMat
      );
      coreBlade.rotation.x = Math.PI / 2;
      coreBlade.position.z = bladeCenterZ;
      swordGroup.add(coreBlade);

      if (THREE.SphereGeometry) {
        const coreTip = new THREE.Mesh(new THREE.SphereGeometry(0.044, 14, 12), coreMat);
        coreTip.position.z = tipZ;
        swordGroup.add(coreTip);
      }

      // (2) 1차 팀 컬러 발광 오라 (기존 검 두께와 동일한 반지름 ~0.095)
      const innerGlowMat = new BladeBasicMat({
        color,
        transparent: true,
        opacity: INNER_GLOW_OPACITY,
        blending: THREE.AdditiveBlending || THREE.NormalBlending,
        depthWrite: false,
      });
      const innerGlow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.088, 0.096, bladeLen + 0.02, 16),
        innerGlowMat
      );
      innerGlow.rotation.x = Math.PI / 2;
      innerGlow.position.z = bladeCenterZ;
      innerGlow.renderOrder = 2;
      swordGroup.add(innerGlow);

      if (THREE.SphereGeometry) {
        const innerTip = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 12), innerGlowMat);
        innerTip.position.z = tipZ - 0.01;
        innerTip.renderOrder = 2;
        swordGroup.add(innerTip);
      }

      // (3) 2차 외곽 광채 글로우
      const outerGlowMat = new BladeBasicMat({
        color,
        transparent: true,
        opacity: OUTER_GLOW_OPACITY,
        blending: THREE.AdditiveBlending || THREE.NormalBlending,
        depthWrite: false,
      });
      const outerGlow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.155, bladeLen + 0.05, 16),
        outerGlowMat
      );
      outerGlow.rotation.x = Math.PI / 2;
      outerGlow.position.z = bladeCenterZ - 0.01;
      outerGlow.renderOrder = 3;
      swordGroup.add(outerGlow);

      if (THREE.SphereGeometry) {
        const outerTip = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), outerGlowMat);
        outerTip.position.z = tipZ - 0.02;
        outerTip.renderOrder = 3;
        swordGroup.add(outerTip);
      }

      // (4) 검날에서 주변(캐릭터 바이저/몸통)으로 은은하게 비치는 로컬 발광
      if (THREE.PointLight) {
        const bladeLight = new THREE.PointLight(color, 0.42, 2.6);
        bladeLight.position.set(0, 0, -0.95);
        swordGroup.add(bladeLight);
      }
    }

    // ---------------------------------------------------------
    // 2. 검막이(검방패) 유지: 기존 (0.24 x 0.55 x 0.12) 규격 보존 + SF 디테일
    // ---------------------------------------------------------
    if (THREE.BoxGeometry && THREE.MeshStandardMaterial) {
      const darkMetalMat = new THREE.MeshStandardMaterial({
        color: 0x2c3642,
        roughness: 0.36,
        metalness: 0.55,
      });
      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xd9a441,
        roughness: 0.32,
        metalness: 0.6,
      });
      const accentGlowMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      });

      // 검막이 본체 (기존 BoxGeometry(0.24, 0.55, 0.12)와 동일한 크기 및 위치)
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.55, 0.12),
        darkMetalMat
      );
      swordGroup.add(guard);

      // 검막이 위/아래 금색 포인트 캡 (기존 금색 검막이 실루엣 계승)
      [-0.275, 0.275].forEach((gy) => {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.255, 0.045, 0.132), goldTrimMat);
        cap.position.y = gy;
        swordGroup.add(cap);
      });

      // 검막이 좌우 에너지 슬릿 (플레이어 색상 발광 포인트)
      [-0.122, 0.122].forEach((gx) => {
        const slit = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.34, 0.04), accentGlowMat);
        slit.position.x = gx;
        swordGroup.add(slit);
      });

      // 검날 사출구(Emitter) 노즐 링
      if (THREE.CylinderGeometry) {
        const emitter = new THREE.Mesh(
          new THREE.CylinderGeometry(0.072, 0.095, 0.08, 16),
          goldTrimMat
        );
        emitter.rotation.x = Math.PI / 2;
        emitter.position.z = -0.075;
        swordGroup.add(emitter);

        const emitterCore = new THREE.Mesh(
          new THREE.CylinderGeometry(0.062, 0.062, 0.03, 16),
          accentGlowMat
        );
        emitterCore.rotation.x = Math.PI / 2;
        emitterCore.position.z = -0.108;
        swordGroup.add(emitterCore);
      }

      // ---------------------------------------------------------
      // 3. SF 광선검 손잡이(힐트)
      // ---------------------------------------------------------
      if (THREE.CylinderGeometry) {
        const hiltMat = new THREE.MeshStandardMaterial({
          color: 0x3b4552,
          roughness: 0.38,
          metalness: 0.62,
        });
        const gripMat = new THREE.MeshStandardMaterial({
          color: 0x181d24,
          roughness: 0.72,
          metalness: 0.2,
        });

        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.046, 0.052, 0.45, 16),
          hiltMat
        );
        handle.rotation.x = Math.PI / 2;
        handle.position.z = 0.25;
        swordGroup.add(handle);

        // 손잡이 미끄럼 방지 그립 링
        [0.14, 0.22, 0.30, 0.38].forEach((gz) => {
          const ring = new THREE.Mesh(
            new THREE.CylinderGeometry(0.054, 0.054, 0.032, 16),
            gripMat
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.z = gz;
          swordGroup.add(ring);
        });

        // 손잡이 끝 폼멜 캡
        const pommel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.058, 0.044, 0.05, 16),
          goldTrimMat
        );
        pommel.rotation.x = Math.PI / 2;
        pommel.position.z = 0.485;
        swordGroup.add(pommel);
      } else {
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.12, 0.45),
          darkMetalMat
        );
        handle.position.z = 0.25;
        swordGroup.add(handle);
      }
    }

    // ---------------------------------------------------------
    // 4. 손잡이를 양손으로 쥔 구형 손 표현 (기존 위치 및 플레이어 색상 유지)
    // ---------------------------------------------------------
    if (THREE.SphereGeometry && THREE.MeshStandardMaterial) {
      const handMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.12,
      });
      const frontHand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), handMat);
      frontHand.position.set(0.1, 0, 0.16);
      const backHand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), handMat);
      backHand.position.set(-0.1, 0, 0.36);
      swordGroup.add(frontHand, backHand);
    }

    // ---------------------------------------------------------
    // 5. 스윙 잔상(Motion Ribbon Trail) 자동 추적 및 렌더링
    //    armPivot 좌표계에 자동 부착되어 분할 화면(P1/P2) 모두 자연스럽게 표시
    // ---------------------------------------------------------
    if (
      coreBlade
      && THREE.BufferGeometry
      && THREE.BufferAttribute
      && THREE.MeshBasicMaterial
      && baseColor
      && trailLeadColor
    ) {
      const positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
      const colors = new Float32Array(TRAIL_SAMPLES * 2 * 3);
      const indices = [];
      for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
        const v0 = i * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        indices.push(v0, v1, v2, v1, v3, v2);
      }

      const trailGeom = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      const colAttr = new THREE.BufferAttribute(colors, 3);
      trailGeom.setAttribute('position', posAttr);
      trailGeom.setAttribute('color', colAttr);
      trailGeom.setIndex(indices);

      const trailMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending || THREE.NormalBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const trailMesh = new THREE.Mesh(trailGeom, trailMat);
      trailMesh.frustumCulled = false;
      trailMesh.renderOrder = 4;

      const samples = [];
      for (let i = 0; i < TRAIL_SAMPLES; i++) {
        samples.push({ bx: 0, by: 0, bz: 0, tx: 0, ty: 0, tz: 0, time: 0, energy: 0 });
      }

      const TRAIL_BASE_Z = -0.10;
      const TRAIL_TIP_Z = -2.18;
      let trailAttached = false;
      let initialized = false;
      let lastSampleTime = -1000;
      let swingEnergy = 0;
      const prevPos = { x: 0, y: 0, z: 0 };
      const prevQuat = { x: 0, y: 0, z: 0, w: 1 };
      const prevTip = { x: 0, y: 0, z: 0 };
      const tmpBase = { x: 0, y: 0, z: 0 };
      const tmpTip = { x: 0, y: 0, z: 0 };
      const midPos = { x: 0, y: 0, z: 0 };
      const midQuat = { x: 0, y: 0, z: 0, w: 1 };

      function pushSample(bx, by, bz, tx, ty, tz, time, energy) {
        for (let i = TRAIL_SAMPLES - 1; i > 0; i--) {
          const dst = samples[i];
          const src = samples[i - 1];
          dst.bx = src.bx; dst.by = src.by; dst.bz = src.bz;
          dst.tx = src.tx; dst.ty = src.ty; dst.tz = src.tz;
          dst.time = src.time;
          dst.energy = src.energy;
        }
        const head = samples[0];
        head.bx = bx; head.by = by; head.bz = bz;
        head.tx = tx; head.ty = ty; head.tz = tz;
        head.time = time;
        head.energy = energy;
      }

      function resetTrail(bx, by, bz, tx, ty, tz, now) {
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          const s = samples[i];
          s.bx = bx; s.by = by; s.bz = bz;
          s.tx = tx; s.ty = ty; s.tz = tz;
          s.time = now;
          s.energy = 0;
        }
        swingEnergy = 0;
      }

      coreBlade.onBeforeRender = function () {
        // armPivot(swordGroup의 부모)에 잔상 메쉬를 1회 자동 부착
        if (!trailAttached && swordGroup.parent) {
          swordGroup.parent.add(trailMesh);
          trailAttached = true;
        }

        const now = (typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now();
        // 좌/우 분할 화면 연속 렌더 시 동일 프레임 중복 샘플링 방지
        if (initialized && now - lastSampleTime < 12) return;

        const dt = initialized ? (now - lastSampleTime) : 16;
        const pos = swordGroup.position;
        const quat = swordGroup.quaternion;

        transformLocalPoint(tmpBase, 0, 0, TRAIL_BASE_Z, pos, quat);
        transformLocalPoint(tmpTip, 0, 0, TRAIL_TIP_Z, pos, quat);

        if (!initialized || dt > 260) {
          resetTrail(tmpBase.x, tmpBase.y, tmpBase.z, tmpTip.x, tmpTip.y, tmpTip.z, now);
          initialized = true;
        } else {
          const tipDist = Math.hypot(
            tmpTip.x - prevTip.x,
            tmpTip.y - prevTip.y,
            tmpTip.z - prevTip.z
          );
          const instantEnergy = Math.min(1, Math.max(0, (tipDist - 0.015) / 0.16));
          swingEnergy = instantEnergy > swingEnergy
            ? swingEnergy + (instantEnergy - swingEnergy) * 0.7
            : swingEnergy * 0.80;

          // 빠르게 휘두를 때 각지지 않도록 중간 호(Arc) 샘플 보간 추가
          if (tipDist > 0.20) {
            midPos.x = (prevPos.x + pos.x) * 0.5;
            midPos.y = (prevPos.y + pos.y) * 0.5;
            midPos.z = (prevPos.z + pos.z) * 0.5;
            slerpQuat(midQuat, prevQuat, quat, 0.5);
            const mb = { x: 0, y: 0, z: 0 };
            const mt = { x: 0, y: 0, z: 0 };
            transformLocalPoint(mb, 0, 0, TRAIL_BASE_Z, midPos, midQuat);
            transformLocalPoint(mt, 0, 0, TRAIL_TIP_Z, midPos, midQuat);
            pushSample(mb.x, mb.y, mb.z, mt.x, mt.y, mt.z, now - dt * 0.5, swingEnergy);
          }

          pushSample(tmpBase.x, tmpBase.y, tmpBase.z, tmpTip.x, tmpTip.y, tmpTip.z, now, swingEnergy);
        }

        prevPos.x = pos.x; prevPos.y = pos.y; prevPos.z = pos.z;
        prevQuat.x = quat.x; prevQuat.y = quat.y; prevQuat.z = quat.z; prevQuat.w = quat.w;
        prevTip.x = tmpTip.x; prevTip.y = tmpTip.y; prevTip.z = tmpTip.z;
        lastSampleTime = now;

        // 리본 정점 위치 & 페이드아웃 색상 버퍼 갱신
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          const s = samples[i];
          const age = Math.max(0, now - s.time);
          const ageFade = Math.max(0, 1 - age / TRAIL_LIFETIME_MS);
          const idxFade = 1 - i / (TRAIL_SAMPLES - 1);
          const alpha = ageFade * ageFade * idxFade * s.energy * TRAIL_INTENSITY;

          // 선두는 밝은 플라즈마 톤, 꼬리는 선명한 플레이어 색상으로 자연스럽게 감쇠
          const leadMix = idxFade * 0.7;
          const cr = baseColor.r * (1 - leadMix) + trailLeadColor.r * leadMix;
          const cg = baseColor.g * (1 - leadMix) + trailLeadColor.g * leadMix;
          const cb = baseColor.b * (1 - leadMix) + trailLeadColor.b * leadMix;

          const baseIdx = i * 6;
          positions[baseIdx] = s.bx;
          positions[baseIdx + 1] = s.by;
          positions[baseIdx + 2] = s.bz;
          positions[baseIdx + 3] = s.tx;
          positions[baseIdx + 4] = s.ty;
          positions[baseIdx + 5] = s.tz;

          // 손잡이 쪽은 은은하게(0.32x), 검끝 쪽은 선명하게(0.88x) 발광
          const baseScale = alpha * 0.32;
          const tipScale = alpha * 0.88;
          colors[baseIdx] = cr * baseScale;
          colors[baseIdx + 1] = cg * baseScale;
          colors[baseIdx + 2] = cb * baseScale;
          colors[baseIdx + 3] = cr * tipScale;
          colors[baseIdx + 4] = cg * tipScale;
          colors[baseIdx + 5] = cb * tipScale;
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      };
    }

    return swordGroup;
  }

  root.SwordGraphic = {
    createSword,
  };
})(globalThis);