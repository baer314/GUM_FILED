'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);
  let scene = null, camera = null, renderer = null, animId = null;
  const meshes = new Map();

  function initThree() {
    const THREE = root.THREE;
    const canvas = $('ingame-canvas');
    if (!THREE || !canvas || typeof canvas.getContext !== 'function') return;
    if (renderer) { resizeThree(); return; }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1715);

    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 3.2, 6.5);
    camera.lookAt(0, 0.8, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    if (root.devicePixelRatio) renderer.setPixelRatio(Math.min(root.devicePixelRatio, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(4, 8, 6);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(12, 12, 0x3b7a62, 0x1f3a31);
    scene.add(grid);

    const createSwordMesh = (color, xPos) => {
      const group = new THREE.Group();
      group.position.set(xPos, 1.1, 0);
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 2.2, 0.16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 })
      );
      blade.position.y = 0.6;
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.1, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xd9a441 })
      );
      group.add(blade, guard);
      scene.add(group);
      return group;
    };

    meshes.set('PLAYER_1', createSwordMesh(0x4fd1a5, -1.8));
    meshes.set('PLAYER_2', createSwordMesh(0xf28b66, 1.8));

    root.addEventListener?.('resize', resizeThree);
  }

  function resizeThree() {
    if (!renderer || !camera) return;
    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function animate() {
    if (renderer && scene && camera) renderer.render(scene, camera);
    if (typeof root.requestAnimationFrame === 'function') {
      animId = root.requestAnimationFrame(animate);
    }
  }

  function start(onBackToLobby) {
    if ($('lobby-view')) $('lobby-view').hidden = true;
    if ($('ingame-view')) $('ingame-view').hidden = false;
    if ($('back-to-lobby')) $('back-to-lobby').onclick = onBackToLobby;
    initThree();
    if (!animId && renderer) animate();
  }

  function stop() {
    if (animId && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(animId);
    }
    animId = null;
    if ($('ingame-view')) $('ingame-view').hidden = true;
    if ($('lobby-view')) $('lobby-view').hidden = false;
  }

  function updatePose(playerId, payload) {
    const mesh = meshes.get(playerId);
    if (!mesh || !payload) return;
    const rv = payload.rotation_vector;
    if (rv && mesh.quaternion?.set) {
      mesh.quaternion.set(rv.x, rv.y, rv.z, rv.w).normalize();
    }
  }

  function renderPackets(players, rates) {
    const container = $('ingame-packets');
    if (!container) return;
    container.replaceChildren();
    if (!players.length) {
      const empty = document.createElement('section');
      empty.className = 'packet-card';
      const text = document.createElement('p');
      text.className = 'packet-meta';
      text.textContent = '연결된 컨트롤러가 없습니다.';
      empty.append(text);
      container.append(empty);
      return;
    }
    for (const s of players) {
      const card = document.createElement('section');
      card.className = 'packet-card';
      card.dataset.player = s.id;
      const heading = document.createElement('h3');
      heading.textContent = `${s.id} (${s.state})`;
      const meta = document.createElement('p');
      meta.className = 'packet-meta';
      meta.textContent = `수신율 ${(rates.get(s.id) || 0).toFixed(1)}회/초 · 누적 ${s.count} · 누락 ${s.missing ?? '미측정(seq 없음)'} · 오류 ${s.invalid}`;
      const pre = document.createElement('pre');
      pre.textContent = s.latest ? JSON.stringify(s.latest, null, 2) : '센서 패킷 수신 대기 중...';
      card.append(heading, meta, pre);
      container.append(card);
    }
  }

  root.InGameFront = {
    start,
    stop,
    updatePose,
    renderPackets,
  };
})(globalThis);

