'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);
  let scene = null, cameraP1 = null, cameraP2 = null, renderer = null, animId = null;
  let keyBound = false;
  const meshes = new Map();
  const receivedAngles = new Map();
  const receivedPlayerInfo = new Map();

  // 3DoF 양팔(검도 양손 파지) 모델 파라미터
  const ARM_PIVOT_OFFSET = { x: 0, y: -0.22, z: 0.45 };    // 플레이어 몸통 정중앙 스윙 중심점
  const SHOULDER_HALF_WIDTH = 0.44;                        // 양쪽 어깨/팔꿈치 간격 (왼팔: -0.44, 오른팔: +0.44)
  const WRIST_BASE_OFFSET = { x: 0, y: 0.12, z: -0.95 };   // 양손으로 쥔 검 손잡이의 기본 정면 위치

  // [수치 조절용] 방어키를 누를 때 손(검 손잡이)이 현재 검 방향 기준으로 이동하는 거리
  //   x: 검날 좌우(바깥쪽/칼등) 방향 (+값: 오른쪽 바깥, -값: 왼쪽 안쪽)
  //   y: 검 옆면(넓은 면) 수직 방향
  //   z: 검끝 반대쪽(손잡이 뒤쪽) 방향 (+값: 검끝 반대쪽으로 이동)
  const DEFENSE_HAND_OFFSET = { x: 0.0, y: 0, z: 1.0 };

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

    const positionLimbBetween = (limb, sx, sy, sz, tx, ty, tz, baseLen) => {
      if (!limb) return;
      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const len = Math.hypot(dx, dy, dz) || 0.001;
      limb.position?.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2);
      if (limb.scale && baseLen > 0) {
        limb.scale.y = len / baseLen;
      }
      if (THREE.Vector3 && limb.quaternion?.setFromUnitVectors) {
        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
        limb.quaternion.setFromUnitVectors(up, dir);
      }
    };

    const createSwordMesh = (color, xPos, facingYRad) => {
      // 플레이어가 상대방을 바라보는 기준 좌표계 (로컬 -Z가 정면, -X가 왼팔, +X가 오른팔, +Y가 위쪽)
      const baseGroup = new THREE.Group();
      baseGroup.position.set(xPos, 1.1, 0);
      baseGroup.rotation.y = facingYRad;

      // 1) 양팔 스윙 중심 피벗 (몸통 정중앙 기준점)
      const armPivot = new THREE.Group();
      armPivot.position.set(ARM_PIVOT_OFFSET.x, ARM_PIVOT_OFFSET.y, ARM_PIVOT_OFFSET.z);

      // 양쪽(왼팔/오른팔) 팔꿈치 관절 구체 & 양팔 전완 메쉬
      let leftForearm = null;
      let rightForearm = null;
      const defaultLimbLen = Math.hypot(
        SHOULDER_HALF_WIDTH,
        WRIST_BASE_OFFSET.y,
        WRIST_BASE_OFFSET.z
      );

      if (THREE.SphereGeometry && THREE.CylinderGeometry) {
        const jointMat = new THREE.MeshStandardMaterial({ color: 0x8ecab1, roughness: 0.5 });
        const leftJoint = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), jointMat);
        leftJoint.position.set(-SHOULDER_HALF_WIDTH, 0, 0);
        const rightJoint = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), jointMat);
        rightJoint.position.set(SHOULDER_HALF_WIDTH, 0, 0);
        armPivot.add(leftJoint, rightJoint);

        const limbMat = new THREE.MeshStandardMaterial({ color: 0x35584c, roughness: 0.6 });
        leftForearm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.042, 0.058, defaultLimbLen, 10),
          limbMat
        );
        rightForearm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.042, 0.058, defaultLimbLen, 10),
          limbMat
        );

        positionLimbBetween(
          leftForearm,
          -SHOULDER_HALF_WIDTH, 0, 0,
          WRIST_BASE_OFFSET.x, WRIST_BASE_OFFSET.y, WRIST_BASE_OFFSET.z,
          defaultLimbLen
        );
        positionLimbBetween(
          rightForearm,
          SHOULDER_HALF_WIDTH, 0, 0,
          WRIST_BASE_OFFSET.x, WRIST_BASE_OFFSET.y, WRIST_BASE_OFFSET.z,
          defaultLimbLen
        );
        armPivot.add(leftForearm, rightForearm);
      }

      // 2) 양손 손목 & 검 그룹 (양팔이 모이는 끝점에 위치하여 스윙 시 검의 3D 위치가 대칭으로 이동함)
      const swordGroup = new THREE.Group();
      swordGroup.position.set(WRIST_BASE_OFFSET.x, WRIST_BASE_OFFSET.y, WRIST_BASE_OFFSET.z);

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
      armPivot.add(swordGroup);
      baseGroup.add(armPivot);
      scene.add(baseGroup);

      // armPivot(양팔 스윙 -> 검 위치 이동), 양팔 메쉬, swordGroup(손목 회전 -> 검 각도)을 함께 제어
      swordGroup.userData = {
        armPivot,
        leftForearm,
        rightForearm,
        defaultLimbLen,
        positionLimbBetween,
        baseWristOffset: { ...WRIST_BASE_OFFSET },
      };
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

  function syncDurationInputs() {
    const dur = root.InGameBack?.JUDGMENT_DURATION;
    if (!dur) return;
    if ($('dur-attack-hit')) $('dur-attack-hit').value = String(dur.ATTACK_SUCCESS_HIT ?? 1.0);
    if ($('dur-attack-fail')) $('dur-attack-fail').value = String(dur.ATTACK_FAIL_STUN ?? 1.0);
    if ($('dur-parry-stun')) $('dur-parry-stun').value = String(dur.PARRY_STUN ?? 1.0);
  }

  function toggleDurationPanel(forceOpen) {
    const panel = $('ingame-duration-panel');
    if (!panel) return false;
    const willOpen = forceOpen !== undefined ? Boolean(forceOpen) : Boolean(panel.hidden);
    panel.hidden = !willOpen;
    if (willOpen) {
      syncDurationInputs();
    }
    return willOpen;
  }

  function bindInGameKeys() {
    if (keyBound) return;
    const target = root.window || root;
    if (typeof target.addEventListener !== 'function') return;
    keyBound = true;

    const applyDurationFromInputs = () => {
      root.InGameBack?.setJudgmentDurations?.({
        ATTACK_SUCCESS_HIT: $('dur-attack-hit')?.value,
        ATTACK_FAIL_STUN: $('dur-attack-fail')?.value,
        PARRY_STUN: $('dur-parry-stun')?.value,
      });
    };

    for (const inputId of ['dur-attack-hit', 'dur-attack-fail', 'dur-parry-stun']) {
      $(inputId)?.addEventListener?.('input', applyDurationFromInputs);
      $(inputId)?.addEventListener?.('change', applyDurationFromInputs);
    }

    if ($('close-duration-panel')) {
      $('close-duration-panel').onclick = () => toggleDurationPanel(false);
    }

    target.addEventListener('keydown', (event) => {
      if ($('ingame-view')?.hidden) return;
      const activeTag = event.target?.tagName?.toUpperCase?.() || '';
      const isEditingInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if (event.key === 'Tab' || event.code === 'Tab') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleOverlay();
        }
      } else if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleDurationPanel();
        }
      } else if (event.key === 'Escape' || event.code === 'Escape') {
        if (!$('ingame-duration-panel')?.hidden) {
          event.preventDefault?.();
          toggleDurationPanel(false);
        }
      }
    });
  }

  function start(onBackToLobby) {
    if ($('lobby-view')) $('lobby-view').hidden = true;
    if ($('ingame-view')) $('ingame-view').hidden = false;
    if ($('back-to-lobby')) $('back-to-lobby').onclick = onBackToLobby;
    bindInGameKeys();
    syncDurationInputs();
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

  // 기본 자세 쿼터니언 (0, 0, 0, 1)에서 목표 쿼터니언 q까지 비율 t만큼 구면 선형 보간(Slerp)
  function slerpFromIdentity(q, t) {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    let qx = q.x / len;
    let qy = q.y / len;
    let qz = q.z / len;
    let qw = q.w / len;

    // 최단 경로 회전 보장 (w < 0이면 부호 반전)
    if (qw < 0) {
      qx = -qx;
      qy = -qy;
      qz = -qz;
      qw = -qw;
    }

    if (qw > 0.9995) {
      const lx = qx * t;
      const ly = qy * t;
      const lz = qz * t;
      const lw = 1 - t + qw * t;
      const lLen = Math.hypot(lx, ly, lz, lw) || 1;
      return { x: lx / lLen, y: ly / lLen, z: lz / lLen, w: lw / lLen };
    }

    const theta0 = Math.acos(Math.min(1, Math.max(-1, qw)));
    const sinTheta0 = Math.sin(theta0) || 1;
    const theta = theta0 * t;
    const s0 = Math.cos(theta) - (qw * Math.sin(theta)) / sinTheta0;
    const s1 = Math.sin(theta) / sinTheta0;

    return {
      x: s1 * qx,
      y: s1 * qy,
      z: s1 * qz,
      w: s0 + s1 * qw,
    };
  }

  // 로컬 벡터 v를 쿼터니언 q로 회전시킨 벡터 반환 (현재 검이 향하는 방향 기준 오프셋 계산용)
  function rotateVectorByQuat(v, q) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  // 핸드폰 기본 파지 자세 매핑:
  // 핸드폰 화면을 위로 놓은 기준(0, 0, 0, 1)에서 핸드폰의 오른쪽 면(+X)이 위(+Y)를 향하고
  // 화면(+Y)과 후면 카메라(-Y)가 검의 좌/우 옆면(±X)이 되도록 Z축 기준 +90도 회전 변환 적용
  function mapGripQuaternion(q) {
    return {
      x: -q.y,
      y: q.x,
      z: q.z,
      w: q.w,
    };
  }

  function updatePose(playerId, data) {
    if (!data) return;
    const tilt = data.tilt || data.rotation_vector;
    if (!tilt) return;

    const rawQ = {
      x: Number(tilt.x) || 0,
      y: Number(tilt.y) || 0,
      z: Number(tilt.z) || 0,
      w: tilt.w !== undefined ? Number(tilt.w) : 1,
    };
    const q = mapGripQuaternion(rawQ);
    receivedAngles.set(playerId, q);

    const mesh = meshes.get(playerId);
    if (!mesh) return;

    const armPivot = mesh.userData?.armPivot;
    const leftForearm = mesh.userData?.leftForearm;
    const rightForearm = mesh.userData?.rightForearm;
    const defaultLimbLen = mesh.userData?.defaultLimbLen || 1;
    const positionLimbBetween = mesh.userData?.positionLimbBetween;
    const baseWrist = mesh.userData?.baseWristOffset;
    const isDefending = data.state === 'DEFENSE' || data.state === 'STUN_DEFENSE' || data.button === 1;

    if (armPivot && armPivot.quaternion?.set && mesh.quaternion?.set) {
      // 1) 양팔 스윙(55%): 몸통 중앙 피벗이 회전하여 검 손잡이의 3D 위치를 좌/우 대칭 호(Arc)를 그리며 이동시킴
      const armQuat = slerpFromIdentity(q, 0.55);
      armPivot.quaternion.set(armQuat.x, armQuat.y, armQuat.z, armQuat.w).normalize();

      // 2) 손목 회전(45%): 양팔 회전(55%)과 합쳐져 검날이 정확히 목표 쿼터니언(100%) 방향을 향하도록 회전
      const wristQuat = slerpFromIdentity(q, 0.45);
      mesh.quaternion.set(wristQuat.x, wristQuat.y, wristQuat.z, wristQuat.w).normalize();

      // 3) 방어 시 현재 검날 방향 기준 오프셋(DEFENSE_HAND_OFFSET)만큼 양손 위치를 이동
      if (baseWrist && mesh.position?.set) {
        let wx = baseWrist.x;
        let wy = baseWrist.y;
        let wz = baseWrist.z;

        if (isDefending) {
          const shift = rotateVectorByQuat(DEFENSE_HAND_OFFSET, wristQuat);
          wx += shift.x;
          wy += shift.y;
          wz += shift.z;
        } else {
          const accelMag = data.acceleration
            ? Math.max(0, Number(data.acceleration.x) || 0)
            : 0;
          const lunge = Math.min(0, accelMag * 0.022); //공격시 런지거리 조절
          wz -= lunge;
        }

        mesh.position.set(wx, wy, wz);
        if (typeof positionLimbBetween === 'function') {
          positionLimbBetween(leftForearm, -SHOULDER_HALF_WIDTH, 0, 0, wx, wy, wz, defaultLimbLen);
          positionLimbBetween(rightForearm, SHOULDER_HALF_WIDTH, 0, 0, wx, wy, wz, defaultLimbLen);
        }
      }
    } else if (mesh.quaternion?.set) {
      mesh.quaternion.set(q.x, q.y, q.z, q.w).normalize();
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
      const durationText = playerInfo?.stateDuration !== undefined
        ? ` (${Number(playerInfo.stateDuration).toFixed(2)}s)`
        : '';
      angleBox.textContent = `검 쿼터니언(XYZW): X ${qx} · Y ${qy} · Z ${qz} · W ${qw}${gameState}${durationText}`;

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
    toggleDurationPanel,
  };
})(globalThis);
