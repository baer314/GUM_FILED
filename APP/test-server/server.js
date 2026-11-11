// 앱 단독 테스트용 가짜 서버.
// 실제 서버(PC/Server)가 준비되기 전에 "입, 출력 규격.docx"의 흐름을 흉내낸다.
//
//   실행:  npm install  →  npm start
//   콘솔 명령:  start  (GAME_START 보내기)   stat  (수신 통계)   quit
//
// 폰과 PC가 같은 와이파이에 있어야 한다. 학교 와이파이가 기기 간 통신을 막으면 노트북 핫스팟 사용.

const os = require('os');
const readline = require('readline');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-terminal');

const PORT = Number(process.env.PORT || 8080);
const PIN = process.env.PIN || 'TEST01';

// Windows는 VirtualBox, WSL(vEthernet) 같은 가상 어댑터 주소도 잡히므로 전부 보여주고
// 공유기 대역(192.168.x.x)을 우선으로 QR에 넣는다. 다르면 HOST=주소 로 지정해서 실행.
function lanAddresses() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) all.push({ name, address: a.address });
    }
  }
  return all;
}
function pickAddress(all) {
  if (process.env.HOST) return process.env.HOST;
  const pref = all.find((a) => a.address.startsWith('192.168.')) || all[0];
  return pref ? pref.address : '127.0.0.1';
}

const addresses = lanAddresses();
const HOST = pickAddress(addresses);
const qrData = `ws://${HOST}:${PORT}?pin=${PIN}`;
const wss = new WebSocketServer({ port: PORT });
const players = new Map(); // ws -> { id, sensorCount, lastSensor, lastLog }

console.log(`\n테스트 서버 실행 중  ${qrData}`);
console.log('이 PC의 IPv4 주소:', addresses.map((a) => `${a.address} (${a.name})`).join(', ') || '없음');
console.log(`앱에서 서버 주소 ${HOST}:${PORT}, PIN ${PIN} 입력 또는 아래 QR 스캔\n`);
qrcode.generate(qrData, { small: true });
console.log('\n명령: start = GAME_START 전송, stat = 통계, quit = 종료\n');

function freeId() {
  const used = new Set([...players.values()].map((p) => p.id));
  return ['PLAYER_1', 'PLAYER_2'].find((id) => !used.has(id));
}

wss.on('connection', (ws, req) => {
  console.log(`[연결] ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.log('[무시] JSON 아님:', data.toString());
      return;
    }

    switch (msg.type) {
      case 'JOIN_ROOM': {
        if (msg.pin !== PIN) {
          ws.send(JSON.stringify({ type: 'JOIN_FAIL', message: 'PIN이 틀렸습니다' }));
          return;
        }
        const id = freeId();
        if (!id) {
          ws.send(JSON.stringify({ type: 'JOIN_FAIL', message: '방이 가득 찼습니다' }));
          return;
        }
        players.set(ws, { id, sensorCount: 0, lastSensor: null, lastLog: null });
        ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', assigned_id: id }));
        console.log(`[입장] ${id} (client_type=${msg.client_type})`);
        break;
      }
      case 'SENSOR': {
        const p = players.get(ws);
        if (!p) return;
        const now = Date.now();
        if (p.lastLog === null) p.lastLog = now; // 첫 패킷부터 1초 단위로 센다
        p.sensorCount++;
        p.lastSensor = msg;
        if (now - p.lastLog >= 1000) {
          const r = msg.payload.rotation_vector;
          const a = msg.payload.acceleration;
          const lag = now - msg.timestamp; // 폰과 PC 시계가 다르면 의미 없음, 참고용
          console.log(
            `[SENSOR] ${p.id} ${p.sensorCount}개/s  button=${msg.payload.button}  ` +
              `rot(w=${r.w.toFixed(2)} x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} z=${r.z.toFixed(2)})  ` +
              `acc(${a.x.toFixed(1)}, ${a.y.toFixed(1)}, ${a.z.toFixed(1)})  시계차 ${lag}ms`
          );
          p.sensorCount = 0;
          p.lastLog = now;
        }
        break;
      }
      case 'CALIBRATE_CONFIRM':
        console.log(`[영점] ${msg.sender_id} 확인 (button_input=${msg.button_input})`);
        break;
      default:
        console.log('[수신]', msg);
    }
  });

  ws.on('close', () => {
    const p = players.get(ws);
    console.log(`[끊김] ${p ? p.id : '미입장'}`);
    players.delete(ws);
  });
});

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const cmd = line.trim();
  if (cmd === 'start') {
    for (const ws of players.keys()) ws.send(JSON.stringify({ type: 'GAME_START' }));
    console.log(`[전송] GAME_START → ${players.size}명`);
  } else if (cmd === 'stat') {
    for (const p of players.values()) console.log(p.id, p.lastSensor);
  } else if (cmd === 'quit') {
    process.exit(0);
  }
});
