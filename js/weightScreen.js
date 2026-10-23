// Weight page ("המסע") on screen: fills the DOM from js/weightView.js and draws figure 1 on a canvas.
// The line is live (passing bolt, glowing weekly points, flowing projection) at most 30 fps, only while the page
// is shown and the app is visible; one still frame under Reduce Motion. Mockup: docs/design/weight-page.html.
import { frameDue } from './motion.js';
import { monthTicks } from './weightView.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const num = text => { const s = el('span', 'n', text); s.dir = 'ltr'; return s; };
// a text line from weightView: strings stay as they are, {n} becomes an LTR number
const parts = list => list.map(p => (typeof p === 'string' ? p : num(p.n)));
const rm = matchMedia('(prefers-reduced-motion: reduce)');

const st = { model: null, on: false, raf: 0, last: -1e9, clock: 0 };

export function initWeight({ back, add, phase, retry }) {
  $('#wtBack').onclick = back;
  $('#wtAdd').onclick = add;
  $('#wtPhase').onclick = phase;
  $('#wtRetry').onclick = retry;
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
export function showWeight(shown) { st.on = shown; if (shown) layout(); else stop(); }
export const relayoutWeight = () => { if (st.on) layout(); };

function stop() { cancelAnimationFrame(st.raf); st.raf = 0; $('#wtChart').dataset.motion = 'off'; }
function kick() {
  cancelAnimationFrame(st.raf); st.raf = 0;
  if (!st.on || !st.plot) return;
  if (rm.matches || document.hidden) { st.plot.frame(0, true); $('#wtChart').dataset.motion = 'still'; return; }
  st.last = -1e9;
  const loop = now => {
    st.raf = 0;
    if (!st.on || document.hidden || rm.matches) return;
    st.raf = requestAnimationFrame(loop);
    if (!frameDue(st.last, now)) return;
    st.clock += Math.min(now - st.last, 100); st.last = now;
    st.plot.frame(st.clock, false);
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
    st.plot.frame(st.clock, true);   // resizing the canvas wipes it: paint once now, the loop takes over from here
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
function rnd(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function bolt(a, b, rough, depth, r) {
  if (!depth) return [a, b];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len, dd = (r() - .5) * len * rough;
  const m = [(a[0] + b[0]) / 2 + nx * dd, (a[1] + b[1]) / 2 + ny * dd];
  return [...bolt(a, m, rough, depth - 1, r).slice(0, -1), ...bolt(m, b, rough, depth - 1, r)];
}

// Figure 1. Returns { frame(ms, still) }. Labels are placed once, by priority: each tries its spots, else is dropped.
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
  const flat = []; paths.forEach((p, si) => p.pts.forEach(() => flat.push(si)));   // segment id per path point
  const offs = []; { let o = 0; paths.forEach(p => { offs.push(o); o += p.pts.length; }); }
  const all = paths.flatMap(p => p.pts);
  const nodes = []; paths.forEach((p, si) => segs[si].forEach((n, k) => nodes.push({ p: n, i: offs[si] + p.idx[k], si })));
  const head = segs.length ? segs[segs.length - 1].at(-1) : null;
  const tgtY = m.target !== null ? Y(m.target) : null, end = m.end ? [X(m.end.t), tgtY] : null;
  const stp = m.start ? [X(m.start.t), Y(m.start.kg)] : null;
  const raw = m.raw.map(p => [X(p.t), Y(p.kg)]);
  let grad = null;
  if (head) { grad = g.createLinearGradient(all[0][0], 0, Math.max(head[0], all[0][0] + 1), 0); grad.addColorStop(0, '#5b6cff'); grad.addColorStop(.6, '#62c6ff'); grad.addColorStop(1, '#ffffff'); }

  const boxes = [], labels = [];
  const ob = (x, y, r) => boxes.push([x - r, y - r, x + r, y + r]);
  if (head) ob(head[0], head[1], 9); if (end) ob(end[0], end[1], 7); if (stp) ob(stp[0], stp[1], 7);
  nodes.forEach(n => ob(n.p[0], n.p[1], 4)); raw.forEach(p => ob(p[0], p[1], 4));
  const hit = b => b[0] < 2 || b[2] > W - 2 || b[1] < 0 || b[3] > H || boxes.some(o => b[0] < o[2] + 3 && b[2] > o[0] - 3 && b[1] < o[3] + 3 && b[3] > o[1] - 3);
  function place(text, font, size, color, dir, cands, must) {
    if (!text) return;
    g.font = font; g.direction = dir; const w = g.measureText(text).width;
    for (let k = 0; k < cands.length; k++) {
      const [x, y, al] = cands[k], x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x, b = [x0, y - size * .82, x0 + w, y + size * .22];
      if (!hit(b) || (must && k === cands.length - 1)) { boxes.push(b); labels.push({ text, font, color, dir, x: x0 + w / 2, y }); return; }
    }
  }
  boxes.push([PAD.l, base - 1, W - PAD.r, base + 1]);   // the axis line: labels never sit on it
  if (head) {
    const c = [[head[0], head[1] - 20, 'center'], [head[0], head[1] + 30, 'center']];
    place(m.headLabel, '800 14px Heebo', 14, '#EEF1FF', 'rtl', tgtY !== null && tgtY < head[1] ? c.reverse() : c, true);
  }
  if (tgtY !== null) place(m.targetLabel, '700 13px Heebo', 13, '#EEF1FF', 'rtl',
    [[W - PAD.r, tgtY + 18, 'right'], [W - PAD.r, tgtY - 8, 'right'], [PAD.l, tgtY + 18, 'left'], [PAD.l, tgtY - 8, 'left']]);   // gives way to today's label
  if (end) place(m.end.label, '500 12px Heebo', 12, '#B0B7DA', 'rtl', [[end[0], end[1] - 14, 'center'], [end[0], end[1] + 22, 'center']]);
  if (stp) place(m.start.label, '500 12px Heebo', 12, '#B0B7DA', 'ltr', [[stp[0] - 2, stp[1] - 14, 'left'], [stp[0] - 2, stp[1] + 22, 'left']]);
  if (m.todayT !== null) place('היום', '500 12px Heebo', 12, '#B0B7DA', 'rtl', [[X(m.todayT) - 4, PAD.t - 14, 'right']]);
  months.forEach(mo => place(mo.label, '500 12px Heebo', 12, '#8F97C6', 'rtl', [[X(mo.t) + 4, H - 4, 'left']]));

  const stroke = (P, w, c, blur, bc) => {
    if (P.length < 2) return;
    g.save(); g.lineJoin = g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = c;
    if (blur) { g.shadowBlur = blur; g.shadowColor = bc || c; }
    g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
  };
  const drawLabels = () => labels.forEach(l => { g.font = l.font; g.direction = l.dir; g.textAlign = 'center'; g.fillStyle = l.color; g.fillText(l.text, l.x, l.y); });

  function frame(ms, still) {
    g.clearRect(0, 0, W, H);
    const r = rnd(Math.floor(ms / 55));
    g.strokeStyle = 'rgba(190,200,255,.15)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(PAD.l, base); g.lineTo(W - PAD.r, base); g.stroke();
    months.forEach(mo => { g.beginPath(); g.moveTo(X(mo.t), base); g.lineTo(X(mo.t), base + 5); g.stroke(); });
    if (m.todayT !== null) { g.save(); g.setLineDash([2, 4]); g.strokeStyle = 'rgba(190,200,255,.30)'; g.beginPath(); g.moveTo(X(m.todayT), PAD.t - 8); g.lineTo(X(m.todayT), base); g.stroke(); g.restore(); }
    // target: a dotted ice hairline, never green
    if (tgtY !== null) { g.save(); g.setLineDash([2, 6]); g.strokeStyle = 'rgba(169,196,255,.50)'; g.beginPath(); g.moveTo(PAD.l, tgtY); g.lineTo(W - PAD.r, tgtY); g.stroke(); g.restore(); }
    // projection: dots flowing from today's point to the arrival month
    if (end && head) {
      const fl = still ? 0 : (ms / 2000) % 1;
      for (let k = 0; k < 12; k++) {
        const t = (k + fl) / 12; g.fillStyle = `rgba(190,215,255,${(.5 * (1 - t) + .12).toFixed(3)})`;
        g.beginPath(); g.arc(head[0] + (end[0] - head[0]) * t, head[1] + (end[1] - head[1]) * t, 1.4, 0, 7); g.fill();
      }
      g.strokeStyle = 'rgba(169,196,255,.9)'; g.lineWidth = 1.5; g.beginPath(); g.arc(end[0], end[1], 4.5, 0, 7); g.stroke();
    }
    // under 5 weigh-ins: the weigh-ins as dim dots, nothing else
    raw.forEach(p => { g.fillStyle = 'rgba(176,183,218,.7)'; g.beginPath(); g.arc(p[0], p[1], 3.5, 0, 7); g.fill(); });
    if (!head) { drawLabels(); return; }
    g.save(); g.globalCompositeOperation = 'lighter';
    paths.forEach(p => { stroke(p.pts, 9, 'rgba(100,140,255,.10)', 18, 'rgba(110,160,255,.9)'); stroke(p.pts, 2.6, grad, 6, 'rgba(140,190,255,.8)'); });
    // the passing bolt: 0.9 s every 3.6 s, start → today, only along drawn segments
    const PERIOD = 3600, BOLT = 900, ph = (ms % PERIOD) / BOLT;
    if (!still && ph < 1 && all.length > 2) {
      const e = ph < .5 ? 2 * ph * ph : 1 - (-2 * ph + 2) ** 2 / 2, bi = Math.floor(e * (all.length - 1));
      let j0 = Math.max(0, bi - 40); while (flat[j0] !== flat[bi]) j0++;
      const seg = all.slice(j0, bi + 1);
      if (seg.length > 9) {
        const b = []; for (let k = 0; k < seg.length - 8; k += 8) b.push(...bolt(seg[k], seg[k + 8], .55, 3, r).slice(k ? 1 : 0));
        stroke(b, 5, 'rgba(160,190,255,.25)', 14, '#9fc0ff'); stroke(b, 1.4, 'rgba(255,255,255,.95)');
      }
      nodes.forEach((n, k) => {
        const d = Math.abs(n.i - bi);
        if (d < 30 && k > 0 && nodes[k - 1].si === n.si) stroke(bolt(nodes[k - 1].p, n.p, .5, 4, r), .9, `rgba(215,225,255,${(.6 * (1 - d / 30)).toFixed(3)})`, 6, '#b0c8ff');
      });
    }
    // weekly points: glowing, brighter right after the bolt passes
    nodes.forEach(n => {
      if (n.p === head) return;
      if (stp && Math.abs(n.p[0] - stp[0]) < 1 && Math.abs(n.p[1] - stp[1]) < 1) return;   // the start marker replaces a point on the same spot
      const since = still ? 9 : ((ms % PERIOD) - n.i / Math.max(all.length - 1, 1) * BOLT) / 600, glow = since > 0 && since < 1 ? 1 - since : 0;
      const R = 6 + 6 * glow, cg = g.createRadialGradient(n.p[0], n.p[1], 0, n.p[0], n.p[1], R);
      cg.addColorStop(0, `rgba(240,246,255,${.8 + .2 * glow})`); cg.addColorStop(.35, `rgba(150,190,255,${.28 + .35 * glow})`); cg.addColorStop(1, 'rgba(100,140,255,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(n.p[0], n.p[1], R, 0, 7); g.fill();
    });
    // today's point: plasma, gentle crackle
    const pr = still ? 1 : 1 + .06 * Math.sin(ms / 300), hg = g.createRadialGradient(head[0], head[1], 0, head[0], head[1], 28 * pr);
    hg.addColorStop(0, 'rgba(240,248,255,1)'); hg.addColorStop(.22, 'rgba(150,200,255,.45)'); hg.addColorStop(1, 'rgba(80,130,255,0)');
    g.fillStyle = hg; g.beginPath(); g.arc(head[0], head[1], 28 * pr, 0, 7); g.fill();
    if (!still && r() < .5) {
      const a = r() * Math.PI * 2, L = 14 + r() * 10;
      stroke(bolt([head[0] + Math.cos(a) * 5, head[1] + Math.sin(a) * 5], [head[0] + Math.cos(a) * L, head[1] + Math.sin(a) * L], .6, 2, r), .8, 'rgba(220,232,255,.7)', 5, '#b0c8ff');
    }
    g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(head[0], head[1], 4.5, 0, 7); g.fill();
    // start marker: hollow, no glow
    if (stp) { g.strokeStyle = '#B0B7DA'; g.lineWidth = 1.6; g.fillStyle = '#060818'; g.beginPath(); g.arc(stp[0], stp[1], 5, 0, 7); g.fill(); g.stroke(); }
    drawLabels();
  }
  return { frame };
}
