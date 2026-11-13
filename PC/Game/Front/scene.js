import * as THREE from 'three';

// 1. 기본 씬 및 1인칭 2분할 카메라 설정
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6ca357);

export const camera1 = new THREE.PerspectiveCamera(55, (window.innerWidth / 2) / window.innerHeight, 0.05, 1000);
camera1.position.set(0, 1.25, 1.35);
camera1.lookAt(0, 1.15, -1.35);

export const camera2 = new THREE.PerspectiveCamera(55, (window.innerWidth / 2) / window.innerHeight, 0.05, 1000);
camera2.position.set(0, 1.25, -1.35);
camera2.lookAt(0, 1.15, 1.35);

camera1.layers.enable(0);
camera1.layers.enable(1); // P1은 P2 몸체를 봄
camera2.layers.enable(0);
camera2.layers.enable(2); // P2는 P1 몸체를 봄

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

// 조명 및 바닥
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight1.position.set(2, 5, 3);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight2.position.set(-2, 5, -3);
scene.add(dirLight2);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x5a8f47 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// 2. 상대방 캐릭터 더미 생성 (피격 넉백 & 방어 느낌표 & 기절 별 이펙트)
function setRecursiveLayer(object, layerNum) {
  object.layers.set(layerNum);
  object.traverse(child => child.layers.set(layerNum));
}

function createOpponentModel(colorHex, facingAngle) {
  const charGroup = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.3,
    emissive: 0x000000
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), mat);
  head.position.y = 0.55;
  charGroup.add(head);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.65, 32), mat);
  body.position.y = 0.05;
  charGroup.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.08, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  visor.position.set(0, 0.58, 0.26);
  charGroup.add(visor);

  // 방어 시 머리 위 느낌표 (!)
  const alertGroup = new THREE.Group();
  alertGroup.position.set(0, 1.05, 0);
  const exBar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.18, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  const exDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
  );
  exDot.position.y = -0.15;
  alertGroup.add(exBar);
  alertGroup.add(exDot);
  alertGroup.visible = false;
  charGroup.add(alertGroup);

  // 기절(STUN) 시 머리 위를 회전하는 기절 별 링
  const stunHalo = new THREE.Group();
  stunHalo.position.set(0, 0.98, 0);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), starMat);
    star.position.set(Math.cos(angle) * 0.28, 0, Math.sin(angle) * 0.28);
    stunHalo.add(star);
  }
  stunHalo.visible = false;
  charGroup.add(stunHalo);

  charGroup.rotation.y = facingAngle;
  scene.add(charGroup);

  return {
    group: charGroup,
    mat,
    alert: alertGroup,
    stunHalo,
    baseZ: 0,
    recoilZ: 0,
    recoilAngle: 0,
    flashTimer: 0
  };
}

export const p1Body = createOpponentModel(0x3a86ff, Math.PI);
p1Body.baseZ = 1.35;
p1Body.group.position.set(0, 0.8, 1.35);
setRecursiveLayer(p1Body.group, 2);

export const p2Body = createOpponentModel(0xd9383a, 0);
p2Body.baseZ = -1.35;
p2Body.group.position.set(0, 0.8, -1.35);
setRecursiveLayer(p2Body.group, 1);

// 3. 캐릭터 피격/방어/기절 애니메이션 업데이트
export function updateCharacterVisual(opponent, pState, delta, elapsedTime, isPlayer1) {
  opponent.recoilZ = THREE.MathUtils.lerp(opponent.recoilZ, 0, 0.12);
  opponent.recoilAngle = THREE.MathUtils.lerp(opponent.recoilAngle, 0, 0.12);

  const dir = isPlayer1 ? 1 : -1;
  opponent.group.position.z = opponent.baseZ + (opponent.recoilZ * dir);
  opponent.group.rotation.x = opponent.recoilAngle * dir;

  opponent.alert.visible = (pState.status === "DEFENSE");

  const isStunned = (pState.status === "STUN");
  opponent.stunHalo.visible = isStunned;
  if (isStunned) {
    opponent.stunHalo.rotation.y += delta * 5.0;
    opponent.group.rotation.z = Math.sin(elapsedTime * 18) * 0.12;
  } else {
    opponent.group.rotation.z = THREE.MathUtils.lerp(opponent.group.rotation.z, 0, 0.2);
  }

  if (opponent.flashTimer > 0) {
    opponent.flashTimer -= delta;
    opponent.mat.emissive.setHex(0xff2222);
  } else if (isStunned) {
    opponent.mat.emissive.setHex(0x6b21a8);
  } else {
    opponent.mat.emissive.setHex(0x000000);
  }
}

// 4. 2분할 뷰포트 렌더링
export function renderSplitView() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const halfWidth = Math.floor(width / 2);

  renderer.setViewport(0, 0, halfWidth, height);
  renderer.setScissor(0, 0, halfWidth, height);
  camera1.aspect = halfWidth / height;
  camera1.updateProjectionMatrix();
  renderer.render(scene, camera1);

  renderer.setViewport(halfWidth, 0, halfWidth, height);
  renderer.setScissor(halfWidth, 0, halfWidth, height);
  camera2.aspect = halfWidth / height;
  camera2.updateProjectionMatrix();
  renderer.render(scene, camera2);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});
