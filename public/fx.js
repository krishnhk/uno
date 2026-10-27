// Table animations: FX.react(moments, view) is called after every table update, FX.clear() when the scorecard opens.
// Physical feel: gravity, bounce, friction, spin, squash, impact shake. Everything lives in #fx-layer (DOM) and
// #fx-canvas (particles) and is removed by FX.clear(). Any failure is swallowed so the game never breaks.
(function () {
  'use strict';

  const COLORS = { red: '#ff4d5e', yellow: '#ffd23f', green: '#34d399', blue: '#4f9bff' };
  const RAINBOW = ['#ff4d5e', '#ffd23f', '#34d399', '#4f9bff', '#c084fc', '#ff7ac8'];
  const GOLD = ['#ffd23f', '#ffe27a', '#ffb81c', '#fff3b0', '#ff9f1c'];
  const CONFETTI = ['#ff4d5e', '#ffd23f', '#34d399', '#4f9bff', '#ffffff', '#c084fc', '#ff7ac8'];
  const MAX_PARTS = 600;
  const MAX_BODIES = 30;
  const GRAV = 2400; // flying cards, px/s^2

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  let canvas = null, ctx = null, layer = null;
  let W = 0, H = 0, dpr = 1, raf = 0, lastTs = 0, clock = 0, epoch = 0;
  let shaking = false;
  const parts = [];
  const bodies = [];
  const timers = new Set();
  const anims = new Set();

  /** Scale for sizes: phones get smaller effects. */
  const S = () => clamp(Math.min(window.innerWidth, window.innerHeight * 1.4) / 900, 0.55, 1.25);

  function safe(fn) { try { fn(); } catch (e) { try { console.warn('fx', e); } catch { /* ignore */ } } }

  function later(fn, ms) {
    const ep = epoch;
    const id = setTimeout(() => {
      timers.delete(id);
      if (ep === epoch) safe(fn);
    }, Math.max(0, ms));
    timers.add(id);
    return id;
  }

  function init() {
    if (canvas) return true;
    if (!document.body) return false;
    canvas = document.createElement('canvas');
    canvas.id = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(canvas, layer);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    layer.style.setProperty('--fx-s', String(S()));
  }

  /** Web Animation that is tracked so clear() can cancel it. Pass fill:'none' for animations on the game's own elements. */
  function A(el, keyframes, options) {
    if (!el || !el.animate) return null;
    try {
      const a = el.animate(keyframes, { fill: 'both', ...options });
      anims.add(a);
      const done = () => anims.delete(a);
      a.finished.then(done, done);
      return a;
    } catch { return null; }
  }

  function mk(cls, css, html, parent) {
    const e = document.createElement('div');
    e.className = cls;
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    (parent || layer).append(e);
    return e;
  }
  const expire = (e, ms) => later(() => e.remove(), ms);

  // ---------- where things are ----------

  function rectOf(e) {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, el: e };
  }

  function spot(id, view) {
    const esc = String(id ?? '').replace(/["\\]/g, '');
    const sels = id && view && id === view.youId
      ? ['#my-badge .pbadge', '#my-badge']
      : [`.opp-tile[data-player="${esc}"]`, `.opp-badge[data-player="${esc}"] .pbadge`, `.opp-compact[data-player="${esc}"] .pbadge`,
        `#opponents [data-player="${esc}"] .pb-avatar`, `.vtile[data-player="${esc}"]`];
    for (const s of sels) {
      let r = null;
      try { r = rectOf(document.querySelector(s)); } catch { /* bad selector */ }
      if (r) return r;
    }
    return { x: W / 2, y: H * 0.4, w: 90, h: 60, el: null };
  }

  const pileRect = () => rectOf(document.querySelector('#stage-center .discard')) ?? { x: W / 2, y: H / 2, w: 70, h: 105, el: null };
  const deckRect = () => rectOf(document.querySelector('#stage-center .deck')) ?? pileRect();
  const nameOf = (id, view) => view?.players?.find((p) => p.id === id)?.name ?? 'Someone';

  // ---------- particles (canvas) ----------

  function P(o) {
    if (parts.length >= MAX_PARTS) {
      if (!o.pri) return;
      parts[(Math.random() * parts.length) | 0] = parts[parts.length - 1];
      parts.pop();
    }
    parts.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, age: 0, life: 1, size: 3, color: '#fff', rot: 0, vr: 0, kind: 'dot', flut: 0, fph: rnd(0, 6.28), sway: 0, grow: 0, a0: 1, ...o });
    ensure();
  }

  function burst(x, y, n, o = {}) {
    const { speed = [100, 400], angle = [0, Math.PI * 2], kind = 'spark', colors = ['#fff'], g = 500, drag = 1.4, life = [0.5, 1], size = [2, 4], pri = 0 } = o;
    for (let i = 0; i < n; i++) {
      const a = rnd(angle[0], angle[1]);
      const s = rnd(speed[0], speed[1]);
      P({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g, drag, life: rnd(life[0], life[1]), size: rnd(size[0], size[1]), color: pick(colors), kind, pri });
    }
  }

  function dust(x, y, n, spread, k) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283);
      P({ x: x + Math.cos(a) * spread, y: y + Math.sin(a) * spread * 0.7, vx: Math.cos(a) * rnd(40, 130) * k, vy: Math.sin(a) * rnd(20, 80) * k, drag: 3, life: rnd(0.5, 0.9), size: rnd(5, 11) * k, color: '#d8d2ff', kind: 'dust', a0: 0.3, grow: 1.6 });
    }
  }

  function explode(x, y, colors, n) {
    const k = S();
    burst(x, y, n, { speed: [90 * k, 380 * k], colors, g: 240, drag: 1.7, life: [0.9, 1.6], size: [1.8, 3.2], kind: 'spark', pri: 1 });
    burst(x, y, Math.round(n / 4), { speed: [30 * k, 200 * k], colors: ['#fff', ...colors], g: 120, drag: 1.2, life: [1, 1.8], size: [1.5, 2.5], kind: 'dot', pri: 1 });
    P({ x, y, kind: 'dot', size: 46 * k, life: 0.28, color: '#fff', a0: 0.6, pri: 1 });
  }

  function shell(x, ty, colors, n) {
    const d = Math.max(60, H - ty);
    const g = 450;
    P({ x, y: H + 8, vx: rnd(-25, 25), vy: -Math.sqrt(2 * g * d), g, drag: 0, life: 4, size: 3, color: '#ffe9b0', kind: 'shell', ty, colors, n, pri: 1 });
  }

  function cannon(side, n, colors) {
    const x = side < 0 ? -6 : W + 6;
    const y = H + 6;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + side * -rnd(0.12, 0.85);
      const s = H * rnd(1.0, 2.05);
      P({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 700, drag: 2.2, life: rnd(3.4, 5), size: rnd(7, 12) * Math.max(0.75, S()), color: pick(colors), kind: 'conf', rot: rnd(0, 6.28), vr: rnd(-12, 12), flut: rnd(6, 14), sway: rnd(15, 55) });
    }
    burst(x, y, 12, { speed: [200, 700], angle: side < 0 ? [-1.5, -0.2] : [-2.9, -1.6], colors: ['#fff', '#ffd23f'], g: 300, drag: 3, life: [0.2, 0.4], size: [2, 3.5], pri: 1 });
  }

  function update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 90 || p.x < -140 || p.x > W + 140) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt + (p.sway ? Math.sin(p.fph) * p.sway * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.fph += p.flut * dt;
      if (p.kind === 'shell') {
        if (Math.random() < 0.9) P({ x: p.x, y: p.y, vx: rnd(-18, 18), vy: rnd(10, 50), g: 80, drag: 1, life: rnd(0.3, 0.6), size: 1.6, color: '#ffd9a0', kind: 'dot' });
        if (p.y <= p.ty || p.vy > -40) {
          const at = parts.indexOf(p);
          if (at >= 0) { parts[at] = parts[parts.length - 1]; parts.pop(); }
          explode(p.x, p.y, p.colors, p.n);
        }
      }
    }
    for (let i = bodies.length - 1; i >= 0; i--) if (stepBody(bodies[i], dt)) bodies.splice(i, 1);
  }

  function star(c, r) {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.28 : r;
      const a = (Math.PI / 4) * i - Math.PI / 2;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const additive of [false, true]) {
      ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      for (const p of parts) {
        const add = p.kind === 'spark' || p.kind === 'dot' || p.kind === 'star' || p.kind === 'shell';
        if (add !== additive) continue;
        const t = p.age / p.life;
        const a = p.a0 * (t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        if (p.kind === 'conf') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.fph));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
          ctx.restore();
        } else if (p.kind === 'dust') {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + p.grow * t), 0, 6.283);
          ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          ctx.stroke();
        } else if (p.kind === 'star') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          const tw = 0.6 + 0.4 * Math.sin(p.fph);
          ctx.globalAlpha = a * tw;
          ctx.fillStyle = p.color;
          star(ctx, p.size * (0.7 + 0.5 * tw));
          ctx.restore();
        } else { // dot / shell: a soft glowing point
          ctx.fillStyle = p.color;
          ctx.globalAlpha = a * 0.3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.2, 0, 6.283);
          ctx.fill();
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, 6.283);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function ensure() {
    if (raf) return;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }

  function tick(ts) {
    raf = 0;
    try {
      const dt = lastTs ? clamp((ts - lastTs) / 1000, 0.001, 1 / 30) : 1 / 60;
      lastTs = ts;
      clock += dt;
      update(dt);
      draw();
    } catch (e) { parts.length = 0; }
    if (parts.length || bodies.length) raf = requestAnimationFrame(tick);
    else { lastTs = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  // ---------- physical flying cards (DOM + integrator) ----------

  /** Face-down cards fly from `src` to a little heap beside `dst`, bounce, settle, then slide into the chip. */
  function spray(src, dst, n) {
    n = Math.min(n, 12, MAX_BODIES - bodies.length);
    if (n <= 0 || reduced()) return;
    const k = S();
    const cw = Math.round(clamp(46 * k, 26, 58));
    const ch = Math.round(cw * 1.5);
    let dx = src.x - dst.x;
    let dy = src.y - dst.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const heap = {
      x: clamp(dst.x + dx * (dst.w / 2 + cw * 0.55), cw, W - cw),
      y: clamp(dst.y + dy * (dst.h / 2 + ch * 0.45), ch * 0.6, H - ch * 0.6),
    };
    const group = { total: n, rested: 0, absorbAt: 0, dst };
    for (let i = 0; i < n; i++) {
      const el = mk('fx-card', `width:${cw}px;height:${ch}px;--cw:${cw}px;display:none`);
      const shadow = mk('fx-shadow', `width:${cw}px;height:${ch}px;display:none`);
      const tx = heap.x + rnd(-cw * 0.55, cw * 0.55);
      const ty = heap.y + rnd(-ch * 0.22, ch * 0.22);
      const x0 = src.x + rnd(-6, 6);
      const y0 = src.y + rnd(-6, 6);
      const vz = rnd(600, 860) * Math.max(0.7, k);
      const air = (2 * vz) / GRAV;
      bodies.push({
        el, shadow, group, cw, ch, state: 'wait', start: clock + i * 0.06,
        x: x0, y: y0, z: 0, vx: ((tx - x0) * 0.8) / air, vy: ((ty - y0) * 0.8) / air, vz,
        rot: rnd(0, 6.28), vr: rnd(-9, 9), tum: rnd(0, 3), vt: rnd(9, 17), tx, ty, ax: 0, ay: 0, t: 0, born: 0,
      });
    }
    ensure();
  }

  function stepBody(b, dt) {
    if (b.state === 'wait') {
      if (clock < b.start) return false;
      b.state = 'fly'; b.born = clock;
      b.el.style.display = ''; b.shadow.style.display = '';
    }
    if (b.state === 'fly') {
      b.vz -= GRAV * dt;
      b.z += b.vz * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.tum += b.vt * dt;
      if (b.z <= 0) {
        b.z = 0;
        if (Math.abs(b.vz) > 140) {
          b.vz = -b.vz * 0.45; // restitution
          b.vx *= 0.72; b.vy *= 0.72; b.vr *= 0.6;
          dust(b.x, b.y, 2, 4, 0.6);
        } else { b.vz = 0; b.state = 'slide'; }
      }
    }
    if (b.state === 'slide') {
      // On the table: friction plus a gentle pull toward the heap, like it slid there.
      const f = Math.exp(-4.5 * dt);
      b.vx = (b.vx + (b.tx - b.x) * 22 * dt) * f;
      b.vy = (b.vy + (b.ty - b.y) * 22 * dt) * f;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vr *= Math.exp(-6 * dt);
      b.rot += b.vr * dt;
      b.tum += (Math.round(b.tum / Math.PI) * Math.PI - b.tum) * Math.min(1, 14 * dt);
      if (Math.hypot(b.vx, b.vy) < 12 && Math.hypot(b.tx - b.x, b.ty - b.y) < 8 && clock - b.born > 0.5) {
        b.state = 'rest'; b.vx = b.vy = 0;
        b.group.rested++;
        if (b.group.rested >= b.group.total) b.group.absorbAt = clock + 0.4;
      }
    }
    if (clock - b.born > 3 && b.state !== 'absorb') { if (b.state !== 'rest') { b.state = 'rest'; b.group.rested++; } if (!b.group.absorbAt) b.group.absorbAt = clock; }
    if (b.state === 'rest' && b.group.absorbAt && clock >= b.group.absorbAt) { b.state = 'absorb'; b.t = 0; b.ax = b.x; b.ay = b.y; }
    let sc = 1; let op = 1; let x = b.x; let y = b.y;
    if (b.state === 'absorb') {
      b.t += dt / 0.3;
      const e = Math.min(1, b.t) ** 2;
      x = b.ax + (b.group.dst.x - b.ax) * e;
      y = b.ay + (b.group.dst.y - b.ay) * e;
      sc = 1 - 0.7 * e; op = 1 - e;
      if (b.t >= 1) { b.el.remove(); b.shadow.remove(); return true; }
    }
    const s = (1 + b.z / 520) * sc;
    const sh = sc * (1 - b.z / 900);
    b.el.style.opacity = op;
    b.el.style.transform = `translate3d(${x - b.cw / 2}px,${y - b.ch / 2 - b.z}px,0) rotate(${b.rot}rad) scale(${s},${s * Math.cos(b.tum)})`;
    b.shadow.style.opacity = String(0.5 * op * (1 - Math.min(0.85, b.z / 300)));
    b.shadow.style.transform = `translate3d(${x - b.cw / 2 + 3}px,${y - b.ch / 2 + 5}px,0) rotate(${b.rot}rad) scale(${sh},${sh * Math.max(0.35, Math.abs(Math.cos(b.tum)))})`;
    return false;
  }

  // ---------- reusable visual bits ----------

  function ring(x, y, color, o = {}) {
    const { r0 = 20, r1 = 200, ms = 650, delay = 0, a = 0.85, inner = 74 } = o;
    const e = mk('fx-ring', `left:${x - 100}px;top:${y - 100}px;background:radial-gradient(circle closest-side,transparent ${inner}%,${color} ${inner + 16}%,transparent 100%)`);
    A(e, [{ transform: `scale(${r0 / 100})`, opacity: a }, { opacity: a * 0.7, offset: 0.4 }, { transform: `scale(${r1 / 100})`, opacity: 0 }], { duration: ms, delay, easing: 'cubic-bezier(.15,.7,.3,1)' });
    expire(e, ms + delay + 80);
  }

  function disc(x, y, r, color, ms, a = 0.7) {
    const e = mk('fx-disc', `left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;--c:${color}`);
    A(e, [{ opacity: 0 }, { opacity: a, offset: 0.25 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    expire(e, ms + 80);
  }

  function floatText(text, x, y, color, size) {
    const e = mk('fx-float', `left:${clamp(x, 30, W - 30)}px;top:${clamp(y, 30, H - 30)}px;--c:${color};--fs:${size}px`, text);
    A(e, [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
      { transform: 'translate(-50%,-60%) scale(1.45)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.28 },
      { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%,-190%) scale(.95)', opacity: 0 },
    ], { duration: 1500, easing: 'ease-out' });
    expire(e, 1600);
  }

  function shake(amp, ms, rotAmp = 0) {
    const st = document.getElementById('stage');
    if (!st || reduced() || shaking) return;
    shaking = true;
    const n = 10;
    const kf = [{ translate: '0 0', rotate: '0deg' }];
    for (let i = 1; i <= n; i++) {
      const d = 1 - i / (n + 1);
      kf.push({ translate: `${rnd(-1, 1) * amp * d}px ${rnd(-1, 1) * amp * d}px`, rotate: `${rnd(-1, 1) * rotAmp * d}deg` });
    }
    kf.push({ translate: '0 0', rotate: '0deg' });
    const done = () => { shaking = false; };
    const a = A(st, kf, { duration: ms, easing: 'linear', fill: 'none' });
    if (a) a.finished.then(done, done); else done();
    later(done, ms + 100);
  }

  function flash(ms = 380, a = 0.95) {
    const e = mk('fx-flash');
    A(e, [{ opacity: a }, { opacity: a * 0.85, offset: 0.2 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
    expire(e, ms + 60);
  }

  function vignette(ms = 750) {
    const e = mk('fx-vignette');
    A(e, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], { duration: ms });
    expire(e, ms + 60);
  }

  /** Brief non-moving highlight over a chip (also used for reduced motion). */
  function chipFlash(r, color) {
    const e = mk('fx-chipglow', `left:${r.x - r.w / 2 - 4}px;top:${r.y - r.h / 2 - 4}px;width:${r.w + 8}px;height:${r.h + 8}px;--c:${color}`);
    A(e, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: 800 });
    expire(e, 900);
  }

  function jolt(chip, power = 1) {
    if (!chip || reduced()) return;
    const a = 12 * power;
    A(chip, [
      { translate: '0 0', scale: '1 1' },
      { translate: `${-a}px 0`, scale: '1.1 .88', offset: 0.14 },
      { translate: `${a * 0.8}px 0`, scale: '.95 1.06', offset: 0.38 },
      { translate: `${-a * 0.4}px 0`, scale: '1.03 .98', offset: 0.62 },
      { translate: `${a * 0.15}px 0`, scale: '1 1', offset: 0.82 },
      { translate: '0 0', scale: '1 1' },
    ], { duration: 560, easing: 'ease-out', fill: 'none' });
  }

  function pulse(chip, to = 1.15, times = 1, ms = 520) {
    if (!chip || reduced()) return;
    const kf = [{ scale: '1' }];
    for (let i = 0; i < times; i++) kf.push({ scale: String(to) }, { scale: '.97' });
    kf.push({ scale: '1' });
    A(chip, kf, { duration: ms * times, easing: 'ease-in-out', fill: 'none' });
  }

  function glowChip(chip, color, ms = 900, size = 22) {
    if (!chip || reduced()) return;
    A(chip, [{ filter: `drop-shadow(0 0 0 ${color})` }, { filter: `drop-shadow(0 0 ${size}px ${color}) brightness(1.25)`, offset: 0.25 }, { filter: `drop-shadow(0 0 ${size}px ${color}) brightness(1.1)`, offset: 0.6 }, {}], { duration: ms, fill: 'none' });
  }

  /** A stamp that slams down: scale from big to 1 with overshoot and bounce, lingers, then peels away. */
  function slam(e, o = {}) {
    const { from = 3, r0 = -22, r1 = -6, ms = 650, hold = 1000, peel = 420 } = o;
    A(e, [
      { transform: `translate(-50%,-50%) scale(${from}) rotate(${r0}deg)`, opacity: 0 },
      { transform: `translate(-50%,-50%) scale(.86) rotate(${r1}deg)`, opacity: 1, offset: 0.34 },
      { transform: `translate(-50%,-50%) scale(1.1) rotate(${r1}deg)`, offset: 0.52 },
      { transform: `translate(-50%,-50%) scale(.97) rotate(${r1}deg)`, offset: 0.72 },
      { transform: `translate(-50%,-50%) scale(1) rotate(${r1}deg)` },
    ], { duration: ms, easing: 'cubic-bezier(.3,.1,.5,1)' });
    A(e, [
      { transform: `translate(-50%,-50%) scale(1) rotate(${r1}deg)`, opacity: 1 },
      { transform: `translate(-30%,-120%) scale(1.15) rotate(${r1 + 24}deg)`, opacity: 0 },
    ], { duration: peel, delay: ms + hold, easing: 'ease-in' });
    expire(e, ms + hold + peel + 100);
  }

  /** Fade a centred element in and out without moving it (reduced motion). */
  function still(e, ms) {
    A(e, [{ opacity: 0, transform: 'translate(-50%,-50%)' }, { opacity: 1, transform: 'translate(-50%,-50%)', offset: 0.15 }, { opacity: 1, transform: 'translate(-50%,-50%)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-50%)' }], { duration: ms });
    expire(e, ms + 100);
  }

  // ---------- card impact ----------

  function impact(m) {
    const pr = pileRect();
    const col = COLORS[m.color] ?? '#cfc6ff';
    const k = S();
    const power = { wild4: 1.7, draw2: 1.3, wild: 1.3, skip: 1.15, reverse: 1.1 }[m.value] ?? 1;
    const size = Math.max(pr.w, pr.h);
    if (reduced()) { disc(pr.x, pr.y, size * 0.9, col, 600, 0.5); return; }
    ring(pr.x, pr.y, col, { r0: size * 0.35, r1: size * (1.5 + power * 0.6), ms: 650 });
    ring(pr.x, pr.y, '#ffffff', { r0: size * 0.3, r1: size * (1.1 + power * 0.4), ms: 520, delay: 70, a: 0.45 });
    // The cards already on the pile get shoved and settle back with a spring.
    const trails = [...document.querySelectorAll('#stage-center .discard .trail')];
    const top = trails[trails.length - 1];
    trails.slice(0, -1).forEach((el, i) => {
      const a = rnd(0, 6.283);
      const d = (5 + 4 * power) * k * (1 - i * 0.08);
      const dx = Math.cos(a) * d; const dy = Math.sin(a) * d; const r = rnd(-5, 5) * power;
      A(el, [
        { translate: '0 0', rotate: '0deg' },
        { translate: `${dx}px ${dy}px`, rotate: `${r}deg`, offset: 0.16 },
        { translate: `${-dx * 0.5}px ${-dy * 0.5}px`, rotate: `${-r * 0.4}deg`, offset: 0.42 },
        { translate: `${dx * 0.18}px ${dy * 0.18}px`, rotate: `${r * 0.12}deg`, offset: 0.7 },
        { translate: '0 0', rotate: '0deg' },
      ], { duration: 640, easing: 'ease-out', fill: 'none' });
    });
    if (top) A(top, [{ scale: '1.16 .88' }, { scale: '.96 1.06', offset: 0.35 }, { scale: '1.03 .98', offset: 0.65 }, { scale: '1 1' }], { duration: 480, easing: 'ease-out', fill: 'none' });
    burst(pr.x, pr.y, Math.round(10 + 8 * power), { colors: [col, '#fff'], speed: [110 * k, 380 * k * power], g: 600, drag: 2.2, life: [0.35, 0.7], size: [1.8, 3.4], pri: 1 });
    dust(pr.x, pr.y, 7, pr.w * 0.45, k);
  }

  function colorWave(m) {
    const pr = pileRect();
    const col = COLORS[m.color] ?? '#fff';
    if (reduced()) { flash(500, 0.18); return; }
    const far = Math.hypot(Math.max(pr.x, W - pr.x), Math.max(pr.y, H - pr.y)) + 40;
    ring(pr.x, pr.y, col, { r0: 30, r1: far, ms: 1200, a: 0.9, inner: 62 });
    ring(pr.x, pr.y, '#ffffff', { r0: 20, r1: far * 0.75, ms: 950, delay: 120, a: 0.35, inner: 80 });
    disc(pr.x, pr.y, far * 0.5, col, 900, 0.22);
    const swirl = document.getElementById('swirl');
    if (swirl) {
      A(swirl, [{ filter: `brightness(2.6) saturate(1.6) drop-shadow(0 0 30px ${col})` }, { filter: `brightness(1.8) drop-shadow(0 0 20px ${col})`, offset: 0.4 }, {}], { duration: 900, fill: 'none' });
      A(swirl, [{ scale: '1' }, { scale: '1.18', offset: 0.25 }, { scale: '0.97', offset: 0.55 }, { scale: '1' }], { duration: 700, fill: 'none', easing: 'ease-out' });
    }
    const k = S();
    for (let i = 0; i < 26; i++) {
      const a = rnd(0, 6.283);
      const s = rnd(120, 520) * k;
      P({ x: pr.x, y: pr.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 1.6, g: 120, life: rnd(0.8, 1.5), size: rnd(3, 6) * k, color: pick(RAINBOW), kind: i % 2 ? 'star' : 'dot', vr: rnd(-3, 3), flut: rnd(8, 16), pri: 1 });
    }
  }

  // ---------- penalties ----------

  function hit(r, n, power, label) {
    const k = S();
    if (reduced()) { chipFlash(r, '#ff6a3d'); floatText(label ?? `+${n}`, r.x, r.y - r.h / 2, '#ff7a45', 40 * k); return; }
    const base = Math.max(r.w, r.h);
    ring(r.x, r.y, '#ff5a3c', { r0: base * 0.2, r1: base * 0.7 + 50 * power, ms: 620 });
    ring(r.x, r.y, '#ffb347', { r0: base * 0.15, r1: base * 0.55 + 40 * power, ms: 520, delay: 90, a: 0.6 });
    jolt(r.el, power);
    floatText(label ?? `+${n}`, r.x, r.y - r.h / 2 - 4, '#ff7a45', 46 * k * (0.85 + power * 0.22));
    if (power >= 2) burst(r.x, r.y, 26, { colors: ['#ff6a3d', '#ffd23f', '#fff'], speed: [150 * k, 520 * k], g: 700, drag: 2, life: [0.4, 0.8], size: [2, 4], pri: 1 });
    if (power >= 3) { shake(11, 400, 0.5); vignette(); }
  }

  /** Cards spray from the pile or deck to the victim; the chip reacts when the first one lands. */
  function penalty(victimId, n, view, from, power, label) {
    const dst = spot(victimId, view);
    spray(from === 'deck' ? deckRect() : pileRect(), dst, n);
    later(() => hit(spot(victimId, view), n, power, label), reduced() ? 0 : 560);
  }

  function playFx(m, view) {
    impact(m);
    if (m.value === 'wild' || m.value === 'wild4') colorWave(m);
    if (m.value === 'reverse') reverseFx();
    if (m.value === 'skip') skipFx(m, view);
    if ((m.value === 'draw2' || m.value === 'wild4') && m.target) {
      const n = m.count || (m.value === 'wild4' ? 4 : 2);
      penalty(m.target, n, view, 'pile', m.value === 'wild4' || n >= 4 ? 3 : 1.4);
    }
  }

  function reverseFx() {
    const pr = pileRect();
    const k = S();
    const swirl = document.getElementById('swirl');
    if (reduced()) { disc(pr.x, pr.y, 90, '#c4b5fd', 500, 0.4); return; }
    if (swirl) A(swirl, [{ rotate: '0deg', filter: 'brightness(2.4) drop-shadow(0 0 24px #fff)' }, { rotate: '360deg', filter: 'brightness(1.5) drop-shadow(0 0 14px #c4b5fd)', offset: 0.7 }, { rotate: '360deg' }], { duration: 760, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'none' });
    ring(pr.x, pr.y, '#c4b5fd', { r0: 40, r1: 260 * k + 40, ms: 700 });
    ring(pr.x, pr.y, '#67e8f9', { r0: 30, r1: 200 * k + 30, ms: 640, delay: 120, a: 0.7 });
    const e = mk('fx-word', `left:${pr.x}px;top:${pr.y - pr.h * 0.75}px;--c:#a78bfa;--fs:${34 * k}px`, '\u21C4 REVERSE');
    A(e, [{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-60%) scale(1.15)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.65 }, { transform: 'translate(-50%,-110%) scale(1)', opacity: 0 }], { duration: 1000, easing: 'ease-out' });
    expire(e, 1100);
  }

  // ---------- skip ----------

  function skipFx(m, view) {
    if (!m.target) return;
    const r = spot(m.target, view);
    const k = S();
    const size = Math.round(clamp(150 * k, 96, 190));
    const x = clamp(r.x, size / 2, W - size / 2);
    const y = clamp(r.y, size / 2 + 6, H - size / 2);
    const svg = `<svg viewBox="0 0 160 160" width="${size}" height="${size}"><circle cx="80" cy="80" r="68" fill="rgba(22,10,45,.62)" stroke="#ff3b52" stroke-width="14"/><line x1="33" y1="127" x2="127" y2="33" stroke="#ff3b52" stroke-width="14" stroke-linecap="round"/></svg>`
      + `<span class="fx-skip-word" style="font-size:${size * 0.3}px">SKIP</span>`;
    const e = mk('fx-stamp', `left:${x}px;top:${y}px;width:${size}px;height:${size}px;--c:#ff3b52`, svg);
    if (reduced()) { chipFlash(r, '#ff3b52'); still(e, 1300); return; }
    slam(e, { from: 3, r0: -26, r1: -9, ms: 620, hold: 900, peel: 420 });
    later(() => {
      ring(x, y, '#ff3b52', { r0: size * 0.3, r1: size * 1.1, ms: 520 });
      burst(x, y, 16, { colors: ['#ff3b52', '#fff', '#ffb0b8'], speed: [120 * k, 420 * k], g: 500, drag: 2.2, life: [0.3, 0.6], size: [2, 3.6], pri: 1 });
      jolt(r.el, 1.1);
      if (r.el) A(r.el, [{ filter: 'grayscale(1) brightness(.7)' }, { filter: 'grayscale(1) brightness(.7)', offset: 0.7 }, {}], { duration: 1500, fill: 'none' });
    }, 215);
  }

  // ---------- UNO, gotcha, out ----------

  function unoFx(m, view) {
    const r = spot(m.by, view);
    const k = S() * (m.mine ? 1.35 : 1);
    const size = 70 * k;
    const x = clamp(r.x, 90, W - 90);
    const y = clamp(r.y - r.h / 2 - size * 0.45, size * 0.7, H - 60);
    if (reduced()) { chipFlash(r, '#ffd23f'); floatText('UNO!', x, y, '#ffd23f', size * 0.8); return; }
    const rays = mk('fx-rays', `left:${x}px;top:${y}px;width:${size * 5}px;height:${size * 5}px;--c:${m.mine ? '#fff3a0' : '#ffd23f'}`);
    A(rays, [{ transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(40deg)', opacity: 0.95, offset: 0.25 }, { transform: 'translate(-50%,-50%) scale(1.15) rotate(90deg)', opacity: 0 }], { duration: 1200, easing: 'ease-out' });
    expire(rays, 1300);
    const e = mk('fx-word fx-uno', `left:${x}px;top:${y}px;--c:${m.mine ? '#ffe27a' : '#ff4d5e'};--fs:${size}px`, 'UNO!');
    A(e, [
      { transform: 'translate(-50%,-50%) scale(0) rotate(-14deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.5) rotate(6deg)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%,-50%) scale(.9) rotate(-3deg)', offset: 0.38 },
      { transform: 'translate(-50%,-50%) scale(1.08) rotate(1deg)', offset: 0.55 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.78 },
      { transform: 'translate(-50%,-90%) scale(1)', opacity: 0 },
    ], { duration: 1500, easing: 'cubic-bezier(.3,.1,.4,1)' });
    expire(e, 1600);
    ring(r.x, r.y, '#ffd23f', { r0: 20, r1: Math.max(r.w, r.h) * 0.8 + 40 * k, ms: 650 });
    pulse(r.el, m.mine ? 1.22 : 1.14, 2, 360);
    glowChip(r.el, '#ffd23f', 1100, m.mine ? 30 : 20);
    burst(x, y, m.mine ? 44 : 24, { colors: ['#ffd23f', '#fff', '#ff7ac8', '#67e8f9'], speed: [90 * k, 460 * k], g: 260, drag: 1.8, life: [0.5, 1.1], size: [2.2, 4.2], kind: 'star', pri: 1 });
    burst(x, y, m.mine ? 28 : 14, { colors: ['#ffd23f', '#fff'], speed: [150 * k, 560 * k], g: 500, drag: 2.2, life: [0.3, 0.7], size: [1.8, 3], pri: 1 });
    if (m.mine) ring(r.x, r.y, '#fff', { r0: 30, r1: Math.max(r.w, r.h) + 120, ms: 850, delay: 120, a: 0.6 });
  }

  function caughtFx(m, view) {
    const victim = spot(m.target, view);
    const k = S();
    const forgot = !m.by;
    const text = forgot ? 'FORGOT UNO!' : 'GOTCHA!';
    const size = (forgot ? 52 : 66) * k;
    const x = clamp(victim.x, size * 2.2, W - size * 2.2);
    const y = clamp(victim.y - victim.h / 2 - size * 0.9, size, H - size * 1.5);
    if (!forgot) { if (!reduced()) flash(420, 0.96); else flash(300, 0.2); }
    const e = mk('fx-gotcha', `left:${x}px;top:${y}px;--fs:${size}px`,
      `<span class="fx-word fx-gotcha-word" style="--c:#ff3b52">${text}</span><span class="fx-busted" style="font-size:${size * 0.34}px">BUSTED</span>`);
    if (reduced()) still(e, 1500);
    else {
      slam(e, { from: 2.7, r0: 10, r1: -5, ms: 560, hold: 1000, peel: 420 });
      later(() => {
        ring(x, y, '#ff3b52', { r0: size * 0.5, r1: size * 3, ms: 560 });
        burst(x, y, 22, { colors: ['#ff3b52', '#fff', '#ffd23f'], speed: [150 * k, 520 * k], g: 600, drag: 2, life: [0.3, 0.7], size: [2, 3.6], pri: 1 });
        shake(9, 380, 0.5);
      }, 190);
    }
    if (m.by) {
      const c = spot(m.by, view);
      if (reduced()) chipFlash(c, '#ffd23f');
      else {
        pulse(c.el, 1.18, 2, 340);
        glowChip(c.el, '#ffd23f', 1000, 22);
        ring(c.x, c.y, '#ffd23f', { r0: 20, r1: Math.max(c.w, c.h) * 0.8 + 40, ms: 650 });
        burst(c.x, c.y, 18, { colors: GOLD, speed: [100 * k, 380 * k], g: 400, drag: 2, life: [0.5, 1], size: [2, 3.6], kind: 'star', pri: 1 });
      }
    }
    later(() => penalty(m.target, m.count || 2, view, 'deck', 1.4), reduced() ? 0 : 650);
  }

  const ORD = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];

  function outFx(m, view) {
    const r = spot(m.by, view);
    const k = S();
    const label = ORD[m.place] ?? `${m.place}TH`;
    const gold = m.place === 1;
    const e = mk('fx-place', `left:${clamp(r.x, 50, W - 50)}px;top:${clamp(r.y - r.h / 2, 40, H - 40)}px;--fs:${34 * k}px;--g:${gold ? '#ffd23f,#ff9f1c' : '#f3f4f6,#9ca3af'}`, label);
    if (reduced()) { chipFlash(r, '#ffd23f'); still(e, 1800); return; }
    A(e, [{ transform: 'translate(-50%,-30%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1.3)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-120%) scale(1)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%,-190%) scale(1)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-230%) scale(1)', opacity: 0 }], { duration: 2200, easing: 'ease-out' });
    expire(e, 2300);
    pulse(r.el, 1.15, 1, 450);
    for (let i = 0; i < 46; i++) {
      const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
      const s = rnd(250, 780) * k;
      P({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 800, drag: 1.9, life: rnd(1.6, 2.6), size: rnd(6, 10) * Math.max(0.75, k), color: pick(CONFETTI), kind: 'conf', rot: rnd(0, 6), vr: rnd(-12, 12), flut: rnd(6, 14), sway: rnd(10, 40) });
    }
  }

  // ---------- the win ----------

  const TROPHY = '<svg viewBox="0 0 120 140" class="fx-trophy-svg"><defs><linearGradient id="fx-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a86a05"/><stop offset=".3" stop-color="#ffe27a"/><stop offset=".6" stop-color="#ffc22e"/><stop offset="1" stop-color="#9a5f04"/></linearGradient></defs>'
    + '<path d="M30 22H12c0 22 8 36 25 41" fill="none" stroke="url(#fx-gold)" stroke-width="8" stroke-linecap="round"/><path d="M90 22h18c0 22-8 36-25 41" fill="none" stroke="url(#fx-gold)" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="M28 10h64v38c0 24-14 38-32 38S28 72 28 48z" fill="url(#fx-gold)" stroke="#fff3b0" stroke-width="2"/><path d="M38 16h8v34c0 14 5 22 12 28-14-3-20-14-20-30z" fill="#fff" opacity=".35"/>'
    + '<polygon points="60,26 65,40 80,40 68,49 72,63 60,54 48,63 52,49 40,40 55,40" fill="#fff8d0" opacity=".9"/>'
    + '<rect x="53" y="84" width="14" height="20" fill="url(#fx-gold)"/><path d="M36 104h48l6 14H30z" fill="url(#fx-gold)" stroke="#fff3b0" stroke-width="1.5"/><rect x="26" y="118" width="68" height="16" rx="5" fill="#7a4a05" stroke="#ffd23f" stroke-width="2"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function winFx(m, view) {
    const tier = clamp(m.tier || 1, 1, 4);
    const you = m.winnerId === view?.youId;
    const name = nameOf(m.winnerId, view);
    const k = S();
    const rm = reduced();
    const winner = spot(m.winnerId, view);
    const score = Math.max(0, Math.round(m.winnerScore || 0));
    const t0 = tier === 4 && !rm ? 1200 : 0;

    const root = mk('fx-win');
    const bs = Math.round((tier === 4 ? 96 : tier === 3 ? 88 : 80) * k);
    const trophySize = Math.round((tier === 4 ? 210 : 150) * k);
    const stack = mk('fx-stack', null, null, root);
    const banner = mk('fx-banner' + (you ? '' : ' fx-other'), `--bs:${bs}px`, you ? 'YOU WIN!' : `<span class="fx-who">${esc(name.toUpperCase())}</span><span>WINS!</span>`, stack);
    const tag = tier === 4 ? mk('fx-tag', `--ts:${Math.round(bs * 0.6)}px`, 'LEGENDARY!', stack) : null;
    let trophy = null; let rays = null;
    if (tier >= 3) {
      if (tier === 4) rays = mk('fx-rays fx-trophy-rays', `--c:#ffe27a;width:${trophySize * 4.4}px;height:${trophySize * 4.4}px;left:50%;top:50%`, null, root);
      trophy = mk('fx-trophy', `width:${trophySize}px;height:${Math.round(trophySize * 1.17)}px`, TROPHY, stack);
    }
    const scoreEl = tier >= 2 ? mk('fx-score', `--ss:${Math.round(44 * k * (tier >= 3 ? 1.1 : 0.9))}px`, '+0 pts', stack) : null;

    // The winner's chip: a gold glow with a crown.
    const glow = mk('fx-chipglow fx-win-glow', `left:${winner.x - winner.w / 2 - 6}px;top:${winner.y - winner.h / 2 - 6}px;width:${winner.w + 12}px;height:${winner.h + 12}px;--c:${tier >= 3 ? '#ffd23f' : '#ffe27a'}`, null, root);
    const crown = mk('fx-crown', `left:${winner.x}px;top:${winner.y - winner.h / 2 - 6}px;--fs:${26 * k}px`, '\uD83D\uDC51', root);
    A(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: t0 });
    A(crown, [{ opacity: 0, transform: 'translate(-50%,-250%) rotate(-30deg)' }, { opacity: 1, transform: 'translate(-50%,-100%) rotate(8deg)', offset: 0.7 }, { opacity: 1, transform: 'translate(-50%,-100%) rotate(0deg)' }], { duration: rm ? 1 : 700, delay: t0 + 200, easing: 'cubic-bezier(.3,1.5,.5,1)' });

    const enter = (el, delay, ms, r = -6) => {
      if (!el) return;
      if (rm) { A(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay }); return; }
      A(el, [
        { transform: `scale(0) rotate(${r}deg)`, opacity: 0 },
        { transform: 'scale(1.3) rotate(2deg)', opacity: 1, offset: 0.4 },
        { transform: 'scale(.92) rotate(-1deg)', offset: 0.62 },
        { transform: 'scale(1.04) rotate(0deg)', offset: 0.82 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ], { duration: ms, delay, easing: 'cubic-bezier(.3,.1,.4,1)' });
    };
    enter(banner, t0 + 30, 850);
    enter(tag, t0 + 410, 800, 4);
    enter(scoreEl, t0 + (tier >= 3 ? 900 : 500), 500);

    // Score counts up with little pops.
    if (scoreEl) {
      if (rm) scoreEl.textContent = `+${score} pts`;
      else {
        const start = t0 + (tier >= 3 ? 1000 : 600);
        const steps = 22;
        for (let i = 1; i <= steps; i++) {
          later(() => {
            scoreEl.textContent = `+${Math.round(score * (1 - Math.pow(1 - i / steps, 2)))} pts`;
            if (i % 5 === 0 || i === steps) A(scoreEl, [{ scale: '1' }, { scale: i === steps ? '1.35' : '1.14' }, { scale: '1' }], { duration: i === steps ? 450 : 200, fill: 'none' });
          }, start + i * 60);
        }
      }
    }

    if (rm) { if (tier >= 3) later(() => flash(400, 0.25), 100); return; }

    // Tier 4: the drumroll before the reveal (dim, pulse, shake, converging rings), then a white flash.
    if (tier === 4) {
      const dim = mk('fx-dim', null, null, root);
      A(dim, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.6, offset: 0.5 }, { opacity: 1, offset: 0.75 }, { opacity: 1, offset: 0.95 }, { opacity: 0 }], { duration: t0 + 450, easing: 'ease-in-out' });
      const vg = mk('fx-vignette', null, null, root);
      A(vg, [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }], { duration: 260, iterations: Math.ceil(t0 / 260), easing: 'ease-in-out' });
      for (let i = 0; i < 5; i++) later(() => { ring(W / 2, H * 0.45, '#ffd23f', { r0: Math.min(W, H) * 0.7, r1: 30, ms: 420, a: 0.7 }); shake(3 + i, 260, 0.2); }, i * 240);
      later(() => { flash(700, 1); shake(18, 520, 1.2); }, t0);
    }

    // Confetti cannons from the bottom corners.
    const waves = tier === 1 ? [0, 1200] : tier === 2 ? [0, 1500] : tier === 3 ? [0, 1800] : [0, 1500, 3000];
    const perSide = tier === 1 ? 32 : tier === 2 ? 34 : tier === 3 ? 36 : 40;
    waves.forEach((w, i) => later(() => {
      const cols = i % 2 ? GOLD.concat(CONFETTI) : CONFETTI;
      cannon(-1, perSide, cols); cannon(1, perSide, cols);
      if (i === 0 || tier === 4) shake(tier >= 3 ? 7 : 4, 260, 0.3);
    }, t0 + w));
    if (tier === 4) {
      const far = Math.hypot(W, H);
      later(() => RAINBOW.forEach((c, i) => ring(W / 2, H * 0.45, c, { r0: 30, r1: far * 0.8, ms: 1300, delay: i * 70, a: 0.8, inner: 70 })), t0);
    } else if (tier === 3) {
      later(() => ring(W / 2, H * 0.45, '#ffd23f', { r0: 30, r1: Math.max(W, H) * 0.7, ms: 1000, a: 0.7, inner: 70 }), 650);
    }

    // Fireworks: shells with trails, bursting with gravity and additive glow.
    const shellCount = tier === 1 ? 0 : tier === 2 ? 4 : tier === 3 ? 7 : 18;
    const salvoAt = [0, 1200, 2600];
    for (let i = 0; i < shellCount; i++) {
      const at = tier === 4 ? t0 + salvoAt[Math.floor(i / 6)] + (i % 6) * 110 : 350 + i * (tier === 2 ? 480 : 420);
      later(() => shell(rnd(W * 0.12, W * 0.88), rnd(H * 0.14, H * 0.46), Math.random() < 0.5 ? [pick(RAINBOW), pick(RAINBOW)] : GOLD, tier === 4 ? 52 : 44), at);
    }
    // Star sparkles near the banner.
    if (tier >= 2) {
      for (let j = 0; j < 9; j++) {
        later(() => {
          for (let i = 0; i < 6; i++) P({ x: rnd(W * 0.15, W * 0.85), y: rnd(H * 0.12, H * 0.6), vx: rnd(-10, 10), vy: rnd(-20, 10), drag: 0.5, life: rnd(0.9, 1.8), size: rnd(5, 11) * k, color: pick(GOLD.concat(['#ffffff'])), kind: 'star', flut: rnd(5, 10), vr: rnd(-1, 1) });
        }, t0 + j * 450);
      }
    }

    // Spotlight beams sweeping from the top.
    if (tier >= 3) {
      const beams = tier === 4 ? 4 : 3;
      for (let i = 0; i < beams; i++) {
        const bw = Math.max(W, H) * 0.34;
        const b = mk('fx-beam', `left:${W * ((i + 0.5) / beams) - bw / 2}px;width:${bw}px;height:${H * 1.25}px;--c:${tier === 4 ? pick(RAINBOW) : '#fff3b0'}`, null, root);
        const d = i % 2 ? -1 : 1;
        A(b, [{ transform: `rotate(${-28 * d}deg)`, opacity: 0 }, { transform: `rotate(${-20 * d}deg)`, opacity: 0.9, offset: 0.12 }, { transform: `rotate(${24 * d}deg)`, opacity: 0.9, offset: 0.55 }, { transform: `rotate(${-22 * d}deg)`, opacity: 0.9, offset: 0.9 }, { transform: `rotate(${-22 * d}deg)`, opacity: 0.8 }], { duration: 4800, delay: t0 + i * 120, easing: 'ease-in-out' });
      }
    }

    // The trophy drops from the top with bounces and squash; landing shakes the table and sprays gold.
    if (trophy) {
      const dly = t0 + 250;
      const dur = 1300;
      A(trophy, [
        { transform: `translateY(${-H * 0.9}px) rotate(-18deg) scale(1)`, opacity: 1, easing: 'cubic-bezier(.5,0,.9,.6)' },
        { transform: 'translateY(0) rotate(0deg) scale(1.18,.8)', opacity: 1, offset: 0.46, easing: 'ease-out' },
        { transform: 'translateY(-70px) rotate(5deg) scale(.95,1.08)', offset: 0.62, easing: 'ease-in' },
        { transform: 'translateY(0) rotate(0) scale(1.08,.92)', offset: 0.76, easing: 'ease-out' },
        { transform: 'translateY(-22px) rotate(-2deg) scale(1)', offset: 0.87, easing: 'ease-in' },
        { transform: 'translateY(0) rotate(0) scale(1)', opacity: 1 },
      ], { duration: dur, delay: dly });
      const landing = (n, amp) => {
        const r = rectOf(trophy);
        if (!r) return;
        shake(amp, 420, 1);
        burst(r.x, r.y + r.h * 0.45, n, { colors: GOLD, speed: [150 * k, 650 * k], angle: [-Math.PI, 0], g: 900, drag: 1.8, life: [0.5, 1.1], size: [2, 4], pri: 1 });
        dust(r.x, r.y + r.h * 0.45, 8, r.w * 0.4, k);
        ring(r.x, r.y + r.h * 0.45, '#ffd23f', { r0: 20, r1: trophySize * 2.2, ms: 700 });
      };
      later(() => landing(34, tier === 4 ? 16 : 11), dly + dur * 0.46);
      later(() => landing(18, 6), dly + dur * 0.76);
      if (rays) {
        A(rays, [{ transform: 'translate(-50%,-50%) scale(.2) rotate(0deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(60deg)', opacity: 0.9, offset: 0.2 }, { transform: 'translate(-50%,-50%) scale(1.1) rotate(300deg)', opacity: 0.85 }], { duration: 4400, delay: dly + 450, easing: 'linear' });
        later(() => { const r = rectOf(trophy); if (r) { rays.style.left = `${r.x}px`; rays.style.top = `${r.y}px`; } }, dly + dur);
      }
      // Golden rain.
      for (let t = t0 + 700; t < t0 + 3600; t += 90) {
        later(() => {
          for (let i = 0; i < (tier === 4 ? 4 : 3); i++) P({ x: rnd(0, W), y: -10, vx: rnd(-30, 30), vy: rnd(80, 220), g: 380, drag: 1.4, life: rnd(2.6, 4), size: rnd(5, 9) * Math.max(0.75, k), color: pick(GOLD), kind: 'conf', rot: rnd(0, 6), vr: rnd(-9, 9), flut: rnd(8, 16), sway: rnd(8, 28) });
        }, t);
      }
    }
    if (tier === 4) later(() => glowChip(winner.el, '#ffd23f', 3600, 34), t0);
    // Failsafe in case clear() is never called.
    later(() => clear(), 20000);
  }

  // ---------- public API ----------

  function react(moments, view) {
    try {
      if (!moments || !moments.length || !init()) return;
      let afterPlay = 0;
      const hasOut = moments.some((m) => m.type === 'out');
      for (const m of moments) {
        switch (m.type) {
          case 'play':
            later(() => playFx(m, view), 750);
            afterPlay = 820;
            break;
          case 'take': {
            const n = m.count || 0;
            if (n >= 1) later(() => penalty(m.by, n, view, 'deck', n >= 4 ? 3 : 1.4), afterPlay);
            break;
          }
          case 'challenge': {
            const n = m.count || 0;
            const victim = m.right ? m.target : m.by;
            later(() => {
              const r = spot(m.by, view);
              floatText(m.right ? 'BUSTED!' : 'WRONG CALL!', r.x, r.y - r.h / 2 - 30, m.right ? '#ffd23f' : '#ff7a45', 36 * S());
              if (n >= 1) penalty(victim, n, view, 'pile', n >= 4 ? 3 : 1.4);
            }, afterPlay);
            break;
          }
          case 'caught': later(() => caughtFx(m, view), afterPlay); break;
          case 'uno': later(() => unoFx(m, view), afterPlay); break;
          case 'out': later(() => outFx(m, view), afterPlay + 60); break;
          case 'gameover': later(() => winFx(m, view), (hasOut ? 1100 : 300) + afterPlay); break;
          default: break;
        }
      }
    } catch (e) { safe(() => console.warn('fx', e)); }
  }

  function clear() {
    try {
      epoch++;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const a of [...anims]) { try { a.cancel(); } catch { /* ignore */ } }
      anims.clear();
      parts.length = 0;
      bodies.length = 0;
      shaking = false;
      if (layer) layer.replaceChildren();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    } catch { /* ignore */ }
  }

  window.FX = {
    react,
    clear,
    // For tests and debugging: run one moment right now (no delay), and peek at what is alive.
    _now: (m, view) => {
      if (!init()) return;
      if (m.type === 'play') playFx(m, view);
      else if (m.type === 'caught') caughtFx(m, view);
      else if (m.type === 'uno') unoFx(m, view);
      else if (m.type === 'out') outFx(m, view);
      else if (m.type === 'gameover') winFx(m, view);
      else if (m.type === 'take') penalty(m.by, m.count, view, 'deck', m.count >= 4 ? 3 : 1.4);
      else if (m.type === 'challenge') penalty(m.right ? m.target : m.by, m.count, view, 'pile', 1.4);
    },
    _state: () => ({ parts: parts.length, bodies: bodies.length, layer: layer ? layer.childElementCount : 0, anims: anims.size, timers: timers.size }),
  };
})();
