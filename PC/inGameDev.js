'use strict';
(function (root) {
  const $ = (id) => document.getElementById(id);
  let mounted = false;
  let keyBound = false;

  const DEV_INPUT_IDS = [
    'dur-attack',
    'attack-cooldown',
    'attack-rotation-damping',
    'sensor-tilt-smoothing',
    'dur-attack-hit',
    'dur-attack-fail',
    'dur-parry-stun',
    'arm-swing-multiplier',
    'attack-arm-extension',
    'defense-sword-offset',
    'defense-angle-threshold',
    'defense-min-segment-length',
    'stun-circle-radius',
    'player-distance',
    'self-head-opacity',
    'arm-opacity',
    'head-offset-z',
    'head-box-x',
    'head-box-y',
    'head-box-y-up',
    'head-box-z',
    'camera-back-offset',
    'camera-height',
    'ang-vel-thresh-x',
    'ang-vel-thresh-y',
    'ang-vel-thresh-z',
  ];

  const DEV_PANEL_MARKUP = `
    <div id="frontal-sword-hud" class="frontal-sword-hud" hidden aria-label="정면 검 선분 표시">
      <div class="frontal-hud-box frontal-hud-left">
        <p class="frontal-hud-title">P1 정면 검 선분 (KEY 9)</p>
        <div id="frontal-svg-p1" class="frontal-svg-wrap"></div>
        <p id="frontal-state-p1" class="frontal-hud-meta">상태: IDLE (0.00s)</p>
        <p id="frontal-len-p1" class="frontal-hud-meta">선분길이: —</p>
        <p id="frontal-angle-p1" class="frontal-hud-meta">두 검 각도: —</p>
      </div>
      <div class="frontal-hud-box frontal-hud-right">
        <p class="frontal-hud-title">P2 정면 검 선분 (KEY 9)</p>
        <div id="frontal-svg-p2" class="frontal-svg-wrap"></div>
        <p id="frontal-state-p2" class="frontal-hud-meta">상태: IDLE (0.00s)</p>
        <p id="frontal-len-p2" class="frontal-hud-meta">선분길이: —</p>
        <p id="frontal-angle-p2" class="frontal-hud-meta">두 검 각도: —</p>
      </div>
    </div>
    <aside id="ingame-duration-panel" class="ingame-duration-panel" hidden aria-label="판정별 상태이상 시간 설정">
      <div class="ingame-overlay-header">
        <div>
          <p class="ingame-eyebrow">REAL-TIME TUNING (KEY 0)</p>
          <h2>개발자 실시간 설정</h2>
        </div>
        <button id="close-duration-panel" type="button" class="overlay-btn">닫기</button>
      </div>
      <div class="duration-form">
        <label>공격 판정 → 기본공격(ATTACK) 유지시간 (초)
          <input id="dur-attack" type="number" min="0" max="60" step="0.1" value="0.5">
        </label>
        <label>공격 후 쿨다운 / 후딜레이 (초)
          <input id="attack-cooldown" type="number" min="0" max="5" step="0.05" value="0.2">
        </label>
        <label>공격 중 검 회전 보간 계수 (0.05~1.0, 클수록 빠름)
          <input id="attack-rotation-damping" type="number" min="0.05" max="1" step="0.05" value="0.18">
        </label>
        <label>평상시 검 회전 보간 계수 (0.05~1.0, 클수록 빠름)
          <input id="sensor-tilt-smoothing" type="number" min="0.05" max="1" step="0.05" value="0.65">
        </label>
        <label>공격 성공 → 상대 피격(HIT) 시간 (초)
          <input id="dur-attack-hit" type="number" min="0" max="60" step="0.1" value="1.0">
        </label>
        <label>공격 실패 → 본인 기절(STUN) 시간 (초)
          <input id="dur-attack-fail" type="number" min="0" max="60" step="0.1" value="1.0">
        </label>
        <label>패리 → 양쪽 기절(STUN) 시간 (초)
          <input id="dur-parry-stun" type="number" min="0" max="60" step="0.1" value="1.0">
        </label>
        <label>기울기 대비 팔 움직임 배수
          <input id="arm-swing-multiplier" type="number" min="0" max="5" step="0.05" value="0.55">
        </label>
        <label>공격 판정 시 팔 늘어나는 정도
          <input id="attack-arm-extension" type="number" min="0" max="5" step="0.05" value="0.65">
        </label>
        <label>방어 시 검 손잡이 방향 이동 거리
          <input id="defense-sword-offset" type="number" min="-5" max="5" step="0.1" value="1.2">
        </label>
        <label>방어 판정 검 교차 각도 허용치 (90° ± 도, 0~90)
          <input id="defense-angle-threshold" type="number" min="0" max="90" step="1" value="35">
        </label>
        <label>방어 판정 최소 검 선분 길이 (0~2.70)
          <input id="defense-min-segment-length" type="number" min="0" max="2.70" step="0.05" value="1.0">
        </label>
        <label>기절 시 중앙 진입금지 원 반지름
          <input id="stun-circle-radius" type="number" min="0" max="2.5" step="0.05" value="0.55">
        </label>
        <label>플레이어 간 간격
          <input id="player-distance" type="number" min="0.5" max="20" step="0.1" value="3.0">
        </label>
        <label>본인 화면 머리 불투명도 (0~1)
          <input id="self-head-opacity" type="number" min="0" max="1" step="0.05" value="0.35">
        </label>
        <label>팔 불투명도 (0~1)
          <input id="arm-opacity" type="number" min="0" max="1" step="0.05" value="1.0">
        </label>
        <label>머리 앞뒤 위치 (어깨 기준, -앞/+뒤)
          <input id="head-offset-z" type="number" min="-5" max="5" step="0.05" value="0.0">
        </label>
        <label>머리 히트박스 크기 (가로 X / 세로 아래 Y / 앞뒤 Z)
          <div class="xyz-threshold-row">
            <input id="head-box-x" type="number" min="0.1" max="5" step="0.04" value="0.88" aria-label="머리 히트박스 가로 X">
            <input id="head-box-y" type="number" min="0.1" max="5" step="0.04" value="0.88" aria-label="머리 히트박스 세로 아래 Y">
            <input id="head-box-z" type="number" min="0.1" max="5" step="0.04" value="0.88" aria-label="머리 히트박스 앞뒤 Z">
          </div>
        </label>
        <label>머리 히트박스 세로 위쪽 확장 (정수리 기준 +위)
          <input id="head-box-y-up" type="number" min="-0.8" max="5" step="0.04" value="0.0" aria-label="머리 히트박스 세로 위쪽 확장">
        </label>
        <label>카메라 앞뒤 거리 (플레이어 뒤쪽 기준)
          <input id="camera-back-offset" type="number" min="-5" max="15" step="0.1" value="2.4">
        </label>
        <label>카메라 위아래 높이
          <input id="camera-height" type="number" min="0.1" max="15" step="0.1" value="2.3">
        </label>
        <label>공격 판정 각속도 기준값 (X / Y / Z)
          <div class="xyz-threshold-row">
            <input id="ang-vel-thresh-x" type="number" min="0" max="100" step="0.5" value="5.0" aria-label="각속도 X 기준값">
            <input id="ang-vel-thresh-y" type="number" min="0" max="100" step="0.5" value="5.0" aria-label="각속도 Y 기준값">
            <input id="ang-vel-thresh-z" type="number" min="0" max="100" step="0.5" value="5.0" aria-label="각속도 Z 기준값">
          </div>
        </label>
      </div>
    </aside>
    <aside id="ingame-overlay" class="ingame-overlay" aria-live="polite">
      <div class="ingame-overlay-header">
        <div>
          <p class="ingame-eyebrow">GUM FIELD · IN-GAME MONITOR (TAB TOGGLE)</p>
          <h2>실시간 컨트롤러 패킷 정보</h2>
        </div>
      </div>
      <div id="ingame-packets" class="ingame-packets"></div>
    </aside>
  `;

  function mountDevUI() {
    if (mounted) return;
    const view = $('ingame-view');
    if (!view || typeof view.insertAdjacentHTML !== 'function') return;
    mounted = true;

    const topBar = view.querySelector?.('.ingame-top-bar');
    if (topBar && !topBar.querySelector?.('.tab-hint')) {
      topBar.insertAdjacentHTML(
        'afterbegin',
        '<span class="tab-hint"><kbd>9</kbd> 정면 검 선분 · <kbd>0</kbd> 개발자 설정 · <kbd>Tab</kbd> 패킷 정보 토글</span>'
      );
    }

    if (!$('ingame-duration-panel')) {
      view.insertAdjacentHTML('beforeend', DEV_PANEL_MARKUP);
    }
  }

  // [Tab 키] 실시간 컨트롤러 패킷 모니터 토글
  function toggleOverlay() {
    const overlay = $('ingame-overlay');
    if (!overlay) return false;
    overlay.hidden = !overlay.hidden;
    return !overlay.hidden;
  }

  // [9번 키] 정면 검 선분 및 머리 히트박스 HUD 토글
  function toggleFrontalSwordHud(forceOpen) {
    const hud = $('frontal-sword-hud');
    if (!hud) return false;
    const willOpen = forceOpen !== undefined ? Boolean(forceOpen) : Boolean(hud.hidden);
    hud.hidden = !willOpen;
    if (willOpen) {
      renderFrontalSwordHud();
    }
    return willOpen;
  }

  function buildFrontalSvgMarkup(
    ownSeg,
    oppSeg,
    ownColor,
    oppColor,
    mirrorX = false,
    headBox = { x: 0, y: 0.44, width: 0.88, height: 0.88 }
  ) {
    const signX = mirrorX ? -1 : 1;
    const ox1 = ((ownSeg?.handle?.x || 0) * signX).toFixed(2);
    const oy1 = (-(ownSeg?.handle?.y || 0)).toFixed(2);
    const ox2 = ((ownSeg?.tip?.x || 0) * signX).toFixed(2);
    const oy2 = (-(ownSeg?.tip?.y || 0)).toFixed(2);

    const tx1 = ((oppSeg?.handle?.x || 0) * signX).toFixed(2);
    const ty1 = (-(oppSeg?.handle?.y || 0)).toFixed(2);
    const tx2 = ((oppSeg?.tip?.x || 0) * signX).toFixed(2);
    const ty2 = (-(oppSeg?.tip?.y || 0)).toFixed(2);

    const bw = Number(headBox?.width ?? 0.88);
    const bh = Number(headBox?.height ?? 0.88);
    const cx = Number(headBox?.x || 0) * signX;
    const cy = -Number(headBox?.y ?? 0.44);
    const rx = (cx - bw / 2).toFixed(2);
    const ry = (cy - bh / 2).toFixed(2);

    return [
      '<svg viewBox="-2.6 -2.6 5.2 5.2" role="img" aria-label="정면 검 선분 및 머리 직육면체 히트박스">',
      '<line x1="-2.6" y1="0" x2="2.6" y2="0" stroke="rgba(255,255,255,0.12)" stroke-width="0.04"/>',
      '<line x1="0" y1="-2.6" x2="0" y2="2.6" stroke="rgba(255,255,255,0.12)" stroke-width="0.04"/>',
      `<rect x="${rx}" y="${ry}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.45)" stroke-width="0.05" stroke-dasharray="0.12 0.08"/>`,
      `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${oppColor}" stroke-width="0.11" stroke-linecap="round" stroke-opacity="0.55" stroke-dasharray="0.18 0.12"/>`,
      `<circle cx="${tx1}" cy="${ty1}" r="0.13" fill="${oppColor}" fill-opacity="0.55"/>`,
      `<line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="${ownColor}" stroke-width="0.16" stroke-linecap="round"/>`,
      `<circle cx="${ox1}" cy="${oy1}" r="0.18" fill="#d9a441" stroke="${ownColor}" stroke-width="0.06"/>`,
      `<circle cx="${ox2}" cy="${oy2}" r="0.1" fill="#ffffff"/>`,
      '</svg>',
    ].join('');
  }

  function renderFrontalSwordHud(receivedPlayerInfo) {
    const hud = $('frontal-sword-hud');
    if (!hud || hud.hidden) return;

    const p1 = receivedPlayerInfo?.get?.('PLAYER_1') || root.InGameBack?.getPlayerData?.('PLAYER_1');
    const p2 = receivedPlayerInfo?.get?.('PLAYER_2') || root.InGameBack?.getPlayerData?.('PLAYER_2');
    const seg1 = p1?.frontalSegment || p1?.swordCollider?.frontalSegment || { handle: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };
    const seg2 = p2?.frontalSegment || p2?.swordCollider?.frontalSegment || { handle: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };

    const angleDeg = root.InGameBack?.computeFrontalSwordAngleDeg?.(p1, p2);
    const thresh = root.InGameBack?.getDefenseAngleThreshold?.() ?? 35;
    const angleText = angleDeg !== null && angleDeg !== undefined
      ? `두 검 각도: ${Number(angleDeg).toFixed(1)}° (방어기준 90°±${thresh}°)`
      : `두 검 각도: — (방어기준 90°±${thresh}°)`;

    const p1State = p1?.state || 'IDLE';
    const p1Dur = Number(p1?.stateDuration || 0).toFixed(2);
    const p2State = p2?.state || 'IDLE';
    const p2Dur = Number(p2?.stateDuration || 0).toFixed(2);
    const minLen = root.InGameBack?.getDefenseMinSegmentLength?.() ?? 1.0;
    const len1 = Math.hypot(seg1.tip.x - seg1.handle.x, seg1.tip.y - seg1.handle.y).toFixed(2);
    const len2 = Math.hypot(seg2.tip.x - seg2.handle.x, seg2.tip.y - seg2.handle.y).toFixed(2);

    const boxSize = root.InGameBack?.getHeadHitboxSize?.() ?? root.InGameFront?.getHeadHitboxSize?.() ?? { x: 0.88, y: 0.88, yUp: 0, z: 0.88 };
    const defaultBoxW = Number(boxSize.x) > 0 ? Number(boxSize.x) : 0.88;
    const defaultBoxDown = Number(boxSize.y) > 0 ? Number(boxSize.y) : 0.88;
    const defaultBoxUp = Number.isFinite(Number(boxSize.yUp)) ? Number(boxSize.yUp) : 0;
    const defaultTopY = Math.max(0.88 - defaultBoxDown + 0.05, 0.88 + defaultBoxUp);
    const defaultBottomY = 0.88 - defaultBoxDown;
    const defaultBoxH = defaultTopY - defaultBottomY;
    const defaultCenterY = (defaultTopY + defaultBottomY) / 2;
    const headBox1 = {
      x: p1?.headCollider?.frontalCenter?.x ?? 0,
      y: p1?.headCollider?.frontalCenter?.y ?? defaultCenterY,
      width: p1?.headCollider?.size?.x ?? defaultBoxW,
      height: p1?.headCollider?.size?.y ?? defaultBoxH,
    };
    const headBox2 = {
      x: p2?.headCollider?.frontalCenter?.x ?? 0,
      y: p2?.headCollider?.frontalCenter?.y ?? defaultCenterY,
      width: p2?.headCollider?.size?.x ?? defaultBoxW,
      height: p2?.headCollider?.size?.y ?? defaultBoxH,
    };

    if ($('frontal-svg-p1')) {
      $('frontal-svg-p1').innerHTML = buildFrontalSvgMarkup(seg1, seg2, '#4fd1a5', '#f28b66', false, headBox1);
    }
    if ($('frontal-svg-p2')) {
      $('frontal-svg-p2').innerHTML = buildFrontalSvgMarkup(seg2, seg1, '#f28b66', '#4fd1a5', true, headBox2);
    }
    if ($('frontal-state-p1')) $('frontal-state-p1').textContent = `상태: ${p1State} (${p1Dur}s)`;
    if ($('frontal-state-p2')) $('frontal-state-p2').textContent = `상태: ${p2State} (${p2Dur}s)`;
    if ($('frontal-len-p1')) $('frontal-len-p1').textContent = `선분길이: ${len1} (방어 ≥ ${Number(minLen).toFixed(2)})`;
    if ($('frontal-len-p2')) $('frontal-len-p2').textContent = `선분길이: ${len2} (방어 ≥ ${Number(minLen).toFixed(2)})`;
    if ($('frontal-angle-p1')) $('frontal-angle-p1').textContent = angleText;
    if ($('frontal-angle-p2')) $('frontal-angle-p2').textContent = angleText;
  }

  // [0번 키] 개발자 설정 패널 값 동기화
  function syncDurationInputs() {
    const dur = root.InGameBack?.JUDGMENT_DURATION;
    if (dur) {
      if ($('dur-attack')) $('dur-attack').value = String(dur.ATTACK ?? 0.5);
      if ($('dur-attack-hit')) $('dur-attack-hit').value = String(dur.ATTACK_SUCCESS_HIT ?? 1.0);
      if ($('dur-attack-fail')) $('dur-attack-fail').value = String(dur.ATTACK_FAIL_STUN ?? 1.0);
      if ($('dur-parry-stun')) $('dur-parry-stun').value = String(dur.PARRY_STUN ?? 1.0);
    }
    const atkCd = root.InGameBack?.getAttackCooldownDuration?.();
    if (atkCd !== undefined && $('attack-cooldown')) {
      $('attack-cooldown').value = String(atkCd);
    }
    const atkDamp = root.InGameBack?.getAttackRotationDamping?.();
    if (atkDamp !== undefined && $('attack-rotation-damping')) {
      $('attack-rotation-damping').value = String(atkDamp);
    }
    const tiltSmooth = root.InGameBack?.getSensorTiltSmoothing?.();
    if (tiltSmooth !== undefined && $('sensor-tilt-smoothing')) {
      $('sensor-tilt-smoothing').value = String(tiltSmooth);
    }
    const mult = root.InGameBack?.getArmSwingMultiplier?.();
    if (mult !== undefined && $('arm-swing-multiplier')) {
      $('arm-swing-multiplier').value = String(mult);
    }
    const armExt = root.InGameBack?.getAttackArmExtension?.() ?? root.InGameFront?.getAttackArmExtension?.();
    if (armExt !== undefined && $('attack-arm-extension')) {
      $('attack-arm-extension').value = String(armExt);
    }
    const defOffset = root.InGameBack?.getDefenseSwordOffset?.() ?? root.InGameFront?.getDefenseSwordOffset?.();
    if (defOffset !== undefined && $('defense-sword-offset')) {
      $('defense-sword-offset').value = String(defOffset);
    }
    const defAngle = root.InGameBack?.getDefenseAngleThreshold?.();
    if (defAngle !== undefined && $('defense-angle-threshold')) {
      $('defense-angle-threshold').value = String(defAngle);
    }
    const defMinLen = root.InGameBack?.getDefenseMinSegmentLength?.();
    if (defMinLen !== undefined && $('defense-min-segment-length')) {
      $('defense-min-segment-length').value = String(defMinLen);
    }
    const stunRad = root.InGameBack?.getStunCircleRadius?.() ?? root.InGameFront?.getStunCircleRadius?.();
    if (stunRad !== undefined && $('stun-circle-radius')) {
      $('stun-circle-radius').value = String(stunRad);
    }
    const dist = root.InGameBack?.getPlayerDistance?.() ?? root.InGameFront?.getPlayerDistance?.();
    if (dist !== undefined && $('player-distance')) {
      $('player-distance').value = String(dist);
    }
    const headOpacity = root.InGameBack?.getSelfHeadOpacity?.() ?? root.InGameFront?.getSelfHeadOpacity?.();
    if (headOpacity !== undefined && $('self-head-opacity')) {
      $('self-head-opacity').value = String(headOpacity);
    }
    const armOpacity = root.InGameBack?.getArmOpacity?.() ?? root.InGameFront?.getArmOpacity?.();
    if (armOpacity !== undefined && $('arm-opacity')) {
      $('arm-opacity').value = String(armOpacity);
    }
    const headOffset = root.InGameBack?.getHeadOffsetZ?.() ?? root.InGameFront?.getHeadOffsetZ?.();
    if (headOffset !== undefined && $('head-offset-z')) {
      $('head-offset-z').value = String(headOffset);
    }
    const headBox = root.InGameBack?.getHeadHitboxSize?.() ?? root.InGameFront?.getHeadHitboxSize?.();
    if (headBox) {
      if ($('head-box-x')) $('head-box-x').value = String(headBox.x ?? 0.88);
      if ($('head-box-y')) $('head-box-y').value = String(headBox.y ?? 0.88);
      if ($('head-box-y-up')) $('head-box-y-up').value = String(headBox.yUp ?? 0.0);
      if ($('head-box-z')) $('head-box-z').value = String(headBox.z ?? 0.88);
    }
    const camOffset = root.InGameBack?.getCameraOffset?.() ?? root.InGameFront?.getCameraOffset?.();
    if (camOffset) {
      if ($('camera-back-offset')) $('camera-back-offset').value = String(camOffset.back ?? 2.4);
      if ($('camera-height')) $('camera-height').value = String(camOffset.height ?? 2.3);
    }
    const angThresh = root.InGameBack?.getAttackAngularThreshold?.();
    if (angThresh) {
      if ($('ang-vel-thresh-x')) $('ang-vel-thresh-x').value = String(angThresh.x ?? 5.0);
      if ($('ang-vel-thresh-y')) $('ang-vel-thresh-y').value = String(angThresh.y ?? 5.0);
      if ($('ang-vel-thresh-z')) $('ang-vel-thresh-z').value = String(angThresh.z ?? 5.0);
    }
  }

  function applyDurationFromInputs() {
    root.InGameBack?.setJudgmentDurations?.({
      ATTACK: $('dur-attack')?.value,
      ATTACK_SUCCESS_HIT: $('dur-attack-hit')?.value,
      ATTACK_FAIL_STUN: $('dur-attack-fail')?.value,
      PARRY_STUN: $('dur-parry-stun')?.value,
    });
    if ($('attack-cooldown')) {
      root.InGameBack?.setAttackCooldownDuration?.($('attack-cooldown').value);
    }
    if ($('attack-rotation-damping')) {
      root.InGameBack?.setAttackRotationDamping?.($('attack-rotation-damping').value);
    }
    if ($('sensor-tilt-smoothing')) {
      root.InGameBack?.setSensorTiltSmoothing?.($('sensor-tilt-smoothing').value);
    }
    if ($('arm-swing-multiplier')) {
      root.InGameBack?.setArmSwingMultiplier?.($('arm-swing-multiplier').value);
    }
    if ($('attack-arm-extension')) {
      const nextExt = $('attack-arm-extension').value;
      if (root.InGameBack?.setAttackArmExtension) {
        root.InGameBack.setAttackArmExtension(nextExt);
      } else {
        root.InGameFront?.setAttackArmExtension?.(nextExt);
      }
    }
    if ($('defense-sword-offset')) {
      const nextDefOffset = $('defense-sword-offset').value;
      if (root.InGameBack?.setDefenseSwordOffset) {
        root.InGameBack.setDefenseSwordOffset(nextDefOffset);
      } else {
        root.InGameFront?.setDefenseSwordOffset?.(nextDefOffset);
      }
    }
    if ($('defense-angle-threshold')) {
      const nextAngle = Number($('defense-angle-threshold').value);
      if (Number.isFinite(nextAngle) && nextAngle >= 0) {
        root.InGameBack?.setDefenseAngleThreshold?.(nextAngle);
        renderFrontalSwordHud();
      }
    }
    if ($('defense-min-segment-length')) {
      const nextMinLen = Number($('defense-min-segment-length').value);
      if (Number.isFinite(nextMinLen) && nextMinLen >= 0) {
        root.InGameBack?.setDefenseMinSegmentLength?.(nextMinLen);
        renderFrontalSwordHud();
      }
    }
    if ($('stun-circle-radius')) {
      const nextStunRad = $('stun-circle-radius').value;
      if (root.InGameBack?.setStunCircleRadius) {
        root.InGameBack.setStunCircleRadius(nextStunRad);
      } else {
        root.InGameFront?.setStunCircleRadius?.(nextStunRad);
      }
    }
    if ($('player-distance')) {
      const nextDist = $('player-distance').value;
      if (root.InGameBack?.setPlayerDistance) {
        root.InGameBack.setPlayerDistance(nextDist);
      } else {
        root.InGameFront?.setPlayerDistance?.(nextDist);
      }
    }
    if ($('self-head-opacity')) {
      const nextOpacity = $('self-head-opacity').value;
      if (root.InGameBack?.setSelfHeadOpacity) {
        root.InGameBack.setSelfHeadOpacity(nextOpacity);
      } else {
        root.InGameFront?.setSelfHeadOpacity?.(nextOpacity);
      }
    }
    if ($('arm-opacity')) {
      const nextArmOpacity = $('arm-opacity').value;
      if (root.InGameBack?.setArmOpacity) {
        root.InGameBack.setArmOpacity(nextArmOpacity);
      } else {
        root.InGameFront?.setArmOpacity?.(nextArmOpacity);
      }
    }
    if ($('head-offset-z')) {
      const nextOffsetZ = $('head-offset-z').value;
      if (root.InGameBack?.setHeadOffsetZ) {
        root.InGameBack.setHeadOffsetZ(nextOffsetZ);
      } else {
        root.InGameFront?.setHeadOffsetZ?.(nextOffsetZ);
      }
    }
    if ($('head-box-x') || $('head-box-y') || $('head-box-y-up') || $('head-box-z')) {
      const boxUpdates = {
        x: $('head-box-x')?.value,
        y: $('head-box-y')?.value,
        yUp: $('head-box-y-up')?.value,
        z: $('head-box-z')?.value,
      };
      if (root.InGameBack?.setHeadHitboxSize) {
        root.InGameBack.setHeadHitboxSize(boxUpdates);
      } else {
        root.InGameFront?.setHeadHitboxSize?.(boxUpdates);
      }
    }
    if ($('camera-back-offset') || $('camera-height')) {
      const camUpdates = {
        back: $('camera-back-offset')?.value,
        height: $('camera-height')?.value,
      };
      if (root.InGameBack?.setCameraOffset) {
        root.InGameBack.setCameraOffset(camUpdates);
      } else {
        root.InGameFront?.setCameraOffset?.(camUpdates);
      }
    }
    root.InGameBack?.setAttackAngularThreshold?.({
      x: $('ang-vel-thresh-x')?.value,
      y: $('ang-vel-thresh-y')?.value,
      z: $('ang-vel-thresh-z')?.value,
    });
  }

  function toggleDurationPanel(forceOpen) {
    const panel = $('ingame-duration-panel');
    if (!panel) return false;
    const willOpen = forceOpen !== undefined ? Boolean(forceOpen) : Boolean(panel.hidden);
    panel.hidden = !willOpen;
    if (willOpen) {
      syncDurationInputs();
    }
    return willOpen;
  }

  // [Tab 키] 실시간 컨트롤러 패킷 및 검 쿼터니언/각속도 오버레이 렌더링
  function renderPackets(players = [], rates = new Map(), receivedPlayerInfo, receivedAngles) {
    const container = $('ingame-packets');
    if (!container) return;
    container.replaceChildren();
    if (!players.length) {
      const empty = document.createElement('section');
      empty.className = 'packet-card';
      const text = document.createElement('p');
      text.className = 'packet-meta';
      text.textContent = '연결된 컨트롤러가 없습니다.';
      empty.append(text);
      container.append(empty);
      return;
    }
    const ordered = [...players].sort((a, b) => a.id.localeCompare(b.id));
    for (const s of ordered) {
      const card = document.createElement('section');
      card.className = 'packet-card';
      card.dataset.player = s.id;
      const heading = document.createElement('h3');
      heading.textContent = `${s.id} (${s.state})`;
      const meta = document.createElement('p');
      meta.className = 'packet-meta';
      meta.textContent = `수신율 ${(rates.get(s.id) || 0).toFixed(1)}회/초 · 누적 ${s.count} · 누락 ${s.missing ?? '미측정(seq 없음)'} · 오류 ${s.invalid}`;
      const pre = document.createElement('pre');
      pre.textContent = s.latest ? JSON.stringify(s.latest, null, 2) : '센서 패킷 수신 대기 중...';

      const playerInfo = receivedPlayerInfo?.get?.(s.id) || root.InGameBack?.getPlayerData?.(s.id);
      const q = receivedAngles?.get?.(s.id) || playerInfo?.tilt || { x: 0, y: 0, z: 0, w: 1 };
      const av = playerInfo?.angularVelocity || { x: 0, y: 0, z: 0 };

      const angleBox = document.createElement('p');
      angleBox.className = 'sword-angle-info';
      const qx = Number(q.x || 0).toFixed(2);
      const qy = Number(q.y || 0).toFixed(2);
      const qz = Number(q.z || 0).toFixed(2);
      const qw = Number(q.w ?? 1).toFixed(2);
      const gameState = playerInfo?.state ? ` · 게임상태 ${playerInfo.state}` : '';
      const durationText = playerInfo?.stateDuration !== undefined
        ? ` (${Number(playerInfo.stateDuration).toFixed(2)}s)`
        : '';
      angleBox.textContent = `검 쿼터니언(XYZW): X ${qx} · Y ${qy} · Z ${qz} · W ${qw}${gameState}${durationText}`;

      const angVelBox = document.createElement('p');
      angVelBox.className = 'sword-angle-info';
      const avx = Number(av.x || 0).toFixed(2);
      const avy = Number(av.y || 0).toFixed(2);
      const avz = Number(av.z || 0).toFixed(2);
      angVelBox.textContent = `검 각속도(XYZ): X ${avx} · Y ${avy} · Z ${avz}`;

      card.append(heading, meta, pre, angleBox, angVelBox);
      container.append(card);
    }
  }

  function bindDevKeys() {
    if (keyBound) return;
    const target = root.window || root;
    if (typeof target.addEventListener !== 'function') return;
    keyBound = true;

    for (const inputId of DEV_INPUT_IDS) {
      $(inputId)?.addEventListener?.('input', applyDurationFromInputs);
      $(inputId)?.addEventListener?.('change', applyDurationFromInputs);
    }

    if ($('close-duration-panel')) {
      $('close-duration-panel').onclick = () => toggleDurationPanel(false);
    }

    target.addEventListener('keydown', (event) => {
      if ($('ingame-view')?.hidden) return;
      const activeTag = event.target?.tagName?.toUpperCase?.() || '';
      const isEditingInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if (event.key === 'Tab' || event.code === 'Tab') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleOverlay();
        }
      } else if (event.key === '9' || event.code === 'Digit9' || event.code === 'Numpad9') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleFrontalSwordHud();
        }
      } else if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
        if (!isEditingInput) {
          event.preventDefault?.();
          toggleDurationPanel();
        }
      } else if (event.key === 'Escape' || event.code === 'Escape') {
        if (!$('ingame-duration-panel')?.hidden) {
          event.preventDefault?.();
          toggleDurationPanel(false);
        }
      }
    });
  }

  function init() {
    mountDevUI();
    bindDevKeys();
    syncDurationInputs();
  }

  root.InGameDev = {
    init,
    mountDevUI,
    bindDevKeys,
    syncDurationInputs,
    toggleOverlay,
    toggleFrontalSwordHud,
    toggleDurationPanel,
    renderFrontalSwordHud,
    renderPackets,
  };
})(globalThis);
