'use strict';
(function (root) {
  function setupBackground(THREE, scene) {
    if (!THREE || !scene) return;

    scene.background = new THREE.Color(0x0e1715);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(4, 8, 6);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(12, 12, 0x3b7a62, 0x1f3a31);
    scene.add(grid);

    return {
      ambientLight,
      dirLight,
      grid,
    };
  }

  root.BackgroundGraphic = {
    setupBackground,
  };
})(globalThis);
