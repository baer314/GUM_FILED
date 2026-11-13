/* Load protocol.js first. No game or rendering dependencies. */
(function (root) {
  const P = root.GameProtocol;
  let socket = null, room = null, handlers = {}, generation = 0, pendingReject = null, roomTimer = null;
  const peers = new Map();
  function emit(name, ...args) {
    try { handlers[name]?.(...args); } catch (error) { console.error(`GameNetwork ${name}:`, error); }
  }
  const error = (code, message, playerId) => emit('onError', { code, message, playerId });
  function state(peer, value) {
    if (peer.state === value) return;
    peer.state = value; emit('onPlayerState', peer.id, value);
  }
  function dispose(peer) {
    peer.channel?.close(); peer.pc?.close(); peer.pending.length = 0;
  }
  function clearRoomTimer() {
    clearTimeout(roomTimer); roomTimer = null;
  }
  function close() {
    clearRoomTimer();
    generation++;
    pendingReject?.(new Error('연결이 닫혔습니다.')); pendingReject = null;
    const oldSocket = socket; socket = null; room = null;
    const oldPeers = [...peers.values()]; peers.clear();
    for (const peer of oldPeers) { dispose(peer); state(peer, 'disconnected'); }
    if (oldSocket && oldSocket.readyState < 2) oldSocket.close();
  }
  function send(message) {
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('서버 연결이 열려 있지 않습니다.');
    if (socket.bufferedAmount > 262144) throw new Error('서버 송신 대기열이 가득 찼습니다.');
    socket.send(JSON.stringify(message));
  }
  function receive(peer, message) {
    if (peers.get(peer.id) !== peer) return;
    if (!message || message.sender_id !== peer.id) {
      peer.invalid++; error('INVALID_SENDER', '입력의 플레이어 ID가 일치하지 않습니다.', peer.id); return;
    }
    if (P.sensor(message)) {
      if (message.seq !== undefined) {
        if (message.seq <= peer.lastSeq) { peer.invalid++; return; }
        if (peer.missing !== null) peer.missing += message.seq - peer.lastSeq - 1;
        peer.lastSeq = message.seq;
      } else {
        // Without a sender sequence we can count arrivals, but cannot infer packet loss.
        peer.missing = null;
      }
      peer.count++;
      peer.lastReceivedAt = performance.now(); peer.latest = message;
      emit('onSensorData', peer.id, message.timestamp, message.payload);
    } else if (P.calibration(message)) emit('onCalibrateConfirm', peer.id);
    else { peer.invalid++; error('INVALID_INPUT', '센서/영점 확인 형식을 확인하세요.', peer.id); }
  }
  async function addPlayer(id, token) {
    if (!P.playerId(id) || peers.has(id)) throw new Error('중복 또는 잘못된 플레이어 ID');
    const peer = { id, state: null, pc: null, channel: null, pending: [],
      lastSeq: -1, count: 0, missing: 0, invalid: 0, latest: null, lastReceivedAt: null };
    peers.set(id, peer); state(peer, 'joined');
    if (room.transport === 'relay') { state(peer, 'ready'); return; }
    const active = () => token === generation && peers.get(id) === peer;
    try {
      const pc = peer.pc = new RTCPeerConnection({ iceServers: room.ice_servers });
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && active()) send({ type: 'WEBRTC_ICE_CANDIDATE', target_id: id, candidate: candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (!active()) return;
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          state(peer, 'disconnected');
          if (pc.connectionState === 'failed') error('P2P_FAILED', '직접 연결 실패. 컨트롤러를 나갔다 다시 입장시키세요.', id);
        } else if (pc.connectionState === 'connected' && peer.channel?.readyState === 'open') state(peer, 'ready');
      };
      const channel = peer.channel = pc.createDataChannel('game');
      channel.onopen = () => { if (active()) state(peer, 'ready'); };
      channel.onclose = () => { if (active()) state(peer, 'disconnected'); };
      channel.onerror = () => { if (active()) error('CHANNEL_ERROR', 'DataChannel 오류', id); };
      channel.onmessage = ({ data }) => { if (active()) receive(peer, P.parse(data)); };
      await pc.setLocalDescription(await pc.createOffer());
      if (active()) send({ type: 'WEBRTC_OFFER', target_id: id, sdp: pc.localDescription.sdp });
    } catch (cause) {
      if (active()) { state(peer, 'disconnected'); error('P2P_FAILED', cause.message, id); }
    }
  }
  function createRoom(serverUrl, callbacks = {}) {
    close(); handlers = callbacks;
    return new Promise((resolve, reject) => {
      try {
        if (!P) throw new Error('protocol.js를 먼저 불러오세요.');
        const url = new URL(serverUrl);
        if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('ws/wss 서버 주소가 필요합니다.');
        const ws = socket = new WebSocket(url);
        const token = generation;
        pendingReject = reject;
        const active = () => token === generation && socket === ws;
        roomTimer = setTimeout(() => {
          if (!active()) return;
          const cause = new Error('서버의 방 생성 응답 시간이 초과되었습니다. 주소와 실행 상태를 확인하세요.');
          pendingReject = null; reject(cause); close(); error('SERVER_TIMEOUT', cause.message);
        }, 15000);
        ws.onopen = () => { if (active()) send({ type: 'CREATE_ROOM', client_type: 'PC_HOST' }); };
        ws.onerror = () => {
          if (!active()) return;
          clearRoomTimer();
          pendingReject?.(new Error('서버에 연결할 수 없습니다.')); pendingReject = null;
          error('SERVER_ERROR', '서버 주소와 실행 상태를 확인하세요.');
        };
        ws.onclose = () => {
          if (!active()) return;
          error('SERVER_CLOSED', '서버 연결이 끊어졌습니다. 방을 다시 생성하세요.');
          close(); emit('onRoomClosed');
        };
        ws.onmessage = async ({ data }) => {
          if (!active()) return;
          const m = P.parse(data);
          if (!m) { error('INVALID_MESSAGE', '서버 메시지 형식 오류'); return; }
          try {
            if (m.type === 'ROOM_CREATED') {
              clearRoomTimer();
              room = m; pendingReject = null; emit('onRoomCreated', m); resolve(m);
            } else if (m.type === 'PLAYER_JOINED') await addPlayer(m.assigned_id, token);
            else if (m.type === 'PLAYER_LEFT') {
              const peer = peers.get(m.assigned_id);
              if (peer) { state(peer, 'disconnected'); peers.delete(peer.id); dispose(peer); }
            } else if (m.type === 'ERROR') {
              error(m.code, m.message);
              if (!room) { clearRoomTimer(); pendingReject?.(new Error(m.message)); pendingReject = null; }
            } else if (m.type === 'SENSOR' || m.type === 'CALIBRATE_CONFIRM') {
              const peer = peers.get(m.sender_id);
              if (room?.transport !== 'relay') throw new Error('직접 연결 모드에 서버 중계 입력이 도착했습니다.');
              if (peer) receive(peer, m);
            } else if (m.type === 'WEBRTC_ANSWER' || m.type === 'WEBRTC_ICE_CANDIDATE') {
              const peer = peers.get(m.sender_id);
              if (!peer?.pc) return;
              if (m.type === 'WEBRTC_ANSWER') {
                await peer.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
                while (peer.pending.length && active() && peers.get(peer.id) === peer) await peer.pc.addIceCandidate(peer.pending.shift());
              } else if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(m.candidate);
              else {
                if (peer.pending.length >= 128) throw new Error('ICE 후보가 너무 많습니다.');
                peer.pending.push(m.candidate);
              }
            }
          } catch (cause) { if (active()) error('CONNECTION_ERROR', cause.message, m.sender_id || m.assigned_id); }
        };
      } catch (cause) { pendingReject = null; reject(cause); }
    });
  }
  function sendGameStart() {
    const ready = [...peers.values()].filter((peer) => peer.state === 'ready');
    if (!ready.length) throw new Error('준비된 컨트롤러가 없습니다.');
    if (room.transport === 'relay') send({ type: 'GAME_START' });
    else {
      for (const peer of ready) {
        if (peer.channel.readyState !== 'open' || peer.channel.bufferedAmount > 262144) throw new Error(`${peer.id}의 송신 상태를 확인하세요.`);
      }
      for (const peer of ready) peer.channel.send(JSON.stringify({ type: 'GAME_START' }));
    }
    return ready.length;
  }
  function getStats() {
    return [...peers.values()].map(({ id, state, count, missing, invalid, lastSeq, latest, lastReceivedAt }) =>
      ({ id, state, count, missing, invalid, lastSeq, latest, lastReceivedAt }));
  }
  async function getConnectionStats() {
    const result = [];
    const token = generation;
    for (const peer of [...peers.values()]) {
      const active = () => token === generation && peers.get(peer.id) === peer;
      if (!active()) continue;
      if (!peer.pc) { result.push({ id: peer.id, transport: 'relay' }); continue; }
      let stats;
      try { stats = await peer.pc.getStats(); }
      catch (cause) {
        if (active()) result.push({ id: peer.id, transport: 'p2p', error: cause.message });
        continue;
      }
      if (!active()) continue;
      for (const entry of stats.values()) if (entry.type === 'transport' && entry.selectedCandidatePairId) {
        const pair = stats.get(entry.selectedCandidatePairId);
        if (!pair) continue;
        result.push({ id: peer.id, transport: 'p2p', local: stats.get(pair.localCandidateId)?.candidateType,
          remote: stats.get(pair.remoteCandidateId)?.candidateType, roundTripTime: pair.currentRoundTripTime });
      }
    }
    return result;
  }
  root.GameNetwork = { createRoom, sendGameStart, close, getStats, getConnectionStats };
})(globalThis);
