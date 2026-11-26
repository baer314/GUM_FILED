'use strict';
(function (root) {
  const SOUND_FILES = {
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

  // 개발자 패널 개별 볼륨 (0~300%)
  const categoryVolumes = {
    reset: 100,
    hum: 100,
    swing: 100,
    lose: 100,
    hit: 100,
  };

  // 일시정지 창 효과음 마스터 볼륨 (0~100%)
  let masterSfxVolume = 100;

  let audioCtx = null;
  let masterGainNode = null;
  const categoryGainNodes = {};
  const decodedBuffers = new Map();
  const loadingPromises = new Map();

  let humSource = null;
  let humWanted = false;
  let loseDurationSec = 2.568;

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

    for (const cat of Object.keys(categoryVolumes)) {
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
          if (url === '/Sound/lose.mp3' && Number.isFinite(buf.duration) && buf.duration > 0.2) {
            loseDurationSec = Number(buf.duration.toFixed(3));
            // lose 음성 출력 완료 후 2초 여유 시간을 포함해 라운드 종료 애니메이션 길이 동기화
            root.InGameBack?.setResultDuration?.(loseDurationSec + 2.0);
          }
          if (url === '/Sound/hum.mp3' && humWanted && !humSource) {
            startHumSource(buf);
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
    for (const urls of Object.values(SOUND_FILES)) {
      for (const url of urls) {
        loadBuffer(url);
      }
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
      if (categoryGainNodes[category]) {
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

  function stopAll() {
    humWanted = false;
    stopHumSource();
  }

  // 사용자 첫 입력 시 AudioContext 활성화 및 효과음 미리 로드
  if (typeof root.addEventListener === 'function') {
    const unlock = () => {
      ensureAudioContext();
      preloadAll();
    };
    root.addEventListener('pointerdown', unlock, { once: true });
    root.addEventListener('keydown', unlock, { once: true });
  }

  root.SoundManager = {
    preloadAll,
    playRandom,
    setHumPlaying,
    setCategoryVolume,
    getCategoryVolume,
    getAllCategoryVolumes,
    setMasterSfxVolume,
    getMasterSfxVolume,
    getLoseDurationSec: () => loseDurationSec,
    stopAll,
  };
})(globalThis);
