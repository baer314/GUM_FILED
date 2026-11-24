'use strict';
(function (root) {
  let threeRef = null;
  let sceneRef = null;
  let sparkGroup = null;
  let sparkGeom = null;
  let flashGeom = null;
  const activeBursts = [];
  let lastFrameMs = 0;

  const SPARK_COLORS = [0xffffff, 0xfff3b0, 0xffc83d, 0xff8c24, 0xff4d1a];
  const SPARK_COUNT = 26;
  const SPARK_GRAVITY = 12.5;

  function getNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function init(THREE, scene) {
    if (!THREE || !scene) return;
    threeRef = THREE;
    sceneRef = scene;
    if (!sparkGroup && THREE.Group) {
      sparkGroup = new THREE.Group();
      scene.add(sparkGroup);
    }
    if (!sparkGeom && THREE.BoxGeometry) {
      // 불똥이 날아가는 방향으로 길게 늘어져 보이도록 Z축으로 긴 작은 입자
      sparkGeom = new THREE.BoxGeometry(0.022, 0.022, 0.16);
    }
    if (!flashGeom && THREE.SphereGeometry) {
      flashGeom = new THREE.SphereGeometry(0.16, 12, 10);
    }
    lastFrameMs = getNowMs();
  }

  function spawn(worldPoint, worldDir) {
    if (!threeRef || !sparkGroup || !sparkGeom || !threeRef.MeshBasicMaterial) return;
    const THREE = threeRef;

    const px = Number(worldPoint?.x) || 0;
    const py = Number(worldPoint?.y) || 1.4;
    const pz = Number(worldPoint?.z) || 0;

    // 피격 방향 반대/측면으로 불똥이 튀어오르도록 기준 방향 계산
    const dx = Number(worldDir?.x) || 0;
    const dy = Number(worldDir?.y) || 0;
    const dz = Number(worldDir?.z) || 0;
    const dLen = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dLen;
    const ny = dy / dLen;
    const nz = dz / dLen;

    const particles = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkGeom, mat);
      mesh.position.set(px, py, pz);

      // 구면 랜덤 분산 + 타격 방향 반사/스플래시 속도 부여
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const rx = Math.sin(phi) * Math.cos(theta);
      const ry = Math.sin(phi) * Math.sin(theta);
      const rz = Math.cos(phi);

      const speed = 3.2 + Math.random() * 5.6;
      const vx = (rx * 0.85 - nx * 0.45) * speed;
      const vy = (ry * 0.85 - ny * 0.35 + 0.42) * speed;
      const vz = (rz * 0.85 - nz * 0.45) * speed;

      const scaleLen = 0.65 + Math.random() * 1.15;
      mesh.scale.set(0.8 + Math.random() * 0.5, 0.8 + Math.random() * 0.5, scaleLen);
      mesh.lookAt(px + vx, py + vy, pz + vz);
      sparkGroup.add(mesh);

      particles.push({
        mesh,
        mat,
        vx,
        vy,
        vz,
        life: 0,
        maxLife: 0.26 + Math.random() * 0.30,
        baseScaleZ: scaleLen,
      });
    }

    // 피격 지점 순간 섬광(코어 플래시)
    let flash = null;
    if (flashGeom) {
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xfff0b3,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const flashMesh = new THREE.Mesh(flashGeom, flashMat);
      flashMesh.position.set(px, py, pz);
      sparkGroup.add(flashMesh);
      flash = { mesh: flashMesh, mat: flashMat, life: 0, maxLife: 0.13 };
    }

    activeBursts.push({ particles, flash });
  }

  function update() {
    if (!sparkGroup || activeBursts.length === 0) {
      lastFrameMs = getNowMs();
      return;
    }

    const nowMs = getNowMs();
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    for (let b = activeBursts.length - 1; b >= 0; b--) {
      const burst = activeBursts[b];
      let aliveCount = 0;

      if (burst.flash) {
        const f = burst.flash;
        f.life += dt;
        if (f.life >= f.maxLife) {
          sparkGroup.remove(f.mesh);
          f.mat.dispose?.();
          burst.flash = null;
        } else {
          const t = f.life / f.maxLife;
          const s = 1.0 + t * 2.2;
          f.mesh.scale.set(s, s, s);
          f.mat.opacity = Math.max(0, 1 - t) * 0.9;
          aliveCount++;
        }
      }

      for (let i = burst.particles.length - 1; i >= 0; i--) {
        const p = burst.particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          sparkGroup.remove(p.mesh);
          p.mat.dispose?.();
          burst.particles.splice(i, 1);
          continue;
        }

        // 중력 및 공기 저항 적용
        p.vy -= SPARK_GRAVITY * dt;
        const drag = Math.pow(0.92, dt * 60);
        p.vx *= drag;
        p.vy *= drag;
        p.vz *= drag;

        const nx = p.mesh.position.x + p.vx * dt;
        const ny = p.mesh.position.y + p.vy * dt;
        const nz = p.mesh.position.z + p.vz * dt;
        p.mesh.position.set(nx, ny, nz);
        p.mesh.lookAt(nx + p.vx, ny + p.vy, nz + p.vz);

        const remain = 1 - p.life / p.maxLife;
        p.mat.opacity = Math.max(0, remain * remain);
        const speedRatio = Math.min(1.6, Math.hypot(p.vx, p.vy, p.vz) / 5.0);
        p.mesh.scale.z = Math.max(0.18, p.baseScaleZ * remain * (0.5 + speedRatio * 0.5));
        aliveCount++;
      }

      if (aliveCount === 0) {
        activeBursts.splice(b, 1);
      }
    }
  }

  function reset() {
    if (sparkGroup) {
      for (const burst of activeBursts) {
        if (burst.flash) {
          sparkGroup.remove(burst.flash.mesh);
          burst.flash.mat.dispose?.();
        }
        for (const p of burst.particles) {
          sparkGroup.remove(p.mesh);
          p.mat.dispose?.();
        }
      }
    }
    activeBursts.length = 0;
  }

  root.HitSparkEffect = {
    init,
    spawn,
    update,
    reset,
  };
})(globalThis);
