'use strict';
(function (root) {
  // 3DoF 양팔(검도 양손 파지) 모델 파라미터
  const ARM_PIVOT_OFFSET = { x: 0, y: -0.22, z: 0.45 };  // 플레이어 몸통 정중앙 스윙 중심점
  const SHOULDER_HALF_WIDTH = 0.44;                      // 양쪽 어깨/팔꿈치 간격 (왼팔: -0.44, 오른팔: +0.44)
  const WRIST_BASE_OFFSET = { x: 0, y: 0.12, z: -0.95 }; // 양손으로 쥔 검 손잡이의 기본 정면 위치

  function positionLimbBetween(THREE, limb, sx, sy, sz, tx, ty, tz, baseLen) {
    if (!limb) return;
    const dx = tx - sx;
    const dy = ty - sy;
    const dz = tz - sz;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    limb.position?.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2);
    if (limb.scale && baseLen > 0) {
      limb.scale.y = len / baseLen;
    }
    if (THREE?.Vector3 && limb.quaternion?.setFromUnitVectors) {
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
      limb.quaternion.setFromUnitVectors(up, dir);
    }
  }

  function createArm(THREE) {
    const armPivot = new THREE.Group();
    armPivot.position.set(ARM_PIVOT_OFFSET.x, ARM_PIVOT_OFFSET.y, ARM_PIVOT_OFFSET.z);

    let leftForearm = null;
    let rightForearm = null;
    let leftJoint = null;
    let rightJoint = null;
    let jointMat = null;
    let limbMat = null;
    const defaultLimbLen = Math.hypot(
      SHOULDER_HALF_WIDTH,
      WRIST_BASE_OFFSET.y,
      WRIST_BASE_OFFSET.z
    );

    if (THREE.SphereGeometry && THREE.CylinderGeometry) {
      jointMat = new THREE.MeshStandardMaterial({
        color: 0x8ecab1,
        roughness: 0.5,
        transparent: true,
        opacity: 1.0,
      });
      leftJoint = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), jointMat);
      leftJoint.position.set(-SHOULDER_HALF_WIDTH, 0, 0);
      rightJoint = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), jointMat);
      rightJoint.position.set(SHOULDER_HALF_WIDTH, 0, 0);
      armPivot.add(leftJoint, rightJoint);

      limbMat = new THREE.MeshStandardMaterial({
        color: 0x35584c,
        roughness: 0.6,
        transparent: true,
        opacity: 1.0,
      });
      leftForearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.058, defaultLimbLen, 10),
        limbMat
      );
      rightForearm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.058, defaultLimbLen, 10),
        limbMat
      );

      positionLimbBetween(
        THREE,
        leftForearm,
        -SHOULDER_HALF_WIDTH, 0, 0,
        WRIST_BASE_OFFSET.x, WRIST_BASE_OFFSET.y, WRIST_BASE_OFFSET.z,
        defaultLimbLen
      );
      positionLimbBetween(
        THREE,
        rightForearm,
        SHOULDER_HALF_WIDTH, 0, 0,
        WRIST_BASE_OFFSET.x, WRIST_BASE_OFFSET.y, WRIST_BASE_OFFSET.z,
        defaultLimbLen
      );
      armPivot.add(leftForearm, rightForearm);
    }

    function setOpacity(opacity) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
      const isVisible = clamped > 0;
      for (const m of [leftJoint, rightJoint, leftForearm, rightForearm]) {
        if (m) m.visible = isVisible;
      }
      for (const mat of [jointMat, limbMat]) {
        if (mat) {
          mat.opacity = clamped;
          mat.transparent = clamped < 1;
          mat.depthWrite = clamped >= 1;
          mat.needsUpdate = true;
        }
      }
    }

    return {
      armPivot,
      leftForearm,
      rightForearm,
      defaultLimbLen,
      baseWristOffset: { ...WRIST_BASE_OFFSET },
      setOpacity,
      positionLimbBetween: (limb, sx, sy, sz, tx, ty, tz, baseLen) =>
        positionLimbBetween(THREE, limb, sx, sy, sz, tx, ty, tz, baseLen),
      updateLimbs(wx, wy, wz) {
        positionLimbBetween(THREE, leftForearm, -SHOULDER_HALF_WIDTH, 0, 0, wx, wy, wz, defaultLimbLen);
        positionLimbBetween(THREE, rightForearm, SHOULDER_HALF_WIDTH, 0, 0, wx, wy, wz, defaultLimbLen);
      },
    };
  }

  root.ArmGraphic = {
    ARM_PIVOT_OFFSET,
    SHOULDER_HALF_WIDTH,
    WRIST_BASE_OFFSET,
    positionLimbBetween,
    createArm,
  };
})(globalThis);
