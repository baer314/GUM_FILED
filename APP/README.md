# APP: 검 컨트롤러 (Android, Kotlin)

폰의 자세·가속도·볼륨 키 입력을 PC 게임으로 보내는 컨트롤러 앱입니다.
패킷 형식은 루트의 `입, 출력 규격.docx`를 따릅니다.

```
APP/
├─ GumController/   Android Studio 프로젝트
└─ test-server/     앱 단독 테스트용 가짜 서버 (Node.js)
```

## 실행 방법

1. Android Studio에서 **Open** → `APP/GumController` 선택. Gradle Sync가 끝날 때까지 기다립니다.
   - "AGP 업그레이드" 안내가 뜨면 그대로 진행해도 됩니다.
2. 폰을 USB 디버깅으로 연결하고 ▶ Run을 누릅니다. 자이로가 없는 에뮬레이터로는 테스트할 수 없습니다.
3. 서버 없이 먼저 확인: 앱에서 **센서 테스트** → 폰을 움직이면 값이 바뀌고, "패킷 생성 60/s" 근처가 나오면 정상입니다.

## 테스트 서버로 연결 확인

```bash
cd APP/test-server
npm install
npm start
```

- 콘솔에 PC 주소, PIN(`TEST01`), QR 코드가 출력됩니다.
- 앱에서 QR 스캔 또는 주소·PIN 입력 → **입장** → 콘솔에 `[입장] PLAYER_1`
- 콘솔에 `start` 입력 → 앱이 영점 화면으로 이동하고 `[SENSOR] ... 60개/s` 로그가 나옵니다.
- 앱에서 **확인** → `[영점]` 로그, 볼륨 키를 누르면 `button=1/2`
- PC와 폰은 같은 와이파이에 있어야 합니다. 연결이 안 되면 노트북 핫스팟에 폰을 붙여보세요.
- 주소가 잘못 잡히면 `HOST=192.168.0.5 npm start` (Windows PowerShell: `$env:HOST="192.168.0.5"; npm start`)

## 코드 구조

| 파일 | 역할 |
|---|---|
| `Config.kt` | 전송 주기(60Hz), 가속도 종류, 기본 포트 등 팀 합의로 바뀔 값 |
| `MainActivity.kt` | 화면 4개 전환(연결 → 대기 → 영점 → 게임), 볼륨 키, QR |
| `net/Packet.kt` | 규격서의 패킷 생성. **규격이 바뀌면 여기만 수정** |
| `net/Transport.kt` | 게임 데이터 전송 통로 인터페이스 |
| `net/WsClient.kt` | 서버와의 WebSocket (입장, 시그널링, 프로토타입 동안은 SENSOR까지) |
| `net/JoinInfo.kt` | QR 문자열과 서버 주소 해석 |
| `sensor/SensorSampler.kt` | 센서 등록, 최신값 보관 (GAME_ROTATION_VECTOR, 선형 가속도, 자이로) |
| `sensor/SensorStreamer.kt` | 60Hz 타이머로 SENSOR 패킷 전송 |

## 진행 상황

- [x] 센서 수집 (자세 쿼터니언, 가속도, 각속도)
- [x] PIN 입력 / QR 스캔 → `JOIN_ROOM` → `JOIN_SUCCESS`
- [x] `GAME_START` → 영점 화면 → `CALIBRATE_CONFIRM`
- [x] `SENSOR` 60Hz 전송 (현재 WebSocket 경유)
- [x] 볼륨 키 → button 0/1/2
- [ ] WebRTC DataChannel로 전송 통로 교체 (`Transport` 구현체 추가, build.gradle의 webrtc 주석 해제)
- [ ] 진동 피드백 (서버 → 앱 메시지 규격 필요)

## 팀 확인이 필요한 항목

1. `acceleration`에 중력 포함 여부 → 현재 선형 가속도(중력 제외), `Config.USE_LINEAR_ACCELERATION`
2. `CALIBRATE_CONFIRM`의 `button_input` 값 → 현재 0
3. 볼륨 키 두 개 동시 입력 → 현재 방어(1) 우선
4. `qr_data` 문자열 형식 → 현재 `ws://IP:PORT?pin=PIN`, JSON, PIN 단독 모두 허용
5. 입장 실패 응답 형식 → 규격에 없음, 현재는 `message` 필드를 화면에 표시
6. 각속도 전송 여부 → `Config.INCLUDE_ANGULAR_VELOCITY` (기본 false)
7. 프로토타입 동안 서버가 SENSOR를 WebSocket으로 Net에 넘겨줄지
