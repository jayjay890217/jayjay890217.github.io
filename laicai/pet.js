/*!
 * 網頁桌寵 — 在網頁底部走來走去的狗狗
 * 用法：<script src="/desktop-pet/pet.js" defer></script>
 * 選項（寫在 script 標籤上）：
 *   data-size="150"      狗狗畫布高度（px），預設桌機 150、手機 110
 *   data-autonomy="off"  不要自己走動
 *   data-z="9999"        z-index
 * 進階（放在 pet.js 之前）：
 *   <script>window.WEB_PET = { name:'來財', lines:['汪！'], rightGap:90, restoreSide:'left',
 *                              z:45, size:130, sizeMobile:96, startDelay:2600, accent:'#ff7a00' };</script>
 */
(function () {
  'use strict';
  if (window.__webPet) return;
  window.__webPet = true;

  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/[^\/?#]*([?#].*)?$/, '') : './';
  var data = (script && script.dataset) || {};
  var cfg = window.WEB_PET || {};
  var NAME = cfg.name || data.name || '狗狗';
  var LINES = cfg.lines || [];
  var ACCENT = cfg.accent || '#ff7a00';
  var RIGHT_GAP = +cfg.rightGap || 0;      // 右邊保留給網站自己的浮動按鈕／LOGO
  var Z = cfg.z || data.z || 2147483000;

  // ── 物理常數（以 256 px 高的畫布為單位，使用時乘上 u）──
  var WALK = 75, WALK_ACC = 220, WALK_STRIDE = 70;
  var RUN = 300, RUN_ACC = 900, RUN_STRIDE = 170;
  var CARRY = 180, CARRY_ACC = 500;
  var GRAVITY = 2600, JUMP = 980, HOP = 560;
  var BALL_G = 1900, BALL_REST = 0.55, BALL_FRIC = 0.8, BALL_ROLL = 420;
  var MAX_DT = 0.05;
  var STORE_KEY = 'webPet.hidden';

  var M;                 // manifest
  var frames = {};       // name → Image
  var tilt = [];
  var walkF = [], runF = [];
  var k, u, Wd, Hd;      // 素材 px → CSS px、物理單位、顯示寬高
  var px = 0, feetY = 0, vx = 0, vy = 0, facingRight = false;
  var state = 'idle', stateTime = 0, stateDur = 0, targetX = 0, gait = 0;
  var headAng = 0, mouseX = -1, mouseY = -1;
  var ball = null, ballX, ballY, ballVx, ballVy, ballSpin, ballCarried, ballLanded, fetchHome, throwDir;
  var root, petEl, img, hit, menu, restoreBtn, ballEl, bub, bubTimer, lineIdx = 0;
  var hitBox = [0, 0, 0];
  var curName = null, mirrored = false;
  var autoTimer = null, clickTimer = null, pressTimer = null;
  var pointer = null; // 目前按下的指標
  var lastT = 0, running = false;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────── 工具 ─────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function approach(v, t, d) { return v < t ? Math.min(v + d, t) : Math.max(v - d, t); }
  function smooth(cur, t, rate, dt) { return cur + (t - cur) * (1 - Math.exp(-rate * dt)); }
  function vw() { return document.documentElement.clientWidth || window.innerWidth; }
  function vh() { return window.innerHeight; }
  function ground() { return vh(); }
  function store(v) { try { if (v) localStorage.setItem(STORE_KEY, '1'); else localStorage.removeItem(STORE_KEY); } catch (e) {} }
  function stored() { try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } }
  function el(tag, css, parent) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ───────────── 載入 ─────────────
  function load() {
    fetch(BASE + 'sprites/manifest.json').then(function (r) { return r.json(); }).then(function (m) {
      M = m;
      var names = Object.keys(m.frames);
      return Promise.all(names.map(function (n) {
        var im = new Image();
        im.decoding = 'async';
        im.src = BASE + 'sprites/' + n + '.webp';
        frames[n] = im;
        return im.decode ? im.decode().catch(function () {}) : new Promise(function (ok) { im.onload = im.onerror = ok; });
      }));
    }).then(init).catch(function (e) { console.warn('[web-pet] 載入失敗', e); });
  }

  function init() {
    for (var i = 0; i < M.tiltFrames; i++) {
      var t = frames['idle-tilt-' + (i < 10 ? '0' : '') + i];
      if (t) tilt.push(t);
    }
    if (tilt.length !== M.tiltFrames) tilt = [];
    walkF = ['walk-01', 'walk-02', 'walk-03', 'walk-04'];
    runF = ['run-01', 'run-02', 'run-03', 'run-04', 'run-05', 'run-06'];

    var z = Z;
    root = el('div', 'position:fixed;left:0;top:0;width:0;height:0;z-index:' + z + ';pointer-events:none;');
    root.setAttribute('aria-hidden', 'true');
    petEl = el('div', 'position:absolute;left:0;top:0;will-change:transform;pointer-events:none;', root);
    img = el('img', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;user-select:none;-webkit-user-drag:none;', petEl);
    img.alt = '';
    img.draggable = false;
    hit = el('div', 'position:absolute;pointer-events:auto;cursor:grab;touch-action:none;-webkit-tap-highlight-color:transparent;', petEl);
    hit.title = NAME + '：點我、拖我、右鍵（手機長按）有選單';
    ballEl = el('div', 'position:absolute;left:0;top:0;display:none;pointer-events:none;will-change:transform;', root);
    ballEl.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%"><defs><radialGradient id="wpb" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#f4ff7a"/><stop offset="1" stop-color="#a9c81e"/></radialGradient></defs>' +
      '<circle cx="50" cy="50" r="47" fill="url(#wpb)" stroke="#6e8610" stroke-width="3"/>' +
      '<path d="M18 22 Q50 50 18 78 M82 22 Q50 50 82 78" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>';
    buildMenu();
    restoreBtn = el('button', 'position:fixed;' + (cfg.restoreSide === 'left' ? 'left' : 'right') + ':12px;bottom:12px;width:40px;height:40px;' +
      'border-radius:50%;border:1px solid ' + ACCENT + ';background:rgba(10,10,10,.82);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
      'font-size:19px;cursor:pointer;display:none;padding:0;pointer-events:auto;z-index:' + z + ';', null);
    restoreBtn.textContent = cfg.restoreIcon || '🐶';
    restoreBtn.setAttribute('aria-label', '叫' + NAME + '出來');
    restoreBtn.title = '叫' + NAME + '出來';
    bub = el('div', 'position:fixed;left:0;top:0;max-width:230px;background:#fff;color:#1a1a1a;' +
      'font:700 14px/1.45 "Noto Sans TC",system-ui,"Microsoft JhengHei",sans-serif;padding:9px 12px 8px;border-radius:12px;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.4);border:2px solid ' + ACCENT + ';display:none;pointer-events:auto;z-index:' + z + ';', null);
    bub.addEventListener('click', function (e) { if (e.target.getAttribute('data-x')) setHidden(true); });
    restoreBtn.addEventListener('click', function () { setHidden(false); });
    document.body.appendChild(root);
    document.body.appendChild(restoreBtn);
    document.body.appendChild(bub);

    applySize();
    px = vw() * 0.7 - Wd / 2;
    feetY = ground();
    clampX();
    enter('idle');

    hit.addEventListener('pointerdown', onDown);
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerup', onUp);
    hit.addEventListener('pointercancel', onCancel);
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(e.clientX, e.clientY); });
    document.addEventListener('pointermove', function (e) { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
    document.addEventListener('pointerdown', function (e) { if (menu.style.display !== 'none' && !menu.contains(e.target)) closeMenu(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', function () { applySize(); clampX(); if (!isAir()) feetY = ground(); });
    document.addEventListener('visibilitychange', function () { lastT = performance.now() / 1000; });

    setHidden(stored());
    schedule();
    if (LINES.length && !stored()) setTimeout(function () { say(LINES[0], 3800); lineIdx = 1; }, 900);
  }

  // ───────────── 對話泡泡 ─────────────
  function say(html, ms) {
    if (!bub || root.style.display === 'none') return;
    bub.innerHTML = html + '<span data-x="1" style="display:block;margin-top:5px;font-size:11px;font-weight:400;color:#888;' +
      'cursor:pointer;text-align:right">收起' + NAME + ' ✕</span>';
    var links = bub.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) links[i].style.color = ACCENT;
    bub.style.display = 'block';
    placeBub();
    clearTimeout(bubTimer);
    bubTimer = setTimeout(function () { bub.style.display = 'none'; }, ms || 4500);
  }
  function placeBub() {
    var top = feetY - M.groundY * k;
    var cx = px + hitBox[0] + hitBox[2] / 2;
    var bw = bub.offsetWidth, bh = bub.offsetHeight;
    bub.style.left = clamp(cx - bw / 2, 8, vw() - bw - 8) + 'px';
    bub.style.top = Math.max(8, top + hitBox[1] - bh - 8) + 'px';
  }

  function applySize() {
    var mobile = vw() < 640;
    var h = +data.size || (mobile ? (cfg.sizeMobile || 110) : (cfg.size || 150));
    Hd = h;
    k = h / M.canvasH;
    Wd = M.canvasW * k;
    u = h / 256; // 跟桌面版同一套速度單位
    petEl.style.width = Wd + 'px';
    petEl.style.height = Hd + 'px';
    var b = M.ballSize * k;
    ballEl.style.width = ballEl.style.height = b + 'px';
  }

  function setHidden(h) {
    store(h);
    root.style.display = h ? 'none' : '';
    restoreBtn.style.display = h ? 'block' : 'none';
    if (h) bub.style.display = 'none';
    closeMenu();
    if (h) { removeBall(); running = false; return; }
    if (!running) {
      running = true;
      lastT = performance.now() / 1000;
      requestAnimationFrame(frame);
    }
  }

  // ───────────── 顯示 ─────────────
  function show(name, side) {
    var f = frames[name];
    if (!f) return;
    if (curName !== name) { img.src = f.src; curName = name; }
    var m = !!side && (facingRight !== (M.sideFacing === 'right'));
    if (m !== mirrored) { img.style.transform = m ? 'scaleX(-1)' : ''; mirrored = m; }
    var bb = M.frames[name];
    var x0 = m ? M.canvasW - bb[2] : bb[0], x1 = m ? M.canvasW - bb[0] : bb[2];
    var pad = 6;
    hitBox = [x0 * k, bb[1] * k, (x1 - x0) * k];
    hit.style.left = (x0 * k - pad) + 'px';
    hit.style.top = (bb[1] * k - pad) + 'px';
    hit.style.width = ((x1 - x0) * k + pad * 2) + 'px';
    hit.style.height = ((bb[3] - bb[1]) * k + pad * 2) + 'px';
  }

  function showIdle() {
    if (tilt.length) {
      var t = M.headMaxAngle > 0 ? clamp(headAng / M.headMaxAngle, -1, 1) : 0;
      var i = Math.round((t + 1) / 2 * (tilt.length - 1));
      var n = 'idle-tilt-' + (i < 10 ? '0' : '') + i;
      show(n, false);
    } else show('idle-front', false);
  }

  // ───────────── 狀態 ─────────────
  function enter(s) {
    state = s; stateTime = 0;
    switch (s) {
      case 'idle': showIdle(); break;
      case 'sit': show('sit-front', false); break;
      case 'cuddle': show('cuddle', false); break;
      case 'sleep': show('sleep', true); break;
      case 'crouch': case 'windup': show('jump-crouch', true); break;
      case 'air': case 'drag': show('jump-air', true); break;
      case 'land': show('jump-land', true); break;
      case 'flight': show('stand-side', true); break;
      case 'pickup': show('pickup-01', true); break;
      case 'return': show('carry-side', true); break;
      case 'drop': show('drop', true); break;
    }
  }

  var FETCH = { windup: 1, flight: 1, chase: 1, pickup: 1, 'return': 1, drop: 1 };
  function isFetch() { return !!FETCH[state]; }
  function isAir() { return state === 'air' || state === 'crouch' || state === 'drag'; }
  function busy() { return isAir() || state === 'land' || isFetch(); }
  function minX() { return -Wd * 0.15; }
  function maxX() { return Math.max(minX() + 10, vw() - Wd * 0.85 - RIGHT_GAP); }
  function clampX() {
    var b = px;
    px = clamp(px, minX(), maxX());
    if (px !== b && state === 'air') vx = -vx * 0.4;
  }

  function jump(speed) {
    if (isAir() || isFetch()) return;
    stateDur = speed;
    enter('crouch');
  }
  function goTo(x, run) {
    if (busy()) return;
    targetX = clamp(x, minX(), maxX());
    gait = 0;
    enter(run ? 'run' : 'walk');
  }
  function hold(s, sec) {
    if (busy()) return;
    stateDur = sec;
    enter(s);
  }

  function moveToward(target, maxSpeed, accel, dt) {
    var d = target - px, a = accel * u;
    var want = Math.sign(d) * Math.min(maxSpeed * u, Math.sqrt(2 * a * Math.abs(d)));
    vx = approach(vx, want, a * dt);
    px += vx * dt;
    if (vx > 4 * u) facingRight = true; else if (vx < -4 * u) facingRight = false;
    return Math.abs(target - px) < 2 * u && Math.abs(vx) < 25 * u;
  }

  // ───────────── 主迴圈 ─────────────
  function frame(ms) {
    if (!running) return;
    var now = ms / 1000;
    var dt = Math.min(now - lastT, MAX_DT);
    lastT = now;
    if (dt > 0) {
      try { step(dt); } catch (e) { console.warn('[web-pet]', e); removeBall(); enter('idle'); }
    }
    requestAnimationFrame(frame);
  }

  function step(dt) {
    stateTime += dt;
    var g = ground();
    switch (state) {
      case 'idle':
        vx = approach(vx, 0, WALK_ACC * u * dt);
        gaze(dt);
        break;
      case 'walk': case 'run':
        var run = state === 'run';
        if (moveToward(targetX, run ? RUN : WALK, run ? RUN_ACC : WALK_ACC, dt)) enter('idle');
        else {
          gait += Math.abs(vx) * dt / ((run ? RUN_STRIDE : WALK_STRIDE) * u);
          var fs = run ? runF : walkF;
          show(fs[Math.floor(gait * fs.length) % fs.length], true);
        }
        break;
      case 'sit': case 'cuddle': case 'sleep':
        vx = 0;
        if (stateTime > stateDur) enter('idle');
        break;
      case 'crouch':
        if (stateTime > 0.14) { vy = -stateDur * u; enter('air'); }
        break;
      case 'air':
        vy += GRAVITY * u * dt;
        feetY += vy * dt;
        px += vx * dt;
        vx = approach(vx, 0, 200 * u * dt);
        if (feetY >= g && vy > 0) { feetY = g; vy = 0; enter('land'); }
        break;
      case 'land':
        vx = approach(vx, 0, RUN_ACC * u * dt);
        px += vx * dt;
        if (stateTime > 0.22) enter('idle');
        break;
      case 'drag':
        break;
      default:
        stepFetch(dt);
    }
    if (!isAir()) {
      if (feetY < g - 1) { vy = 0; enter('air'); } else feetY = g;
    }
    if (ball) stepBall(dt);
    if (state !== 'drag') clampX();
    petEl.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + (feetY - M.groundY * k).toFixed(1) + 'px,0)';
    if (bub.style.display !== 'none') placeBub();
  }

  // 以鼻子為中心歪頭，看向滑鼠
  function gaze(dt) {
    var target = 0;
    if (mouseX >= 0) {
      var pivX = px + M.headPivotX * k;
      target = clamp((mouseX - pivX) / (420 * u), -1, 1) * M.headMaxAngle;
    }
    headAng = smooth(headAng, target, 6, dt);
    showIdle();
  }

  // ───────────── 撿球 ─────────────
  function startFetch() {
    if (isAir() || isFetch()) return;
    if (state !== 'idle') enter('idle');
    fetchHome = px;
    throwDir = (px + Wd / 2 < vw() / 2) ? 1 : -1;
    facingRight = throwDir > 0;
    enter('windup');
  }

  function mouth() {
    var mx = (facingRight === (M.sideFacing === 'right')) ? M.mouthX : M.canvasW - M.mouthX;
    return { x: px + mx * k, y: feetY - (M.groundY - M.mouthY) * k };
  }

  function stepFetch(dt) {
    switch (state) {
      case 'windup':
        vx = 0;
        if (stateTime > 0.45) throwBall();
        break;
      case 'flight':
        facingRight = ballX > px + Wd / 2;
        show('stand-side', true);
        if (ballLanded) { gait = 0; enter('chase'); }
        break;
      case 'chase':
        var right = ballX > px + Wd / 2;
        var off = (right === (M.sideFacing === 'right') ? M.mouthX : M.canvasW - M.mouthX) * k;
        var target = clamp(ballX - off, minX(), maxX());
        var slow = Math.abs(ballVx) < 30 * u && Math.abs(ballVy) < 1;
        var arrived = moveToward(target, RUN, RUN_ACC, dt);
        gait += Math.abs(vx) * dt / (RUN_STRIDE * u);
        show(Math.abs(vx) < 20 * u ? 'stand-side' : runF[Math.floor(gait * 6) % 6], true);
        if (arrived && slow) { vx = 0; facingRight = right; enter('pickup'); }
        break;
      case 'pickup':
        if (stateTime < 0.22) show('pickup-01', true);
        else if (stateTime < 0.6) show('pickup-02', true);
        else if (stateTime < 0.85) {
          if (!ballCarried) { ballCarried = true; ballVx = ballVy = 0; }
          show('pickup-01', true);
        } else { gait = 0; enter('return'); }
        break;
      case 'return':
        var done = moveToward(fetchHome, CARRY, CARRY_ACC, dt);
        gait += Math.abs(vx) * dt / (WALK_STRIDE * u);
        show(Math.abs(vx) < 15 * u ? 'carry-side' : walkF[Math.floor(gait * 4) % 4], true);
        if (done) { vx = 0; enter('drop'); }
        break;
      case 'drop':
        if (ballCarried && stateTime > 0.2) { ballCarried = false; ballVx = (facingRight ? 1 : -1) * 40 * u; ballVy = 0; }
        if (stateTime > 1.4) { removeBall(); stateDur = 1.6; enter('cuddle'); }
        break;
    }
  }

  function throwBall() {
    enter('flight');
    var m = mouth();
    ballX = m.x; ballY = m.y - 20 * u;
    ballVx = throwDir * (480 + Math.random() * 420) * u;
    ballVy = -(760 + Math.random() * 260) * u;
    ballSpin = 0; ballCarried = false; ballLanded = false;
    ball = true;
    ballEl.style.display = 'block';
  }

  function stepBall(dt) {
    var r = M.ballSize * k / 2;
    if (ballCarried) {
      var m = mouth();
      ballX = m.x;
      ballY = m.y + (state === 'return' ? Math.sin(gait * Math.PI * 2) * 1.5 * u : 0);
    } else {
      ballVy += BALL_G * u * dt;
      ballX += ballVx * dt;
      ballY += ballVy * dt;
      var floor = ground() - r;
      if (ballY >= floor) {
        ballY = floor;
        if (ballVy > 140 * u) { ballVy = -ballVy * BALL_REST; ballVx *= BALL_FRIC; }
        else { ballVy = 0; ballVx = approach(ballVx, 0, BALL_ROLL * u * dt); }
        ballLanded = true;
      }
      var lo = 40 * u, hi = vw() - 40 * u - RIGHT_GAP;
      if (ballX < lo) { ballX = lo; ballVx = Math.abs(ballVx) * 0.6; }
      if (ballX > hi) { ballX = hi; ballVx = -Math.abs(ballVx) * 0.6; }
      ballSpin += ballVx / Math.max(r, 1) * dt * 180 / Math.PI;
    }
    ballEl.style.transform = 'translate3d(' + (ballX - r).toFixed(1) + 'px,' + (ballY - r).toFixed(1) + 'px,0) rotate(' + ballSpin.toFixed(1) + 'deg)';
  }

  function removeBall() {
    ball = null; ballCarried = false;
    if (ballEl) ballEl.style.display = 'none';
  }

  // ───────────── 指標（滑鼠／觸控）─────────────
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    closeMenu();
    hit.setPointerCapture(e.pointerId);
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, px: px, fy: feetY, drag: false };
    hit.style.cursor = 'grabbing';
    if (e.pointerType !== 'mouse') {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        if (pointer && !pointer.drag) { var p = pointer; pointer = null; openMenu(p.x, p.y); }
      }, 550);
    }
  }

  function onMove(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    var dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    if (!pointer.drag && dx * dx + dy * dy > 36) {
      pointer.drag = true;
      clearTimeout(pressTimer); clearTimeout(clickTimer); clickTimer = null;
      if (isFetch()) removeBall();
      vx = vy = 0;
      enter('drag');
    }
    if (pointer.drag) {
      px = clamp(pointer.px + dx, -Wd * 0.5, vw() - Wd * 0.5);
      feetY = clamp(pointer.fy + dy, Hd * 0.5, ground());
    }
  }

  function onUp(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    clearTimeout(pressTimer);
    var p = pointer;
    pointer = null;
    hit.style.cursor = 'grab';
    if (p.drag) { vx = vy = 0; enter('air'); return; }
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; jump(JUMP); }
    else clickTimer = setTimeout(function () { clickTimer = null; singleClick(); }, 260);
  }

  function onCancel() {
    clearTimeout(pressTimer);
    if (pointer && pointer.drag) { vx = vy = 0; enter('air'); }
    pointer = null;
    hit.style.cursor = 'grab';
  }

  function singleClick() {
    if (state === 'sleep') { enter('idle'); if (LINES.length) say('呼嚕…被你吵醒了 😪'); return; }
    if (busy()) return;
    if (LINES.length) say(LINES[lineIdx++ % LINES.length], 5200);
    var r = Math.floor(Math.random() * 3);
    if (r === 0) hold('cuddle', 2.2);
    else if (r === 1) hold('sit', 2.5);
    else jump(HOP);
  }

  // ───────────── 選單 ─────────────
  function buildMenu() {
    menu = el('div', 'position:fixed;display:none;min-width:150px;padding:6px;border-radius:12px;background:#fff;color:#222;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.22);font:14px/1.2 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei",sans-serif;pointer-events:auto;', root);
    menu.setAttribute('role', 'menu');
    var items = [
      ['🎾 丟球給牠', startFetch],
      ['🚶 散步', function () { goTo(minX() + Math.random() * (maxX() - minX()), false); }],
      ['🏃 跑一圈', function () { goTo(px < vw() / 2 - Wd / 2 ? maxX() : minX(), true); }],
      ['🪑 坐下', function () { if (state !== 'idle' && !busy()) enter('idle'); hold('sit', 8); }],
      ['🥰 撒嬌', function () { if (state !== 'idle' && !busy()) enter('idle'); hold('cuddle', 3); }],
      ['💤 睡覺', function () { if (state !== 'idle' && !busy()) enter('idle'); hold('sleep', 30); }],
      null,
      ['🙈 收起' + NAME, function () { setHidden(true); }]
    ];
    items.forEach(function (it) {
      if (!it) { el('div', 'height:1px;margin:4px 6px;background:#eee;', menu); return; }
      var b = el('button', 'display:block;width:100%;text-align:left;padding:9px 12px;border:none;border-radius:8px;background:none;' +
        'color:inherit;font:inherit;cursor:pointer;', menu);
      b.textContent = it[0];
      b.setAttribute('role', 'menuitem');
      b.onmouseenter = function () { b.style.background = '#f2f2f2'; };
      b.onmouseleave = function () { b.style.background = 'none'; };
      b.onclick = function () { closeMenu(); it[1](); };
    });
  }

  function openMenu(x, y) {
    menu.style.display = 'block';
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = clamp(x, 8, vw() - w - 8) + 'px';
    menu.style.top = clamp(y - h, 8, vh() - h - 8) + 'px';
  }
  function closeMenu() { if (menu) menu.style.display = 'none'; }

  // ───────────── 自主活動 ─────────────
  function schedule() {
    clearTimeout(autoTimer);
    if (data.autonomy === 'off' || reduced) return;
    autoTimer = setTimeout(tick, (12 + Math.random() * 28) * 1000);
  }
  function tick() {
    if (running && state === 'idle' && !pointer) {
      var x = minX() + Math.random() * (maxX() - minX());
      var r = Math.floor(Math.random() * 6);
      if (r <= 1) goTo(x, false);
      else if (r === 2) goTo(x, true);
      else if (r === 3) hold('sit', 6 + Math.random() * 6);
      else if (r === 4) hold('cuddle', 3);
      else hold('sleep', 20 + Math.random() * 30);
    }
    schedule();
  }

  function start() { setTimeout(load, +cfg.startDelay || 0); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
