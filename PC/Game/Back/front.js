// front.js - Three.js 3D 렌더링 및 UI 출력 전담 (View)

class GameFront {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.uiStatus = document.getElementById('ui-status');
        this.uiBtn = document.getElementById('ui-btn');
        this.uiJson = document.getElementById('ui-json');

        this.initThreeJS();
        this.animate();
    }

    initThreeJS() {
        // 1. 씬, 카메라, 렌더러 설정
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            50, 
            this.container.clientWidth / this.container.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(0, 2.5, 6);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        // 2. 조명 및 바닥 그리드 추가
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);

        const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        gridHelper.position.y = -1.5;
        this.scene.add(gridHelper);

        // 3. 3D 스마트폰(컨트롤러) 모델 생성
        this.phoneGroup = new THREE.Group();

        // 스마트폰 본체 (가로 1.2, 세로 2.4, 두께 0.15)
        const bodyGeo = new THREE.BoxGeometry(1.2, 2.4, 0.15);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.3 });
        this.phoneBody = new THREE.Mesh(bodyGeo, bodyMat);
        this.phoneGroup.add(this.phoneBody);

        // 스마트폰 액정 화면 (앞면 식별용 밝은 색상)
        const screenGeo = new THREE.PlaneGeometry(1.05, 2.1);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x00a8ff });
        this.phoneScreen = new THREE.Mesh(screenGeo, screenMat);
        this.phoneScreen.position.z = 0.08;
        this.phoneGroup.add(this.phoneScreen);

        // 스마트폰 상단 방향 표시선 (검 끝 방향 확인용 빨간 바)
        const topBarGeo = new THREE.BoxGeometry(0.4, 0.1, 0.18);
        const topBarMat = new THREE.MeshBasicMaterial({ color: 0xff3f34 });
        const topBar = new THREE.Mesh(topBarGeo, topBarMat);
        topBar.position.y = 1.15;
        this.phoneGroup.add(topBar);

        // 3차원 로컬 축 표시 (X: 빨강, Y: 초록, Z: 파랑)
        const axesHelper = new THREE.AxesHelper(2);
        this.phoneGroup.add(axesHelper);

        this.scene.add(this.phoneGroup);

        // 창 크기 조절 대응
        window.addEventListener('resize', () => {
            this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        });
    }

    // Back에서 연산이 끝난 후 호출하는 화면 갱신 메서드
    updateRender(target_id, status, rawPacket) {
        const { rotation_vector, acceleration, button } = rawPacket.payload;

        // 1. 3D 스마트폰 방향(Quaternion) 실시간 반영
        this.phoneGroup.quaternion.set(
            rotation_vector.x,
            rotation_vector.y,
            rotation_vector.z,
            rotation_vector.w
        );

        // 공격(가속도 증가) 시 스마트폰이 순간적으로 앞으로 튀어나가는 시각 효과
        const thrustOffset = Math.min(acceleration.x * 0.05, 1.0);
        this.phoneGroup.position.x = thrustOffset;

        // 상태에 따른 액정 색상 변경 피드백
        if (button === 1) {
            this.phoneScreen.material.color.setHex(0x0be881); // 방어: 초록색
            this.uiStatus.style.background = '#05c46b';
        } else if (button === 2) {
            this.phoneScreen.material.color.setHex(0xffdd59); // 강타 충전: 노란색
            this.uiStatus.style.background = '#ffa801';
        } else if (acceleration.x > 5) {
            this.phoneScreen.material.color.setHex(0xff3f34); // 공격: 빨간색
            this.uiStatus.style.background = '#ff3f34';
        } else {
            this.phoneScreen.material.color.setHex(0x00a8ff); // 기본 대기: 파란색
            this.uiStatus.style.background = '#3c40c6';
        }

        // 2. 하단 UI 텍스트 및 JSON 패킷 데이터 출력
        this.uiStatus.innerText = status;
        
        const btnDesc = button === 1 ? "1 (볼륨 상 - 방어)" : 
                        button === 2 ? "2 (볼륨 하 - 강타 충전)" : "0 (입력 없음)";
        this.uiBtn.innerText = btnDesc;

        // 소수점 3자리로 깔끔하게 포맷팅하여 하단 모크 데이터 창에 표시
        const formattedPacket = {
            sender_id: target_id,
            rotation_vector: {
                x: Number(rotation_vector.x.toFixed(3)),
                y: Number(rotation_vector.y.toFixed(3)),
                z: Number(rotation_vector.z.toFixed(3)),
                w: Number(rotation_vector.w.toFixed(3))
            },
            acceleration: {
                x: Number(acceleration.x.toFixed(2)),
                y: Number(acceleration.y.toFixed(2)),
                z: Number(acceleration.z.toFixed(2))
            },
            button: button
        };
        this.uiJson.innerText = JSON.stringify(formattedPacket, null, 2);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.renderer.render(this.scene, this.camera);
    }
}

// 전역에서 Back이 접근할 수 있도록 인스턴스 생성
window.frontApp = new GameFront();