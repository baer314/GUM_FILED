# APP: 검 컨트롤러 (Android, Kotlin)

폰의 자세·가속도·볼륨 키 입력을 PC 게임으로 보내는 컨트롤러 앱입니다.
메시지 형식은 실제 구현(`Server/server.js`, `PC/network.js`, `PC/protocol.js`)에 맞춰져 있습니다.

```
APP/
├─ GumController/   Android Studio 프로젝트
└─ test-server/     (구버전) 실제 서버가 없던 시기의 가짜 서버. 지금은 Server/를 사용
```

## 실행 방법

1. Android Studio에서 **Open** → `APP/GumController` 선택 (APP 폴더가 아니라 GumController). Gradle Sync가 끝날 때까지 기다립니다.
2. 폰을 USB 디버깅으로 연결하고 ▶ Run을 누릅니다. 자이로가 없는 에뮬레이터로는 테스트할 수 없습니다.
3. 서버 없이 먼저 확인: 앱에서 **센서 테스트** → "패킷 생성 60/s" 근처가 나오면 정상입니다.
4. Windows에서는 프로젝트 경로에 한글이 있으면 빌드가 실패합니다 (예: `C:\dev\GUM_FIELD`).

## 실제 서버로 테스트

폰에서 접속하려면 환경변수가 필요합니다. PC 주소는 `ipconfig`로 확인합니다.

| 터미널 | 명령 (`Server` 폴더에서) |
|---|---|
| Git Bash | `HOST=0.0.0.0 PUBLIC_BASE_URL=http://<PC IP>:8080 TRANSPORT=p2p node server.js` |
| cmd | `set HOST=0.0.0.0` → `set PUBLIC_BASE_URL=http://<PC IP>:8080` → `set TRANSPORT=p2p` → `npm.cmd start` |
| PowerShell | `$env:HOST="0.0.0.0"` → `$env:PUBLIC_BASE_URL="http://<PC IP>:8080"` → `$env:TRANSPORT="p2p"` → `node server.js` |

- `TRANSPORT`: `p2p`(WebRTC 직접 연결, 서버 기본값) 또는 `relay`(서버 중계). 앱은 둘 다 지원하고, 서버가 알려주는 값을 자동으로 따릅니다.
- 오프라인 핫스팟에서 p2p가 느리게 붙으면 `STUN_URL=` (빈 값)도 같이 지정해 보세요.
- PC 브라우저에서 `http://127.0.0.1:8080` → QR 스캔 → PC에서 플레이 시작 → 앱에서 확인
- 학교 와이파이는 기기 간 통신을 막는 경우가 많습니다. 노트북 핫스팟을 쓰세요.
- 폰 브라우저에서 `http://<PC IP>:8080/health`가 열리면 네트워크는 정상입니다.

## 코드 구조

| 파일 | 역할 |
|---|---|
| `Config.kt` | 전송 주기(60Hz), 가속도 종류, p2p 연결 제한 시간 등 |
| `MainActivity.kt` | 화면 전환(연결 → 대기 → 게임), 서버 메시지 처리, transport 선택, 볼륨 키, QR |
| `net/Packet.kt` | 모든 메시지 생성과 type 상수. **규격이 바뀌면 여기만 수정** |
| `net/Transport.kt` | SENSOR 전송 통로 인터페이스 |
| `net/WsClient.kt` | 서버와의 WebSocket (입장, WebRTC 시그널링, relay 모드의 GAME_START·SENSOR) |
| `net/RtcClient.kt` | PC와의 WebRTC (Answer·ICE 처리, `game` DataChannel로 GAME_START 수신·SENSOR 전송) |
| `net/JoinInfo.kt` | QR(`server_url`, `pin`)과 서버 주소 해석, `/ws` 경로 자동 추가 |
| `sensor/SensorSampler.kt` | 센서 등록, 최신값 보관 (GAME_ROTATION_VECTOR, 선형 가속도, 자이로) |
| `sensor/SensorStreamer.kt` | 60Hz 타이머로 SENSOR 전송, `seq` 순번 관리 |

## 연결 흐름

```
relay: 앱 ─JOIN_ROOM→ 서버 ─JOIN_SUCCESS→ 앱
       PC ─GAME_START→ 서버 → 앱,  앱 ─SENSOR→ 서버 → PC

p2p:   앱 ─JOIN_ROOM→ 서버 ─JOIN_SUCCESS→ 앱
       PC ─WEBRTC_OFFER→ 서버 → 앱,  앱 ─WEBRTC_ANSWER→ 서버 → PC,  ICE 후보 양방향 (서버 경유)
       PC ═GAME_START═▶ 앱,  앱 ═SENSOR═▶ PC   (DataChannel "game", 서버 거치지 않음)
```

## 진행 상황

- [x] 센서 수집 (자세 쿼터니언, 가속도, 각속도)
- [x] QR 스캔 / 주소·PIN 입력 → `JOIN_ROOM` → `JOIN_SUCCESS`
- [x] `SENSOR` 60Hz 전송, `seq` 포함
- [x] relay 모드 (WebSocket)
- [x] p2p 모드 (WebRTC DataChannel), 15초 안에 연결 안 되면 실패 처리
- [x] `ERROR` 처리 (입장 실패 시 연결 화면 복귀, 게임 중에는 알림), `ROOM_CLOSED` 처리
- [x] 볼륨 키 → button 0/1/2 (볼륨 하 = 방어 1, 볼륨 상 = 검 정렬 2)
- [x] 인게임과 맞춘 테마 (보랏빛 우주 배경, 로우폴리 소품, 1P 민트 / 2P 피치). 시안: `design/theme-mockup-v2.1.png`
- [x] 영점 화면 제거 (영점은 PC에서 처리, `GAME_START` 받으면 바로 게임 화면)
- [x] 입장·QR 스캔 시 키패드 내림, PIN 입력 후 키패드 '이동'으로 바로 입장
- [ ] 진동 피드백, 게임 종료 처리 (PC → 앱 메시지가 아직 없음)

## 팀 확인이 필요한 항목

1. 타격·방어·게임 종료를 앱에 알려줄 메시지 (진동 피드백용)
2. 볼륨 키 두 개 동시 입력 → 현재 방어(1) 우선 (정렬보다 막기가 먼저)
3. 각속도 전송 여부 → `Config.INCLUDE_ANGULAR_VELOCITY` (기본 false)
