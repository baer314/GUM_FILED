'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const protocol = require('../Game/protocol.js');

function createServer({ transport = 'p2p', publicBaseUrl = '',
  stunUrl = 'stun:stun.l.google.com:19302', heartbeatMs = 30000 } = {}) {
  if (!['p2p', 'relay'].includes(transport)) throw new Error('TRANSPORT must be p2p or relay');
  const publicUrl = publicBaseUrl ? new URL(publicBaseUrl) : null;
  if (publicUrl && (!['http:', 'https:'].includes(publicUrl.protocol)
      || publicUrl.username || publicUrl.password)) throw new Error('Invalid PUBLIC_BASE_URL');
  if (stunUrl && !/^stuns?:[^\s]+$/.test(stunUrl)) throw new Error('Invalid STUN_URL');
  const iceServers = stunUrl ? [{ urls: stunUrl }] : [];
  const rooms = new Map();
  const files = new Map([
    ['/', ['public/pc.html', 'text/html']],
    ['/pc.html', ['public/pc.html', 'text/html']],
    ['/controller.html', ['public/controller.html', 'text/html']],
    ['/pc.js', ['public/pc.js', 'text/javascript']],
    ['/controller.js', ['public/controller.js', 'text/javascript']],
    ['/style.css', ['public/style.css', 'text/css']],
    ['/network.js', ['../Game/network.js', 'text/javascript']],
    ['/protocol.js', ['../Game/protocol.js', 'text/javascript']],
  ]);
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { res.writeHead(400).end(); return; }
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, transport })); return;
    }
    const file = files.get(pathname);
    if (!file) { res.writeHead(404).end(); return; }
    try {
      const data = await readFile(path.join(__dirname, file[0]));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      console.error('Static file:', error.message); res.writeHead(500).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    if (pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const send = (ws, message) => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    // ponytail: disconnect slow peers at 256 KiB; add flow control if larger traffic is needed.
    if (ws.bufferedAmount > 262144) { ws.close(1013, 'Slow receiver'); return false; }
    ws.send(JSON.stringify(message)); return true;
  };
  const error = (ws, code, message) => send(ws, { type: 'ERROR', code, message });
  const endpoint = () => {
    const base = publicUrl || new URL(`http://127.0.0.1:${server.address().port}`);
    const url = new URL('/ws', base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  };
  const pinChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newPin() {
    let pin;
    do { pin = Array.from({ length: 6 }, () => pinChars[randomInt(pinChars.length)]).join(''); }
    while (rooms.has(pin));
    return pin;
  }

  wss.on('connection', (ws) => {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {}); // ws also emits close, which releases membership below.
    ws.on('message', (data, isBinary) => {
      const m = isBinary ? null : protocol.parse(data.toString());
      if (!m) { error(ws, 'INVALID_MESSAGE', 'JSON 메시지 형식을 확인하세요.'); return; }
      if (m.type === 'CREATE_ROOM' || m.type === 'JOIN_ROOM') {
        if (ws.room) { error(ws, 'ALREADY_JOINED', '이미 방에 연결되어 있습니다.'); return; }
        if (m.type === 'CREATE_ROOM') {
          if (m.client_type !== 'PC_HOST') { error(ws, 'INVALID_MESSAGE', 'PC_HOST가 필요합니다.'); return; }
          const pin = newPin();
          const room = { pin, host: ws, players: new Map() };
          rooms.set(pin, room); ws.room = room; ws.memberId = 'PC_HOST';
          const qr_data = JSON.stringify({ server_url: endpoint(), pin, transport });
          send(ws, { type: 'ROOM_CREATED', room_pin: pin, qr_data, transport, ice_servers: iceServers });
        } else {
          if (m.client_type !== 'CONTROLLER' || typeof m.pin !== 'string') {
            error(ws, 'INVALID_MESSAGE', 'CONTROLLER와 pin이 필요합니다.'); return;
          }
          const room = rooms.get(m.pin.toUpperCase());
          if (!room) { error(ws, 'INVALID_PIN', '대기방을 찾을 수 없습니다.'); return; }
          const id = ['PLAYER_1', 'PLAYER_2'].find((id) => !room.players.has(id));
          if (!id) { error(ws, 'ROOM_FULL', '이미 두 플레이어가 입장했습니다.'); return; }
          room.players.set(id, ws); ws.room = room; ws.memberId = id;
          send(ws, { type: 'JOIN_SUCCESS', assigned_id: id, room_pin: room.pin, transport, ice_servers: iceServers });
          send(room.host, { type: 'PLAYER_JOINED', assigned_id: id, transport });
        }
        return;
      }
      const room = ws.room;
      if (!room) { error(ws, 'NOT_JOINED', '먼저 방에 입장하세요.'); return; }
      const isHost = ws.memberId === 'PC_HOST';
      if (['WEBRTC_OFFER', 'WEBRTC_ANSWER', 'WEBRTC_ICE_CANDIDATE'].includes(m.type)) {
        if (transport !== 'p2p') { error(ws, 'WRONG_TRANSPORT', '서버 중계 모드입니다.'); return; }
        const target = isHost ? room.players.get(m.target_id) : m.target_id === 'PC_HOST' && room.host;
        if (!target || (m.type === 'WEBRTC_OFFER' && !isHost)
            || (m.type === 'WEBRTC_ANSWER' && isHost)) {
          error(ws, 'INVALID_TARGET', '연결 대상을 확인하세요.'); return;
        }
        if (m.type === 'WEBRTC_ICE_CANDIDATE') {
          const c = m.candidate;
          if (!c || typeof c.candidate !== 'string' || c.candidate.length > 8192
              || !(c.sdpMid === null || typeof c.sdpMid === 'string')
              || !(c.sdpMLineIndex === null || (Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0))) {
            error(ws, 'INVALID_MESSAGE', 'ICE candidate 형식을 확인하세요.'); return;
          }
        } else if (typeof m.sdp !== 'string' || !m.sdp || m.sdp.length > 32768) {
          error(ws, 'INVALID_MESSAGE', 'SDP 문자열을 확인하세요.'); return;
        }
        send(target, { type: m.type, sender_id: ws.memberId, target_id: m.target_id,
          ...(m.type === 'WEBRTC_ICE_CANDIDATE' ? { candidate: m.candidate } : { sdp: m.sdp }) });
        return;
      }
      if (transport !== 'relay') { error(ws, 'WRONG_TRANSPORT', '게임 입력은 DataChannel로 보내세요.'); return; }
      if (m.type === 'GAME_START' && isHost) {
        for (const player of room.players.values()) send(player, { type: 'GAME_START' });
      } else if (!isHost && (protocol.sensor(m) || protocol.calibration(m))) {
        if (m.sender_id !== ws.memberId) { error(ws, 'INVALID_SENDER', '할당된 플레이어 ID를 사용하세요.'); return; }
        send(room.host, m);
      } else { error(ws, 'INVALID_MESSAGE', '이 연결에서 보낼 수 없는 메시지입니다.'); }
    });
    ws.on('close', () => {
      const room = ws.room;
      if (!room) return;
      ws.room = null;
      if (ws.memberId === 'PC_HOST') {
        rooms.delete(room.pin);
        for (const player of room.players.values()) {
          player.room = null;
          send(player, { type: 'ROOM_CLOSED' }); player.close(1000, 'Host left');
        }
        room.players.clear();
      } else if (room.players.get(ws.memberId) === ws) {
        room.players.delete(ws.memberId);
        send(room.host, { type: 'PLAYER_LEFT', assigned_id: ws.memberId });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { server, close };
}

if (require.main === module) {
  try {
    const app = createServer({ transport: process.env.TRANSPORT || 'p2p',
      publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
      stunUrl: process.env.STUN_URL === undefined ? 'stun:stun.l.google.com:19302' : process.env.STUN_URL });
    app.server.on('error', (error) => { console.error(error.message); process.exitCode = 1; app.close(); });
    app.server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => {
      console.log(`GUM transport: ${process.env.TRANSPORT || 'p2p'} — http://127.0.0.1:${app.server.address().port}`);
      if (process.env.PUBLIC_BASE_URL) console.log(`Public: ${new URL(process.env.PUBLIC_BASE_URL).origin}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createServer };
