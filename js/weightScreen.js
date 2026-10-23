// Weight page ("המסע") on screen: fills the DOM from js/weightView.js and draws figure 1 on a canvas.
// Each time the page opens: particles swirl in and form the line, a comet lights it start → today, today's point lands
// with a flash. Then the line stays alive (particles flow toward today, a spark at random moments) at most 30 fps, only
// while the page is shown and the app is visible; one still frame under Reduce Motion. A finger pushes particles aside;
// a long press shows the nearest real weigh-in. Mockups: docs/design/weight-page.html, docs/design/line-motion.html (D).
import { frameDue, ease } from './motion.js';
import { monthTicks } from './weightView.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const num = text => { const s = el('span', 'n', text); s.dir = 'ltr'; return s; };
// a text line from weightView: strings stay as they are, {n} becomes an LTR number
const parts = list => list.map(p => (typeof p === 'string' ? p : num(p.n)));
const rm = matchMedia('(prefers-reduced-motion: reduce)');

const st = { model: null, on: false, raf: 0, last: -1e9, clock: 0, intro: 0, ptr: null, pick: null, readout: null };
// Entrance timeline, ms from the page opening: particles land, the line appears, the comet runs, today lands, all calm.
const T = { swirl: 950, lineIn: 1150, comet: 1450, land: 2900, calm: 4400 };

