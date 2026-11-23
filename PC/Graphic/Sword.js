'use strict';
(function (root) {
  function createSword(THREE, color, wristOffset = { x: 0, y: 0.12, z: -0.95 }) {
    const swordGroup = new THREE.Group();
    swordGroup.position.set(wristOffset.x, wristOffset.y, wristOffset.z);

    // 기본 자세(0, 0, 0, 1 - 핸드폰 화면을 위로 놓은 상태)일 때:
    // - 핸드폰 윗부분(-Z) = 검날이 앞으로 뻗는 방향(-Z)
    // - 핸드폰 오른쪽 면(+Y) = 위쪽(하늘 방향)을 향하고,
    // - 핸드폰 화면/카메라 면(±X) = 검의 넓은 좌/우 옆면(±X)이 되도록 세로형 검 단면으로 구성
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 2.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 })
    );
    blade.position.z = -1.1;

    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.55, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xd9a441 })
    );

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.7 })
    );
    handle.position.z = 0.25;

    swordGroup.add(blade, guard, handle);
    return swordGroup;
  }

  root.SwordGraphic = {
    createSword,
  };
})(globalThis);
