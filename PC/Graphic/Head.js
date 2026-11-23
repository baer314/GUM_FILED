'use strict';
(function (root) {
  // 어깨너비(SHOULDER_HALF_WIDTH * 2 = 0.88)를 지름으로 갖는 구형 머리 모델
  const DEFAULT_SHOULDER_HALF_WIDTH = 0.44;

  function getHeadRadius() {
    return root.ArmGraphic?.SHOULDER_HALF_WIDTH ?? DEFAULT_SHOULDER_HALF_WIDTH;
  }

  function createHead(THREE, color = 0x8ecab1, initialOffsetZ = 0) {
    const radius = getHeadRadius();
    const offsetZ = Number.isFinite(Number(initialOffsetZ)) ? Number(initialOffsetZ) : 0;
    const headGroup = new THREE.Group();
    // armPivot 기준 양쪽 어깨 중심(y = 0, z = offsetZ)에 구의 바닥면이 접하도록 중심을 (0, radius, offsetZ)에 배치
    headGroup.position.set(0, radius, offsetZ);

    let headMesh = null;
    let headMat = null;
    if (THREE.SphereGeometry && THREE.MeshStandardMaterial) {
      headMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.1,
        transparent: true,
        opacity: 1.0,
      });
      headMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        headMat
      );
      headGroup.add(headMesh);
    }

    function setOpacity(opacity) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
      if (headMesh) {
        headMesh.visible = clamped > 0;
      }
      if (headMat) {
        headMat.opacity = clamped;
        headMat.transparent = clamped < 1;
        headMat.depthWrite = clamped >= 1;
        headMat.needsUpdate = true;
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

    headGroup.userData = {
      headMesh,
      headMat,
      radius,
      diameter: radius * 2,
      offsetZ,
      shakeOffset: { x: 0, y: 0, z: 0 },
      setOpacity,
      setOffsetZ,
      setShakeOffset,
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
