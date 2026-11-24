'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);

  function renderQrSvg(text) {
    const bytes = [];
    for (const ch of String(text || '')) {
      const code = ch.codePointAt(0);
      if (code < 0x80) bytes.push(code);
      else for (const part of encodeURIComponent(ch).split('%').slice(1)) bytes.push(parseInt(part, 16));
    }
    const caps = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
    const ecLen = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
    const blocks = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
    const align = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    const ver = caps.findIndex((c, v) => v > 0 && bytes.length <= c);
    if (ver < 1) return '<p class="qr-placeholder">QR 데이터 길이 초과</p>';
    const totalData = caps[ver] + 2 + (ver > 9 ? 1 : 0);
    const bits = [];
    const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    pushBits(4, 4); pushBits(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);
    pushBits(0, Math.min(4, totalData * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0; data.length < totalData; pad++) data.push(pad % 2 ? 0x11 : 0xec);

    const exp = new Uint8Array(512), log = new Uint8Array(256);
    for (let i = 0, x = 1; i < 255; i++) { exp[i] = exp[i + 255] = x; log[x] = i; x = (x << 1) ^ (x & 128 ? 0x11d : 0); }
    const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
    const ecCount = ecLen[ver], numBlocks = blocks[ver];
    let gen = [1];
    for (let i = 0; i < ecCount; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], exp[i]); }
      gen = next;
    }
    const dataBlocks = [], ecBlocks = [];
    const shortLen = Math.floor(totalData / numBlocks), extra = totalData % numBlocks;
    for (let b = 0, offset = 0; b < numBlocks; b++) {
      const len = shortLen + (b >= numBlocks - extra ? 1 : 0);
      const block = data.slice(offset, offset + len); offset += len;
      dataBlocks.push(block);
      const msg = [...block, ...new Array(ecCount).fill(0)];
      for (let i = 0; i < block.length; i++) {
        const coef = msg[i];
        if (coef) for (let j = 0; j < gen.length; j++) msg[i + j] ^= mul(gen[j], coef);
      }
      ecBlocks.push(msg.slice(block.length));
    }
    const codewords = [];
    for (let i = 0; i <= shortLen; i++) for (let b = 0; b < numBlocks; b++) if (i < dataBlocks[b].length) codewords.push(dataBlocks[b][i]);
    for (let i = 0; i < ecCount; i++) for (let b = 0; b < numBlocks; b++) codewords.push(ecBlocks[b][i]);

    const size = ver * 4 + 17;
    const grid = Array.from({ length: size }, () => new Uint8Array(size));
    const used = Array.from({ length: size }, () => new Uint8Array(size));
    const setModule = (r, c, v) => { grid[r][c] = v ? 1 : 0; used[r][c] = 1; };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        if (r0 + r < 0 || r0 + r >= size || c0 + c < 0 || c0 + c >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setModule(r0 + r, c0 + c, on);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { setModule(6, i, i % 2 === 0); setModule(i, 6, i % 2 === 0); }
    for (const r0 of align[ver]) for (const c0 of align[ver]) {
      if (used[r0][c0]) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++)
        setModule(r0 + r, c0 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
    for (let i = 0; i < 9; i++) {
      if (i !== 6) { used[8][i] = used[i][8] = 1; }
      if (i < 8) { used[8][size - 1 - i] = used[size - 1 - i][8] = 1; }
    }
    setModule(size - 8, 8, 1);
    const verInfo = [0, 0, 0, 0, 0, 0, 0, 0x07c94, 0x085bc, 0x09a99, 0x0a4d3];
    if (ver >= 7 && verInfo[ver]) {
      for (let i = 0; i < 18; i++) {
        const bit = (verInfo[ver] >> i) & 1;
        const a = Math.floor(i / 3), b = size - 11 + (i % 3);
        setModule(a, b, bit);
        setModule(b, a, bit);
      }
    }

    let bitIdx = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (used[r][c]) continue;
          const bit = bitIdx < codewords.length * 8 ? (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
          bitIdx++;
          grid[r][c] = bit ^ ((r + c) % 2 === 0 ? 1 : 0);
        }
      }
      upward = !upward;
    }
    // ISO/IEC 18004 형식 정보(EC Level L, Mask 0 -> 0x77c4) 2개 영역 정확한 배치
    const fmt = 0x77c4;
    for (let i = 0; i < 15; i++) {
      const bit = (fmt >> i) & 1;
      if (i < 6) grid[i][8] = bit;
      else if (i < 8) grid[i + 1][8] = bit;
      else if (i === 8) grid[8][7] = bit;
      else grid[8][14 - i] = bit;
      if (i < 8) grid[8][size - 1 - i] = bit;
      else grid[size - 15 + i][8] = bit;
    }
    let path = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) path += `M${c + 4},${r + 4}h1v1h-1z`;
    return `<svg viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges" role="img" aria-label="방 입장 QR 코드"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#141923"/></svg>`;
  }

  function createPlayerSlot(slotId, shortLabel, playerData) {
    const card = document.createElement('section');
    card.className = 'player-slot';
    card.dataset.player = slotId;

    const rawState = playerData && playerData.state ? String(playerData.state).trim() : '';
    const isJoined = Boolean(
      playerData
      && rawState
      && !/대기|wait|empty|disconnect|미연결|오프라인/i.test(rawState)
    );
    if (isJoined) card.classList.add('is-joined');

    const heading = document.createElement('h2');
    heading.className = 'player-badge';
    heading.textContent = shortLabel;

    const status = document.createElement('p');
    status.className = 'player-state';
    status.textContent = rawState || '입장 대기';

    card.append(heading, status);
    return card;
  }

  function initTitle(defaultTitle = 'GUM FIELD') {
    if ($('title') && !$('title').textContent) $('title').textContent = defaultTitle;
    if ($('players') && $('players').children.length === 0) {
      renderPlayers([], 0, false);
    }
  }

  function setServerUrl(value) {
    if ($('server-url')) $('server-url').value = value;
  }

  function getServerUrl() {
    return $('server-url') ? $('server-url').value : '';
  }

  function renderLog(events) {
    if ($('events')) $('events').textContent = events.slice(-12).join('\n');
  }

  function renderStatus(text) {
    if ($('room-status')) $('room-status').textContent = text;
  }

  function setCreateDisabled(disabled) {
    if ($('create')) $('create').disabled = disabled;
  }

  function setStartDisabled(disabled) {
    if ($('start')) $('start').disabled = disabled;
  }

  function resetView() {
    if ($('pin')) $('pin').textContent = '—';
    if ($('qr-data')) $('qr-data').value = '';
    if ($('controller-link')) $('controller-link').hidden = true;
    if ($('qr-screen')) $('qr-screen').innerHTML = '<p class="qr-placeholder">QR 생성 대기 중</p>';
    renderPlayers([], 0, false);
  }

  function renderRoomCreated(room, controllerHref) {
    if ($('pin')) $('pin').textContent = room.room_pin;
    if ($('qr-data')) $('qr-data').value = room.qr_data;
    if ($('qr-screen')) $('qr-screen').innerHTML = renderQrSvg(room.qr_data);
    if ($('room-status')) $('room-status').textContent = `입장 대기 · ${room.transport === 'p2p' ? '직접 연결' : '서버 중계'}`;
    if ($('controller-link')) {
      $('controller-link').href = controllerHref;
      $('controller-link').hidden = false;
    }
  }

  function renderPlayers(players = [], connectedCount = 0, canStart = false) {
    if ($('participant-count')) $('participant-count').textContent = `참여인원: ${connectedCount} / 2명`;
    if ($('start')) $('start').disabled = !canStart;

    const container = $('players');
    if (!container) return;

    const list = Array.isArray(players) ? players : [];
    const byId = new Map();
    const extras = [];

    for (const s of list) {
      if (!s) continue;
      if (s.id === 'PLAYER_1' || s.id === 'PLAYER_2') byId.set(s.id, s);
      else extras.push(s);
    }

    const p1 = byId.get('PLAYER_1') || extras.shift() || null;
    const p2 = byId.get('PLAYER_2') || extras.shift() || null;

    container.replaceChildren(
      createPlayerSlot(p1?.id || 'PLAYER_1', 'P1', p1),
      createPlayerSlot(p2?.id || 'PLAYER_2', 'P2', p2)
    );
  }

  function downloadJson(filename, data) {
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = objectUrl; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function bindEvents({ onCreateRoom, onStartGame, onCloseRoom, onExport }) {
    if ($('room-form')) $('room-form').onsubmit = onCreateRoom;
    if ($('start')) $('start').onclick = onStartGame;
    if ($('close')) $('close').onclick = onCloseRoom;
    if ($('export')) $('export').onclick = onExport;
  }

  root.GameFront = {
    initTitle,
    setServerUrl,
    getServerUrl,
    renderQrSvg,
    renderLog,
    renderStatus,
    setCreateDisabled,
    setStartDisabled,
    resetView,
    renderRoomCreated,
    renderPlayers,
    downloadJson,
    bindEvents,
  };
})(globalThis);