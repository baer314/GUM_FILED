'use strict';
(function (root) {
  const SOUND_FILES = {
    ready: ['/Sound/ready.mp3'],
    reset: ['/Sound/reset1.mp3', '/Sound/reset2.mp3', '/Sound/reset3.mp3'],
    hum: ['/Sound/hum.mp3'],
    swing: [
      '/Sound/swing1.mp3',
      '/Sound/swing2.mp3',
      '/Sound/swing3.mp3',
      '/Sound/swing4.mp3',
      '/Sound/swing5.mp3',
      '/Sound/swing6.mp3',
      '/Sound/swing7.mp3',
      '/Sound/swing8.mp3',
      '/Sound/swing9.mp3',
      '/Sound/swing10.mp3',
    ],
    lose: ['/Sound/lose.mp3'],
    hit: [
      '/Sound/hit1.mp3',
      '/Sound/hit2.mp3',
      '/Sound/hit3.mp3',
      '/Sound/hit4.mp3',
      '/Sound/hit5.mp3',
    ],
  };

  const BGM_FILES = {
    match: '/Sound/matchBgm.mp3',
    main: '/Sound/mainBgm.mp3',
    win: '/Sound/win.mp3',
  };
  const BGM_CROSSFADE_SEC = 1.2;

  // 개발자 패널 개별 볼륨 (0~300%)
  const categoryVolumes = {
    ready: 100,
    reset: 100,
    hum: 100,
    swing: 100,
    lose: 100,
    hit: 100,
    bgm: 100,
  };

  // 일시정지 창 마스터 볼륨 (0~100%)
  let masterSfxVolume = 100;
  let masterBgmVolume = 100;

  let audioCtx = null;
  let masterGainNode = null;
  let masterBgmGainNode = null;
  let bgmCategoryGainNode = null;
  const categoryGainNodes = {};
  const decodedBuffers = new Map();
  const loadingPromises = new Map();

  let humSource = null;
  let humWanted = false;
  let readySource = null;
  let readyDurationSec = 3.474;
  let loseDurationSec = 2.568;

  // BGM 상태 관리 ('NONE' | 'MATCH' | 'MAIN' | 'WIN' | 'STOP')
  let desiredBgmMode = 'NONE';
  let desiredBgmRate = 1.0;
  let matchBgmSource = null;
  let matchBgmStartCtxTime = 0;
  let matchBgmStoppingAt = 0;
  let mainBgmSource = null;
  let mainBgmFadeGain = null;
  let mainBgmScheduled = false;
  let winBgmSource = null;
  let winBgmFadeGain = null;

  function ensureAudioContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume?.().catch?.(() => {});
      }
      return audioCtx;
    }
    const AudioCtxCtor = root.AudioContext || root.webkitAudioContext;
    if (typeof AudioCtxCtor !== 'function') return null;

    audioCtx = new AudioCtxCtor();
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = masterSfxVolume / 100;
    masterGainNode.connect(audioCtx.destination);

    masterBgmGainNode = audioCtx.createGain();
    masterBgmGainNode.gain.value = masterBgmVolume / 100;
    masterBgmGainNode.connect(audioCtx.destination);

    bgmCategoryGainNode = audioCtx.createGain();
    bgmCategoryGainNode.gain.value = categoryVolumes.bgm / 100;
    bgmCategoryGainNode.connect(masterBgmGainNode);

    for (const cat of Object.keys(categoryVolumes)) {
      if (cat === 'bgm') continue;
      const g = audioCtx.createGain();
      g.gain.value = categoryVolumes[cat] / 100;
      g.connect(masterGainNode);
      categoryGainNodes[cat] = g;
    }
    return audioCtx;
  }

  function loadBuffer(url) {
    if (decodedBuffers.has(url)) return Promise.resolve(decodedBuffers.get(url));
    if (loadingPromises.has(url)) return loadingPromises.get(url);
    if (typeof root.fetch !== 'function') return Promise.resolve(null);

    const ctx = ensureAudioContext();
    if (!ctx) return Promise.resolve(null);

    const p = root.fetch(url)
      .then((res) => (res && res.ok ? res.arrayBuffer() : null))
      .then((arr) => (arr ? ctx.decodeAudioData(arr.slice(0)) : null))
      .then((buf) => {
        if (buf) {
          decodedBuffers.set(url, buf);
          if (url === '/Sound/ready.mp3' && Number.isFinite(buf.duration) && buf.duration >= 0.5) {
            readyDurationSec = Number(buf.duration.toFixed(3));
            root.InGameBack?.setIntroDuration?.(readyDurationSec);
          }
          if (url === '/Sound/lose.mp3' && Number.isFinite(buf.duration) && buf.duration > 0.2) {
            loseDurationSec = Number(buf.duration.toFixed(3));
            // lose 음성 출력 완료 후 2초 여유 시간을 포함해 라운드 종료 애니메이션 길이 동기화
            root.InGameBack?.setResultDuration?.(loseDurationSec + 2.0);
          }
          if (url === '/Sound/hum.mp3' && humWanted && !humSource) {
            startHumSource(buf);
          }
          if (url === BGM_FILES.match || url === BGM_FILES.main || url === BGM_FILES.win) {
            syncBgmPlayback();
          }
        }
        return buf;
      })
      .catch(() => null)
      .finally(() => {
        loadingPromises.delete(url);
      });

    loadingPromises.set(url, p);
    return p;
  }

  function preloadAll() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    loadBuffer(BGM_FILES.match);
    loadBuffer(BGM_FILES.main);
    loadBuffer(BGM_FILES.win);
    for (const urls of Object.values(SOUND_FILES)) {
      for (const url of urls) {
        loadBuffer(url);
      }
    }
  }

  function stopMatchBgmNow() {
    if (!matchBgmSource) return;
    try {
      matchBgmSource.onended = null;
      matchBgmSource.stop();
      matchBgmSource.disconnect();
    } catch {}
    matchBgmSource = null;
    matchBgmStartCtxTime = 0;
    matchBgmStoppingAt = 0;
  }

  function stopMainBgmNow() {
    if (!mainBgmSource) return;
    try {
      mainBgmSource.onended = null;
      mainBgmSource.stop();
      mainBgmSource.disconnect();
      mainBgmFadeGain?.disconnect();
    } catch {}
    mainBgmSource = null;
    mainBgmFadeGain = null;
    mainBgmScheduled = false;
  }

  function fadeOutMainBgm(fadeSec = BGM_CROSSFADE_SEC) {
    if (!mainBgmSource || !audioCtx) return;
    const src = mainBgmSource;
    const fadeNode = mainBgmFadeGain;
    mainBgmSource = null;
    mainBgmFadeGain = null;
    mainBgmScheduled = false;

    const now = audioCtx.currentTime;
    const dur = Math.max(0.05, Number(fadeSec) || BGM_CROSSFADE_SEC);
    if (fadeNode) {
      try {
        fadeNode.gain.cancelScheduledValues(now);
        fadeNode.gain.setValueAtTime(Math.max(0.0001, fadeNode.gain.value), now);
        fadeNode.gain.linearRampToValueAtTime(0.0001, now + dur);
      } catch {}
    }
    try {
      src.onended = () => {
        try {
          src.disconnect();
          fadeNode?.disconnect();
        } catch {}
      };
      src.stop(now + dur + 0.05);
    } catch {
      try {
        src.disconnect();
        fadeNode?.disconnect();
      } catch {}
    }
  }

  function stopWinBgmNow() {
    if (!winBgmSource) return;
    try {
      winBgmSource.onended = null;
      winBgmSource.stop();
      winBgmSource.disconnect();
      winBgmFadeGain?.disconnect();
    } catch {}
    winBgmSource = null;
    winBgmFadeGain = null;
  }

  function fadeOutWinBgm(fadeSec = 0.8) {
    if (!winBgmSource || !audioCtx) return;
    const src = winBgmSource;
    const fadeNode = winBgmFadeGain;
    winBgmSource = null;
    winBgmFadeGain = null;

    const now = audioCtx.currentTime;
    const dur = Math.max(0.05, Number(fadeSec) || 0.8);
    if (fadeNode) {
      try {
        fadeNode.gain.cancelScheduledValues(now);
        fadeNode.gain.setValueAtTime(Math.max(0.0001, fadeNode.gain.value), now);
        fadeNode.gain.linearRampToValueAtTime(0.0001, now + dur);
      } catch {}
    }
    try {
      src.onended = () => {
        try {
          src.disconnect();
          fadeNode?.disconnect();
        } catch {}
      };
      src.stop(now + dur + 0.05);
    } catch {
      try {
        src.disconnect();
        fadeNode?.disconnect();
      } catch {}
    }
  }

  function startMatchBgmLoop() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    stopMainBgmNow();
    fadeOutWinBgm(0.6);
    if (matchBgmSource && matchBgmStoppingAt === 0) return;
    if (matchBgmSource && matchBgmStoppingAt > 0) {
      stopMatchBgmNow();
    }
    const buf = decodedBuffers.get(BGM_FILES.match);
    if (!buf) {
      loadBuffer(BGM_FILES.match);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1.0;
    src.connect(bgmCategoryGainNode || masterBgmGainNode || ctx.destination);
    const startAt = ctx.currentTime;
    src.start(startAt);
    matchBgmSource = src;
    matchBgmStartCtxTime = startAt;
    matchBgmStoppingAt = 0;
  }

  function startMainBgmLoop(startAtSec = null, fadeInSec = 0) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (mainBgmSource) {
      applyBgmPlaybackRate(desiredBgmRate);
      return;
    }
    const buf = decodedBuffers.get(BGM_FILES.main);
    if (!buf) {
      loadBuffer(BGM_FILES.main);
      return;
    }
    const when = Number.isFinite(startAtSec) ? Math.max(ctx.currentTime, startAtSec) : ctx.currentTime;
    const fadeNode = ctx.createGain();
    if (fadeInSec > 0) {
      fadeNode.gain.setValueAtTime(0.0001, when);
      fadeNode.gain.linearRampToValueAtTime(1.0, when + fadeInSec);
    } else {
      fadeNode.gain.setValueAtTime(1.0, when);
    }
    fadeNode.connect(bgmCategoryGainNode || masterBgmGainNode || ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = desiredBgmRate;
    src.connect(fadeNode);
    src.start(when);
    mainBgmSource = src;
    mainBgmFadeGain = fadeNode;
    mainBgmScheduled = true;
  }

  function startWinBgmLoop(fadeInSec = BGM_CROSSFADE_SEC) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (winBgmSource) return;
    const buf = decodedBuffers.get(BGM_FILES.win);
    if (!buf) {
      loadBuffer(BGM_FILES.win);
      return;
    }
    const now = ctx.currentTime;
    const fadeNode = ctx.createGain();
    if (fadeInSec > 0) {
      fadeNode.gain.setValueAtTime(0.0001, now);
      fadeNode.gain.linearRampToValueAtTime(1.0, now + fadeInSec);
    } else {
      fadeNode.gain.setValueAtTime(1.0, now);
    }
    fadeNode.connect(bgmCategoryGainNode || masterBgmGainNode || ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1.0;
    src.connect(fadeNode);
    src.start(now);
    winBgmSource = src;
    winBgmFadeGain = fadeNode;
  }

  function applyBgmPlaybackRate(rate) {
    const nextRate = Math.min(2.0, Math.max(0.5, Number(rate) || 1.0));
    desiredBgmRate = nextRate;
    if (mainBgmSource && audioCtx) {
      try {
        mainBgmSource.playbackRate.setTargetAtTime(nextRate, audioCtx.currentTime, 0.06);
      } catch {
        mainBgmSource.playbackRate.value = nextRate;
      }
    }
  }

  function syncBgmPlayback() {
    if (!audioCtx) return;
    if (desiredBgmMode === 'STOP' || desiredBgmMode === 'NONE') {
      stopMatchBgmNow();
      stopMainBgmNow();
      stopWinBgmNow();
      return;
    }
    if (desiredBgmMode === 'MATCH') {
      applyBgmPlaybackRate(1.0);
      startMatchBgmLoop();
      return;
    }
    if (desiredBgmMode === 'WIN') {
      stopMatchBgmNow();
      fadeOutMainBgm(BGM_CROSSFADE_SEC);
      startWinBgmLoop(BGM_CROSSFADE_SEC);
      return;
    }
    if (desiredBgmMode === 'MAIN') {
      const hadWin = Boolean(winBgmSource);
      if (hadWin) {
        fadeOutWinBgm(BGM_CROSSFADE_SEC);
      }
      applyBgmPlaybackRate(desiredBgmRate);
      if (mainBgmSource) return;

      const mainBuf = decodedBuffers.get(BGM_FILES.main);
      if (!mainBuf) {
        loadBuffer(BGM_FILES.main);
        return;
      }

      // 1라운드 matchBgm이 재생 중이면 현재 루프의 남은 구간을 끝까지 재생한 직후 mainBgm으로 자연 전환
      if (matchBgmSource && matchBgmSource.buffer && matchBgmSource.buffer.duration > 0.05) {
        const dur = matchBgmSource.buffer.duration;
        const now = audioCtx.currentTime;
        const elapsed = Math.max(0, now - matchBgmStartCtxTime);
        const rem = dur - (elapsed % dur);
        const switchAt = rem < 0.03 ? now : now + rem;

        if (matchBgmStoppingAt === 0) {
          matchBgmStoppingAt = switchAt;
          try {
            matchBgmSource.loop = false;
            matchBgmSource.stop(switchAt);
            const finishingSrc = matchBgmSource;
            finishingSrc.onended = () => {
              if (matchBgmSource === finishingSrc) {
                matchBgmSource = null;
                matchBgmStartCtxTime = 0;
                matchBgmStoppingAt = 0;
              }
            };
          } catch {
            stopMatchBgmNow();
          }
        }
        startMainBgmLoop(matchBgmStoppingAt || switchAt, 0);
      } else {
        stopMatchBgmNow();
        startMainBgmLoop(audioCtx.currentTime, hadWin ? BGM_CROSSFADE_SEC : 0);
      }
    }
  }

  function setBgmState(mode, playbackRate = 1.0) {
    const nextMode = mode || 'NONE';
    const nextRate = Number.isFinite(Number(playbackRate)) ? Number(playbackRate) : 1.0;
    const modeChanged = desiredBgmMode !== nextMode;
    const rateChanged = Math.abs(desiredBgmRate - nextRate) > 0.005;
    desiredBgmMode = nextMode;
    desiredBgmRate = nextRate;

    const ctx = ensureAudioContext();
    if (!ctx) return;
    const nothingPlaying = !mainBgmSource && !matchBgmSource && !winBgmSource;
    if (modeChanged || (nothingPlaying && (nextMode === 'MATCH' || nextMode === 'MAIN' || nextMode === 'WIN'))) {
      syncBgmPlayback();
    } else if (rateChanged) {
      applyBgmPlaybackRate(nextRate);
    }
  }

  function startHumSource(buf) {
    const ctx = ensureAudioContext();
    if (!ctx || !buf || humSource || !humWanted) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(categoryGainNodes.hum || masterGainNode || ctx.destination);
    src.start(0);
    humSource = src;
  }

  function stopHumSource() {
    if (!humSource) return;
    try {
      humSource.stop();
      humSource.disconnect();
    } catch {}
    humSource = null;
  }

  function setHumPlaying(shouldPlay) {
    const next = Boolean(shouldPlay);
    humWanted = next;
    if (!next) {
      stopHumSource();
      return;
    }
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const url = SOUND_FILES.hum[0];
    const cached = decodedBuffers.get(url);
    if (cached) {
      startHumSource(cached);
    } else {
      loadBuffer(url);
    }
  }

  function stopReady() {
    if (!readySource) return;
    try {
      readySource.stop();
      readySource.disconnect();
    } catch {}
    readySource = null;
  }

  function playReady() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    stopReady();
    const url = SOUND_FILES.ready[0];
    const startBuf = (buf) => {
      if (!buf || !audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume?.().catch?.(() => {});
      }
      stopReady();
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(categoryGainNodes.ready || masterGainNode || audioCtx.destination);
      src.onended = () => {
        if (readySource === src) {
          readySource = null;
        }
      };
      src.start(0);
      readySource = src;
    };
    const cached = decodedBuffers.get(url);
    if (cached) {
      startBuf(cached);
    } else {
      loadBuffer(url).then(startBuf);
    }
  }

  function playRandom(category) {
    const list = SOUND_FILES[category];
    if (!Array.isArray(list) || !list.length) return;
    const url = list[Math.floor(Math.random() * list.length)];
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const playBuf = (buf) => {
      if (!buf || !audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume?.().catch?.(() => {});
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(categoryGainNodes[category] || masterGainNode || audioCtx.destination);
      src.start(0);
    };

    const cached = decodedBuffers.get(url);
    if (cached) {
      playBuf(cached);
    } else {
      loadBuffer(url).then(playBuf);
    }
  }

  function setCategoryVolume(category, percent) {
    if (!Object.prototype.hasOwnProperty.call(categoryVolumes, category)) return 100;
    const num = Number(percent);
    if (Number.isFinite(num)) {
      const clamped = Math.min(300, Math.max(0, num));
      categoryVolumes[category] = clamped;
      if (category === 'bgm') {
        if (bgmCategoryGainNode) {
          bgmCategoryGainNode.gain.value = clamped / 100;
        }
      } else if (categoryGainNodes[category]) {
        categoryGainNodes[category].gain.value = clamped / 100;
      }
    }
    return categoryVolumes[category];
  }

  function getCategoryVolume(category) {
    return categoryVolumes[category] ?? 100;
  }

  function getAllCategoryVolumes() {
    return { ...categoryVolumes };
  }

  function setMasterSfxVolume(percent) {
    const num = Number(percent);
    if (Number.isFinite(num)) {
      masterSfxVolume = Math.min(100, Math.max(0, num));
      if (masterGainNode) {
        masterGainNode.gain.value = masterSfxVolume / 100;
      }
    }
    return masterSfxVolume;
  }

  function getMasterSfxVolume() {
    return masterSfxVolume;
  }

  function setMasterBgmVolume(percent) {
    const num = Number(percent);
    if (Number.isFinite(num)) {
      masterBgmVolume = Math.min(100, Math.max(0, num));
      if (masterBgmGainNode) {
        masterBgmGainNode.gain.value = masterBgmVolume / 100;
      }
    }
    return masterBgmVolume;
  }

  function getMasterBgmVolume() {
    return masterBgmVolume;
  }

  function stopAll() {
    humWanted = false;
    stopHumSource();
    stopReady();
  }

  // 사용자 첫 입력 시 AudioContext 활성화 및 효과음/BGM 미리 로드
  if (typeof root.addEventListener === 'function') {
    const unlock = () => {
      ensureAudioContext();
      preloadAll();
      syncBgmPlayback();
    };
    root.addEventListener('pointerdown', unlock, { once: true });
    root.addEventListener('keydown', unlock, { once: true });
  }

  root.SoundManager = {
    preloadAll,
    playReady,
    stopReady,
    playRandom,
    setHumPlaying,
    setBgmState,
    setCategoryVolume,
    getCategoryVolume,
    getAllCategoryVolumes,
    setMasterSfxVolume,
    getMasterSfxVolume,
    setMasterBgmVolume,
    getMasterBgmVolume,
    getReadyDurationSec: () => readyDurationSec,
    getLoseDurationSec: () => loseDurationSec,
    stopAll,
  };
})(globalThis);