export function initWeight({ back, add, phase, retry, readout }) {
  $('#wtBack').onclick = back;
  $('#wtAdd').onclick = add;
  $('#wtPhase').onclick = phase;
  $('#wtRetry').onclick = retry;
  st.readout = readout;
  // Touch: a finger pushes the particles aside. Held 350 ms, it shows the nearest weigh-in and follows the finger;
  // a quick swipe stays a normal scroll. Lifting the finger hides it.
  const cv = $('#wtChart');
  let timer = null, start = null;
  const at = e => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const end = () => {
    clearTimeout(timer); start = null; if (st.ptr) st.ptr.on = false;
    if (st.pick) { st.pick = null; $('#wtRead').classList.remove('on'); redraw(); }
  };
  cv.addEventListener('pointerdown', e => {
    start = { x: e.clientX, y: e.clientY }; st.ptr = { ...at(e), on: true }; clearTimeout(timer);
    timer = setTimeout(() => showPick(start.x), 350);
  });
  cv.addEventListener('pointermove', e => {
    if (st.ptr) Object.assign(st.ptr, at(e));
    if (st.pick) showPick(e.clientX);
    else if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { clearTimeout(timer); start = null; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => cv.addEventListener(k, end));
  cv.addEventListener('touchmove', e => { if (st.pick) e.preventDefault(); }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('visibilitychange', kick);
  rm.addEventListener?.('change', kick);
  setInterval(() => { if (st.on) clock(); }, 15000);
}

function clock() {
  const d = new Date();
  $('#wtTime').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// m = weightPage(...) result, or null when the data could not be read.
export function renderWeight(m) {
  st.model = m;
  clock();
  $('#wtErr').hidden = !!m;
  $('#wtPhase').hidden = $('#wtAddBox').hidden = !m;
  if (!m) { $('#wtBody').hidden = $('#wtEmpty').hidden = true; $('#wtDate').textContent = ''; stop(); return; }
  $('#wtDate').textContent = m.heading;
  $('#wtPhaseText').replaceChildren(...parts(m.phase));
  $('#wtEmpty').hidden = !m.empty; $('#wtBody').hidden = m.empty;
  if (m.empty) { stop(); return; }

  $('#wtHeroK').textContent = m.hero.label;
  $('#wtKg').textContent = m.hero.kg;
  $('#wtFig').hidden = !m.chart;
  if (m.chart) { $('#wtFigCap').textContent = m.figCap; $('#wtKey').textContent = m.key; }
  $('#wtGrid').replaceChildren(...m.grid.map(g => {
    const c = el('div'); c.append(el('b', null, ''), el('span', null, g.lab));
    c.firstChild.append(num(g.v));
    if (g.sub) { const s = el('span'); s.append('יעד ', num(g.sub)); c.append(s); }
    return c;
  }));
  $('#wtNote').textContent = m.note; $('#wtNote').hidden = !m.note;
  $('#wtRows').replaceChildren(...m.rows.map(r => {
    const row = el('div', 'r'), v = el('b');
    if (r.reason) v.append(el('span', 'm', r.reason));
    else if (r.month) {
      v.append(r.month, ' · ', num(r.weeks), ' שבועות');
      if (r.range) { const s = el('span', 'm'); s.append(' (', num(r.range), ')'); v.append(s); }
    } else {
      v.append(num(r.kg), ' · ', num(r.date));
      if (r.ago) v.append(' · ', el('span', 'loud', r.ago));
    }
    row.append(el('span', null, r.key), v);
    return row;
  }));
  $('#wtRows').hidden = !m.rows.length;
  $('#wtCap').textContent = m.cap; $('#wtCap').hidden = !m.cap;
  layout();
}

// shown: the page is on screen (the line runs only then).
export function showWeight(shown) { if (shown && !st.on) st.intro = st.clock; st.on = shown; if (shown) layout(); else stop(); }
export const relayoutWeight = () => { if (st.on) layout(); };

// The long-press readout: the nearest real weigh-in in time, in a box at the top on the side away from the finger.
function showPick(clientX) {
  if (!st.plot || !st.readout) return;
  const cv = $('#wtChart'), fx = clientX - cv.getBoundingClientRect().left;
  const p = st.plot.pickAt(fx, st.pick);
  if (!p) return;
  const same = st.pick && st.pick.date === p.date, W = cv.clientWidth, box = $('#wtRead');
  // the side flips only once the finger is clearly across the middle
  const right = st.pick ? (fx > W / 2 + 24 ? true : fx < W / 2 - 24 ? false : st.pick.right) : fx > W / 2;
  st.pick = { ...p, right }; redraw();
  if (!same) {
    const t = st.readout(p), kg = el('b');
    kg.append(num(t.kg), el('small', null, ' ק״ג'));
    box.replaceChildren(num(t.date), kg);
    if (t.avg !== null) { const a = el('span', 'avg'); a.append('ממוצע 4 שקילות ', num(t.avg)); box.append(a); }
    if (t.tag || t.note) box.append(el('span', 'nt', [t.tag, t.note].filter(Boolean).join(' · ')));
  }
  const w = box.offsetWidth;
  let x = right ? p.x - 12 - w : p.x + 12;
  if (x < 8 || x + w > W - 8) x = right ? p.x + 12 : p.x - 12 - w;   // no room on that side: flip
  box.style.left = cv.offsetLeft + Math.max(8, Math.min(W - 8 - w, x)) + 'px';
  box.style.top = cv.offsetTop + 8 + 'px';
  box.classList.add('on');
}
// Paint once when no loop is running (under Reduce Motion); otherwise the loop paints the next frame anyway.
function redraw() { if (st.plot && !st.raf) st.plot.frame(st.clock, true, st.pick); }

function stop() { cancelAnimationFrame(st.raf); st.raf = 0; $('#wtChart').dataset.motion = 'off'; }
function kick() {
  cancelAnimationFrame(st.raf); st.raf = 0;
  if (!st.on || !st.plot) return;
  if (rm.matches || document.hidden) { st.plot.frame(0, true, st.pick); $('#wtChart').dataset.motion = 'still'; return; }
  st.last = -1e9;
  const loop = now => {
    st.raf = 0;
    if (!st.on || document.hidden || rm.matches) return;
    st.raf = requestAnimationFrame(loop);
    // full rate for the entrance and while a finger is on the chart, else the 30 fps cap
    if (!frameDue(st.last, now, st.clock - st.intro < T.calm || (st.ptr && st.ptr.on) ? 60 : undefined)) return;
    st.clock += Math.min(now - st.last, 100); st.last = now;
    st.plot.frame(st.clock, false, st.pick);
  };
  $('#wtChart').dataset.motion = 'running';
  st.raf = requestAnimationFrame(loop);
}

// Fonts first (canvas text needs Heebo loaded), then size the canvas to its box and draw.
function layout() {
  const m = st.model;
  if (!m || m.empty || !m.chart || !st.on) { st.plot = null; return; }
  Promise.all(['500 12px Heebo', '700 13px Heebo', '800 14px Heebo'].map(f => document.fonts.load(f))).catch(() => {}).then(() => {
    if (st.model !== m || !st.on) return;
    const cv = $('#wtChart'), b = cv.getBoundingClientRect();
    if (!b.width) return;
    st.plot = plot(cv, m.chart, Math.round(b.width), Math.round(b.height));
    st.plot.frame(st.clock, rm.matches || document.hidden, st.pick);   // resizing the canvas wipes it: paint once now, the loop takes over from here
    cv.setAttribute('aria-label', ariaOf(m));
    kick();
  });
}
const ariaOf = m => {
  const c = m.chart, s = c.start ? `מ-${c.start.label} ק״ג ` : '';
  return `גרף המסע: ${s}עד ${m.hero.kg} ק״ג` + (c.target !== null ? `, ${c.targetLabel}` : '');
};

// Catmull-Rom through the weekly points; y clamped between each pair so the curve never overshoots a real value.
function smooth(P, step = 2) {
  const out = [], idx = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    idx.push(out.length);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const q = [0, 1].map(j => .5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
      q[1] = Math.min(hi, Math.max(lo, q[1])); out.push(q);
    }
  }
  idx.push(out.length); out.push(P[P.length - 1]); return { pts: out, idx };
}
const cl = v => Math.min(1, Math.max(0, v)), lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) ** 3, expo = t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const back = (t, c = 1.7) => Math.max(0, 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2);   // never below 0: it sizes arcs
// seeded, so the particles start from the same places every time
function rnd(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Figure 1. Returns { frame(ms, still, pick), pickAt(x, current) }. Labels are placed once, by priority: each tries its
// spots, else is dropped. Plot time t = ms since the page opened; a still frame is the calm end state.
function plot(cv, m, W, H) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const PAD = { l: 12, r: 12, t: 34, b: 30 }, base = H - PAD.b + 8;
  const X = t => PAD.l + (t - m.t0) / (m.t1 - m.t0) * (W - PAD.l - PAD.r);
  const Y = kg => PAD.t + (m.y.hi - kg) / (m.y.hi - m.y.lo) * (H - PAD.t - PAD.b);
  const months = monthTicks(m.t0, m.t1, W - PAD.l - PAD.r);
  const segs = m.segments.map(s => s.map(p => [X(p.t), Y(p.kg)]));
  const paths = segs.map(s => (s.length > 1 ? smooth(s) : { pts: s, idx: [0] }));
  const head = segs.length ? segs[segs.length - 1].at(-1) : null;
  const tgtY = m.target !== null ? Y(m.target) : null, end = m.end ? [X(m.end.t), tgtY] : null;
  const stp = m.start ? [X(m.start.t), Y(m.start.kg)] : null;
  const raw = m.raw.map(p => [X(p.t), Y(p.kg)]);
  const x0 = paths.length ? paths[0].pts[0][0] : 0;
  let grad = null;
  if (head) { grad = g.createLinearGradient(x0, 0, Math.max(head[0], x0 + 1), 0); grad.addColorStop(0, '#5b6cff'); grad.addColorStop(.6, '#62c6ff'); grad.addColorStop(1, '#ffffff'); }

  // arc length along each drawn segment, so the comet and the particles can travel on the line
  const lens = paths.map(p => { const c = [0]; for (let i = 1; i < p.pts.length; i++) c.push(c[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1])); return c; });
  const goff = []; let total = 0; lens.forEach(c => { goff.push(total); total += c.at(-1); });
  function at(si, L) {   // point and normal at length L on segment si
    const c = lens[si], P = paths[si].pts; let lo = 0, hi = c.length - 1;
    if (hi < 1) return [P[0][0], P[0][1], 0, -1];
    while (hi - lo > 1) { const k = (lo + hi) >> 1; if (c[k] <= L) lo = k; else hi = k; }
    const a = P[lo], b = P[hi], f = cl((L - c[lo]) / (c[hi] - c[lo] || 1)), dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), -dy / n, dx / n];
  }
  const upto = (si, L) => {
    const c = lens[si], P = paths[si].pts, out = [];
    for (let i = 0; i < P.length; i++) { if (c[i] <= L) { out.push(P[i]); continue; } const q = at(si, L); out.push([q[0], q[1]]); break; }
    return out;
  };
  const segOf = G => { let si = 0; while (si < goff.length - 1 && G >= goff[si + 1]) si++; return si; };
  const nodes = []; paths.forEach((p, si) => segs[si].forEach((n, k) => nodes.push({ p: n, G: goff[si] + lens[si][p.idx[k]] })));

  const boxes = [], labels = [];
  const ob = (x, y, r) => boxes.push([x - r, y - r, x + r, y + r]);
  if (head) ob(head[0], head[1], 9); if (end) ob(end[0], end[1], 7); if (stp) ob(stp[0], stp[1], 7);
  nodes.forEach(n => ob(n.p[0], n.p[1], 4)); raw.forEach(p => ob(p[0], p[1], 4));
  const hit = b => b[0] < 2 || b[2] > W - 2 || b[1] < 0 || b[3] > H || boxes.some(o => b[0] < o[2] + 3 && b[2] > o[0] - 3 && b[1] < o[3] + 3 && b[3] > o[1] - 3);
  function place(text, font, size, color, dir, cands, must) {
    if (!text) return null;
    g.font = font; g.direction = dir; const w = g.measureText(text).width;
    for (let k = 0; k < cands.length; k++) {
      const [x, y, al] = cands[k], x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x, b = [x0, y - size * .82, x0 + w, y + size * .22];
      if (!hit(b) || (must && k === cands.length - 1)) { boxes.push(b); const l = { text, font, color, dir, x: x0 + w / 2, y, w, size }; labels.push(l); return l; }
    }
    return null;
  }
  boxes.push([PAD.l, base - 1, W - PAD.r, base + 1]);   // the axis line: labels never sit on it
  let headL = null;
  if (head) {
    const c = [[head[0], head[1] - 22, 'center'], [head[0], head[1] + 32, 'center']];
    headL = place(m.headLabel, '800 14px Heebo', 14, '#EEF1FF', 'rtl', tgtY !== null && tgtY < head[1] ? c.reverse() : c, true);
    if (headL) headL.head = true;   // appears when the comet lands, on a dark pill so it reads over the glow
  }
  if (tgtY !== null) place(m.targetLabel, '700 13px Heebo', 13, '#EEF1FF', 'rtl',
    [[W - PAD.r, tgtY + 18, 'right'], [W - PAD.r, tgtY - 8, 'right'], [PAD.l, tgtY + 18, 'left'], [PAD.l, tgtY - 8, 'left']]);   // gives way to today's label
  if (end) { const l = place(m.end.label, '500 12px Heebo', 12, '#B0B7DA', 'rtl', [[end[0], end[1] - 14, 'center'], [end[0], end[1] + 22, 'center']]); if (l) l.late = true; }
  if (stp) place(m.start.label, '500 12px Heebo', 12, '#B0B7DA', 'ltr', [[stp[0] - 2, stp[1] - 14, 'left'], [stp[0] - 2, stp[1] + 22, 'left']]);
  if (m.todayT !== null) place('היום', '500 12px Heebo', 12, '#B0B7DA', 'rtl', [[X(m.todayT) - 4, PAD.t - 14, 'right']]);
  months.forEach(mo => place(mo.label, '500 12px Heebo', 12, '#8F97C6', 'rtl', [[X(mo.t) + 4, H - 4, 'left']]));

  const stroke = (P, w, c, blur, bc) => {
    if (P.length < 2) return;
    g.save(); g.lineJoin = g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = c;
    if (blur) { g.shadowBlur = blur; g.shadowColor = bc || c; }
    g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
  };
  const ring = (x, y, R, w, col) => { if (w <= 0 || R <= 0) return; g.lineWidth = w; g.strokeStyle = col; g.beginPath(); g.arc(x, y, R, 0, 7); g.stroke(); };
  const line = (P, a) => { if (P.length < 2 || a <= 0) return; g.globalAlpha = a; stroke(P, 8, 'rgba(100,140,255,.07)', 12, 'rgba(110,160,255,.6)'); stroke(P, 2.4, grad, 4, 'rgba(140,190,255,.8)'); g.globalAlpha = 1; };
  // the line up to global length G (all of it when G >= total)
  const lineTo = (G, a) => paths.forEach((p, si) => { const L = G - goff[si]; if (L > 0) line(L >= lens[si].at(-1) ? p.pts : upto(si, L), a); });
  function drawLabels(late, headIn, dim) {
    labels.forEach(l => {
      const a = (l.head ? headIn : l.late ? late : 1) * dim;
      if (a <= 0) return;
      g.save(); g.globalAlpha = a; g.translate(l.x, l.y);
      if (l.head) {
        const s = lerp(1.35, 1, back(cl(headIn * 1.6), 1.4)); g.scale(s, s);
        g.fillStyle = 'rgba(6,8,24,.72)'; g.beginPath();
        if (g.roundRect) g.roundRect(-l.w / 2 - 6, -l.size * .82 - 3, l.w + 12, l.size * 1.04 + 6, 8); else g.rect(-l.w / 2 - 6, -l.size * .82 - 3, l.w + 12, l.size * 1.04 + 6);
        g.fill();
      }
      g.font = l.font; g.direction = l.dir; g.textAlign = 'center'; g.fillStyle = l.color; g.fillText(l.text, 0, 0); g.restore();
    });
  }

  // ~420 particles spread over the line by length, each with its own landing time, speed and sway
  const r = rnd(42), ps = [], N = head && total > 1 ? Math.min(420, Math.round(total * 1.1)) : 0;
  for (let k = 0; k < N; k++) {
    const G = r() * total, si = segOf(G), L0 = G - goff[si], q = at(si, L0), a = r() * 6.283, d = 120 + r() * 260, halo = r() < .25;
    ps.push({ si, L0, sx: q[0] + Math.cos(a) * d, sy: q[1] + Math.sin(a) * d, sw: (r() - .5) * 140, d0: r() * 450 + G / total * 450,
      v: 7 + r() * 26, amp: halo ? 2 + r() * 2 : .5 + r() * 1.5, halo, f1: .0005 + r() * .0013, f2: .0011 + r() * .002, f3: .001 + r() * .003,
      p1: r() * 7, p2: r() * 7, p3: r() * 7, cyan: r() < .5, dx: 0, dy: 0 });
  }
  const buckets = Array.from({ length: 12 }, () => []);   // 2 colours × 6 alpha levels: one fill per bucket
  let sparks = [], prev = null, F = null, hold = 0, shown = null, gx = 0, nextSpark = 0, born = null;
  const passed = nodes.map(() => null);

  function frame(ms, still, pick) {
    g.clearRect(0, 0, W, H);
    const t = still ? T.calm + 4000 : ms - st.intro;
    if (born === null) born = t;
    const dt = still || prev === null ? 0 : Math.min(50, Math.max(0, t - prev)); prev = t;
    if (pick) {   // at = when the marker appeared, snap = when it last moved to another weigh-in
      const moved = !shown || shown.date !== pick.date;
      pick.at = shown ? shown.at : t;
      pick.snap = moved ? t : shown.snap;
      shown = pick;
    }
    hold = still ? (pick ? 1 : 0) : hold + ((pick ? 1 : 0) - hold) * Math.min(1, dt / (pick ? 150 : 250));
    if (!pick && hold < .01) shown = null;
    F = F === null || still ? t : F + dt * lerp(1, .35, hold);   // the flow slows while a finger holds the chart
    const a = t - T.land, landed = still || a >= 0;
    const after = still ? 1 : cl(a / 400), headIn = still ? 1 : cl((a - 180) / 360);
    // the comet arrives with speed: part smoothstep, part accelerating
    const u = cl((t - T.comet) / (T.land - T.comet)), cp = still ? 1 : .6 * u * u * (3 - 2 * u) + .4 * u * u, Lc = cp * total;
    const comet = !still && t >= T.comet && t < T.land;
    const punch = !still && a > 0 ? .04 * cl(1 - a / 500) ** 3 : 0;
    g.save();
    if (head && punch) { g.translate(head[0], head[1]); g.scale(1 + punch, 1 + punch); g.translate(-head[0], -head[1]); }
    g.strokeStyle = 'rgba(190,200,255,.15)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(PAD.l, base); g.lineTo(W - PAD.r, base); g.stroke();
    months.forEach(mo => { g.beginPath(); g.moveTo(X(mo.t), base); g.lineTo(X(mo.t), base + 5); g.stroke(); });
    if (m.todayT !== null) { g.save(); g.setLineDash([2, 4]); g.strokeStyle = 'rgba(190,200,255,.30)'; g.beginPath(); g.moveTo(X(m.todayT), PAD.t - 8); g.lineTo(X(m.todayT), base); g.stroke(); g.restore(); }
    // target: a dotted ice hairline, never green
    if (tgtY !== null) { g.save(); g.setLineDash([2, 6]); g.strokeStyle = 'rgba(169,196,255,.50)'; g.beginPath(); g.moveTo(PAD.l, tgtY); g.lineTo(W - PAD.r, tgtY); g.stroke(); g.restore(); }
    // projection: dots pop one by one from today to the arrival month after the landing
    if (end && head && landed) {
      for (let k = 1; k < 12; k++) {
        const v = still ? 1 : cl((a - 300 - k * 45) / 260); if (!v) continue;
        const f = k / 12; g.fillStyle = `rgba(190,215,255,${(.55 * v).toFixed(3)})`;
        g.beginPath(); g.arc(lerp(head[0], end[0], f), lerp(head[1], end[1], f), 1.8 * back(v), 0, 7); g.fill();
      }
      const v = still ? 1 : cl((a - 860) / 400);
      if (v) ring(end[0], end[1], 5 * back(v), 1.5, `rgba(169,196,255,${(.9 * v).toFixed(3)})`);
    }
    // under 5 weigh-ins: the weigh-ins as dim dots, nothing else
    raw.forEach(p => { g.fillStyle = 'rgba(176,183,218,.7)'; g.beginPath(); g.arc(p[0], p[1], 3.5, 0, 7); g.fill(); });
    if (!head) { g.restore(); drawLabels(1, 1, 1); return; }

    // the line: drawn dim from the left as the particles land, lit where the comet has passed
    g.save(); g.globalCompositeOperation = 'lighter';
    if (!landed) lineTo(total * cl((t - T.lineIn) / 500), .2 * cl((t - T.lineIn) / 450));
    lineTo(still || landed ? total : t >= T.comet ? Lc : 0, 1);

    // particles: swirl in, then flow along the line toward today; a finger pushes them aside
    const P = st.ptr, push = P && P.on && !pick && !still, pdim = lerp(1, .3, hold);
    buckets.forEach(b => (b.length = 0));
    for (const p of ps) {
      const s = cl((t - p.d0) / T.swirl); let x, y, al, L = p.L0;
      if (s < 1 && !still) {
        const e = ease(s), q = at(p.si, p.L0), dx = q[0] - p.sx, dy = q[1] - p.sy, n = Math.hypot(dx, dy) || 1, sw = p.sw * Math.sin(Math.PI * e);
        x = lerp(p.sx, q[0], e) - dy / n * sw; y = lerp(p.sy, q[1], e) + dx / n * sw; al = (.15 + .85 * e) * cl((t - born) / 200) * .5;
      } else {
        const len = lens[p.si].at(-1), fl = Math.max(0, F - p.d0 - T.swirl);
        L = (p.L0 + p.v * fl / 1000) % len;
        const q = at(p.si, L), off = cl(fl / 1400) * p.amp * (Math.sin(t * p.f1 + p.p1) + .6 * Math.sin(t * p.f2 + p.p2));
        x = q[0] + q[2] * off; y = q[1] + q[3] * off;
        al = Math.min(.5, .45 + .4 * Math.sin(t * p.f3 + p.p3)) * cl(L / 30) * cl((len - L) / 40) * (p.halo ? .35 : 1);
      }
      if (comet) al += 1.3 * Math.exp(-Math.abs(goff[p.si] + L - Lc) / 30);   // the comet energises what it passes
      if (push) { const ex = x + p.dx - P.x, ey = y + p.dy - P.y, d = Math.hypot(ex, ey); if (d < 64 && d > .1) { const f = (1 - d / 64) ** 2 * 3.2; p.dx += ex / d * f; p.dy += ey / d * f; } }
      if (!still) { p.dx *= .93; p.dy *= .93; }
      al = Math.min(1, al) * pdim;
      if (al <= .02) continue;
      buckets[(p.cyan ? 6 : 0) + Math.min(5, Math.floor(al * 6))].push(x + p.dx - 1, y + p.dy - 1);
    }
    buckets.forEach((b, i) => {
      if (!b.length) return;
      g.fillStyle = (i < 6 ? 'rgba(160,195,255,' : 'rgba(125,220,255,') + ((i % 6 + .5) / 6).toFixed(3) + ')';
      g.beginPath(); for (let k = 0; k < b.length; k += 2) g.rect(b[k], b[k + 1], 2, 2); g.fill();
    });

    // the comet: a hot trail, sparks thrown off, a bright head
    if (comet && Lc > 1) {
      const ci = segOf(Lc), Ll = Lc - goff[ci], tr = upto(ci, Ll).filter((q, i, A) => i === A.length - 1 || lens[ci][i] >= Ll - 140);
      for (let i = 0; i < tr.length - 1; i += 2) { const f = i / tr.length; stroke(tr.slice(i, i + 3), 1.5 + 4 * f, `rgba(255,${200 + 55 * f | 0},${170 + 85 * f | 0},${(.85 * f).toFixed(3)})`, 14, 'rgba(120,180,255,.9)'); }
      const h = at(ci, Ll), ang = Math.atan2(-h[2], h[3]) + Math.PI;
      for (let k = 0; k < 3; k++) { const an = ang + (Math.random() - .5) * 1.6, v = .05 + Math.random() * .12; sparks.push({ x: h[0], y: h[1], vx: Math.cos(an) * v, vy: Math.sin(an) * v - .02, life: 0, max: 350 + Math.random() * 350, gr: .00025 }); }
      glow(h[0], h[1], 30, 1); glow(h[0], h[1], 9, 1, true);
    }
    // alive: today's point throws one soft spark now and then, at random moments (paused while a finger holds)
    if (!still && a > 700 && !pick && t > nextSpark) {
      const an = -Math.PI / 2 + (Math.random() - .5) * 2.4, v = .012 + Math.random() * .03;
      sparks.push({ x: head[0], y: head[1], vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: 0, max: 900 + Math.random() * 900, gr: -.000004 });
      nextSpark = t + 1200 + Math.random() * 2300;
    }
    sparks = sparks.filter(s => (s.life += dt) < s.max);
    sparks.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += s.gr * dt; const k = 1 - s.life / s.max; g.fillStyle = `rgba(210,230,255,${k.toFixed(3)})`; g.beginPath(); g.arc(s.x, s.y, 1.3 * k + .3, 0, 7); g.fill(); });

    // landing: a soft flash and two shockwaves around today's point
    if (!still && a >= 0 && a < 900) {
      const fg = g.createRadialGradient(head[0], head[1], 0, head[0], head[1], 110);
      fg.addColorStop(0, `rgba(200,225,255,${(.32 * Math.exp(-a / 180)).toFixed(3)})`); fg.addColorStop(1, 'rgba(80,120,255,0)');
      g.fillStyle = fg; g.fillRect(head[0] - 110, head[1] - 110, 220, 220);
      [[0, 70, 2, 700], [120, 40, 1.2, 600]].forEach(([d, R, w, dur]) => { const v = cl((a - d) / dur); if (v > 0 && v < 1) ring(head[0], head[1], 6 + R * expo(v), w * (1 - v), `rgba(190,220,255,${(.7 * (1 - v)).toFixed(3)})`); });
    }
    // today's point: lands, then breathes slowly (one breath every 5 s)
    if (landed) { const br = still ? 0 : (1 - Math.cos(a / 5000 * 2 * Math.PI)) / 2; glow(head[0], head[1], 24 + 7 * br, after); }
    g.restore();

    // weekly points: solid dots (they are the data), each pops in with a small ring as the comet passes
    nodes.forEach((n, k) => {
      if (n.p === head) return;
      if (stp && Math.abs(n.p[0] - stp[0]) < 1 && Math.abs(n.p[1] - stp[1]) < 1) return;   // the start marker replaces a point on the same spot
      if (passed[k] === null && (still || t >= T.land || (t >= T.comet && Lc >= n.G))) passed[k] = still || born >= T.land ? -1e9 : t;   // drawn after the landing (resize, still): no pop
      const tp = passed[k]; if (tp === null) return;
      const s = back(cl((t - tp) / 320)), v = cl((t - tp) / 420);
      if (v < 1) ring(n.p[0], n.p[1], 4 + 10 * expo(v), 1.5 * (1 - v), `rgba(170,210,255,${(.6 * (1 - v)).toFixed(3)})`);
      g.fillStyle = '#EEF1FF'; g.strokeStyle = '#060818'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(n.p[0], n.p[1], 3 * s, 0, 7); g.fill(); g.stroke();
    });
    if (landed) { g.globalAlpha = after; g.fillStyle = '#fff'; g.beginPath(); g.arc(head[0], head[1], 4.5, 0, 7); g.fill(); g.globalAlpha = 1; }
    // start marker: hollow, no glow
    if (stp) { g.strokeStyle = '#B0B7DA'; g.lineWidth = 1.6; g.fillStyle = '#060818'; g.beginPath(); g.arc(stp[0], stp[1], 5, 0, 7); g.fill(); g.stroke(); }
    g.restore();
    drawLabels(after, headIn, lerp(1, .4, hold));

    // long press: a guide on the chosen weigh-in, a marker at its real weight
    if (shown && hold > .01) {
      const k = still ? 1 : 1 - Math.exp(-dt / 45);
      gx = still || hold < .2 ? shown.x : gx + (shown.x - gx) * k;
      const gin = still ? 1 : easeOut(cl((t - shown.at) / 180)), y = shown.y;
      g.save(); g.globalAlpha = hold;
      g.strokeStyle = 'rgba(200,215,255,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(gx, y - (y - PAD.t + 10) * gin); g.lineTo(gx, y + (base - y) * gin); g.stroke();
      g.strokeStyle = '#EEF1FF'; g.beginPath(); g.moveTo(gx, base); g.lineTo(gx, base + 5); g.stroke();
      const sc = still ? 1 : back(cl((t - shown.at) / 220), 1.4), pulse = still ? 0 : 3 * Math.sin(Math.PI * cl((t - shown.snap) / 160));
      ring(gx, y, (9 + pulse) * sc, 1.5, 'rgba(220,235,255,.9)');
      g.fillStyle = '#fff'; g.beginPath(); g.arc(gx, y, 2 * sc, 0, 7); g.fill();
      g.restore();
    }
  }
  function glow(x, y, R, a, core) {
    const r2 = g.createRadialGradient(x, y, 0, x, y, R);
    r2.addColorStop(0, `rgba(240,248,255,${a})`); r2.addColorStop(core ? 1 : .22, core ? 'rgba(255,255,255,0)' : `rgba(150,200,255,${(.4 * a).toFixed(3)})`);
    if (!core) r2.addColorStop(1, 'rgba(80,130,255,0)');
    g.fillStyle = r2; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  }
  // the real weigh-in nearest the finger in time; keeps the current one until another is 3 px nearer
  function pickAt(x, cur) {
    const ps2 = m.picks || [];
    if (!ps2.length) return null;
    let best = ps2[0];
    for (const p of ps2) if (Math.abs(X(p.t) - x) < Math.abs(X(best.t) - x)) best = p;
    if (cur) { const c = ps2.find(p => p.date === cur.date); if (c && Math.abs(X(c.t) - x) <= Math.abs(X(best.t) - x) + 3) best = c; }
    return { ...best, x: X(best.t), y: Math.min(base - 4, Math.max(PAD.t - 6, Y(best.kg))) };
  }
  return { frame, pickAt };
}
