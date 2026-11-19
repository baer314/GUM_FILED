'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);
  let scene = null, cameraP1 = null, cameraP2 = null, renderer = null, animId = null;
  let keyBound = false;
  const meshes = new Map();
  const receivedAngles = new Map();
  const receivedPlayerInfo = new Map();

  function initThree() {
    const THREE = root.THREE;
    const canvas = $('ingame-canvas');
    if (!THREE || !canvas || typeof canvas.getContext !== 'function') return;
    if (renderer) { resizeThree(); return; }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1715);

    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const halfWidth = Math.max(1, Math.floor(width / 2));

    // 좌측 화면: 플레이어 1 시점 카메라 (플레이어 1 뒤에서 플레이어 2를 바라봄)
    cameraP1 = new THREE.PerspectiveCamera(60, halfWidth / height, 0.1, 100);
    cameraP1.position.set(-4.2, 2.3, 0);
    cameraP1.lookAt(1.8, 1.1, 0);

    // 우측 화면: 플레이어 2 시점 카메라 (플레이어 2 뒤에서 플레이어 1을 바라봄)
    cameraP2 = new THREE.PerspectiveCamera(60, (width - halfWidth) / height, 0.1, 100);
    cameraP2.position.set(4.2, 2.3, 0);
    cameraP2.lookAt(-1.8, 1.1, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    if (root.devicePixelRatio) renderer.setPixelRatio(Math.min(root.devicePixelRatio, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(4, 8, 6);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(12, 12, 0x3b7a62, 0x1f3a31);
    scene.add(grid);

    const createSwordMesh = (color, xPos, facingYRad) => {
      // 플레이어가 상대방을 바라보는 기준 좌표계 (컨트롤러의 -Z 전방 시점과 일치시킴)
      const baseGroup = new THREE.Group();
      baseGroup.position.set(xPos, 1.1, 0);
      baseGroup.rotation.y = facingYRad;

      // 센서 쿼터니언이 직접 적용되는 검 그룹
      // 핸드폰 윗부분(-Z) = 검날이 뻗는 방향(-Z)
      // 핸드폰 화면/카메라 면(±Y) = 검의 넓은 옆면(±Y)
      const swordGroup = new THREE.Group();
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.06, 2.2),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 })
      );
      blade.position.z = -0.6;
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.16, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xd9a441 })
      );
      swordGroup.add(blade, guard);
      baseGroup.add(swordGroup);
      scene.add(baseGroup);
      return swordGroup;
    };

    meshes.set('PLAYER_1', createSwordMesh(0x4fd1a5, -1.8, -Math.PI / 2));
    meshes.set('PLAYER_2', createSwordMesh(0xf28b66, 1.8, Math.PI / 2));

    root.addEventListener?.('resize', resizeThree);
  }

  function resizeThree() {
    if (!renderer || !cameraP1 || !cameraP2) return;
    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const halfWidth = Math.max(1, Math.floor(width / 2));

    cameraP1.aspect = halfWidth / height;
    cameraP1.updateProjectionMatrix();

    cameraP2.aspect = (width - halfWidth) / height;
    cameraP2.updateProjectionMatrix();

    renderer.setSize(width, height);
  }

  function renderSplitView() {
    if (!renderer || !scene || !cameraP1 || !cameraP2) return;
    const width = root.innerWidth || 1280;
    const height = root.innerHeight || 720;
    const halfWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(1, width - halfWidth);

    renderer.setScissorTest?.(true);

    // 좌측: 플레이어 1 화면
    renderer.setViewport?.(0, 0, halfWidth, height);
    renderer.setScissor?.(0, 0, halfWidth, height);
    renderer.render(scene, cameraP1);

    // 우측: 플레이어 2 화면
    renderer.setViewport?.(halfWidth, 0, rightWidth, height);
    renderer.setScissor?.(halfWidth, 0, rightWidth, height);
    renderer.render(scene, cameraP2);

    renderer.setScissorTest?.(false);
  }

  function animate() {
    renderSplitView();
    if (typeof root.requestAnimationFrame === 'function') {
      animId = root.requestAnimationFrame(animate);
    }
  }

  function toggleOverlay() {
    const overlay = $('ingame-overlay');
    if (!overlay) return false;
    overlay.hidden = !overlay.hidden;
    return !overlay.hidden;
  }

  function bindTabToggle() {
    if (keyBound) return;
    const target = root.window || root;
    if (typeof target.addEventListener !== 'function') return;
    keyBound = true;
    target.addEventListener('keydown', (event) => {
      if ($('ingame-view')?.hidden) return;
      if (event.key === 'Tab' || event.code === 'Tab') {
        event.preventDefault?.();
        toggleOverlay();
      }
    });
  }

  function start(onBackToLobby) {
    if ($('lobby-view')) $('lobby-view').hidden = true;
    if ($('ingame-view')) $('ingame-view').hidden = false;
    if ($('back-to-lobby')) $('back-to-lobby').onclick = onBackToLobby;
    bindTabToggle();
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

  function updatePose(playerId, data) {
    if (!data) return;
    const tilt = data.tilt || data.rotation_vector;
    if (!tilt) return;

    receivedAngles.set(playerId, {
      x: Number(tilt.x) || 0,
      y: Number(tilt.y) || 0,
      z: Number(tilt.z) || 0,
      w: tilt.w !== undefined ? Number(tilt.w) : 1,
    });

    const mesh = meshes.get(playerId);
    if (!mesh) return;

    if (mesh.quaternion?.set) {
      mesh.quaternion.set(tilt.x, tilt.y, tilt.z, tilt.w ?? 1).normalize();
    }
  }

  function updateGraphics(playerData) {
    if (!playerData || typeof playerData !== 'object') return;
    for (const [playerId, info] of Object.entries(playerData)) {
      if (info && typeof info === 'object') {
        receivedPlayerInfo.set(playerId, info);
      }
      updatePose(playerId, info);
    }
    renderSplitView();
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
    const ordered = [...players].sort((a, b) => a.id.localeCompare(b.id));
    for (const s of ordered) {
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

      const playerInfo = receivedPlayerInfo.get(s.id) || root.InGameBack?.getPlayerData?.(s.id);
      const q = receivedAngles.get(s.id) || playerInfo?.tilt || { x: 0, y: 0, z: 0, w: 1 };

      const angleBox = document.createElement('p');
      angleBox.className = 'sword-angle-info';
      const qx = Number(q.x || 0).toFixed(2);
      const qy = Number(q.y || 0).toFixed(2);
      const qz = Number(q.z || 0).toFixed(2);
      const qw = Number(q.w ?? 1).toFixed(2);
      const gameState = playerInfo?.state ? ` · 게임상태 ${playerInfo.state}` : '';
      angleBox.textContent = `검 쿼터니언(XYZW): X ${qx} · Y ${qy} · Z ${qz} · W ${qw}${gameState}`;

      card.append(heading, meta, pre, angleBox);
      container.append(card);
    }
  }

  root.InGameFront = {
    start,
    stop,
    updatePose,
    updateGraphics,
    renderPackets,
    toggleOverlay,
  };
})(globalThis);
