// Dim particle galaxy behind the dark home (redesign stage 1 §5). Plain WebGL2, no library.
// Very slow, at most 30 fps, only while the home is shown and the app is visible; a still frame under Reduce Motion.
// The disc sits around the lens and is dimmed inside it, so the rate is always read over glass, not over moving dots.
import { frameDue } from './motion.js';

const VS = `#version 300 es
precision highp float;
in vec4 aP; // kind (0 disc, 1 star), radius or x, angle or y, seed
uniform vec2 uRes; uniform vec3 uLens; uniform float uTime, uIntro, uDpr; uniform vec3 uTouch;
uniform vec4 uShape; uniform vec3 uCore, uArm1, uArm2; // per-page look: squash, tilt, scale, ring (0 spiral → 1 ring)
out vec3 vCol; out float vA;
void main(){
  float kind=aP.x, seed=aP.w; vec2 pos; float a, size;
  if(kind<.5){
    float r0=mix(aP.y,.72+(aP.y-.5)*.32,uShape.w);   // ring pages pull the dots into a band
    float r=r0*mix(1.7,1.,uIntro);
    float ang=aP.z+uTime*.035/(.25+aP.y);
    vec2 d=vec2(cos(ang),sin(ang))*r; d.y*=uShape.x;
    float cr=cos(uShape.y), sr=sin(uShape.y); d=vec2(d.x*cr-d.y*sr,d.x*sr+d.y*cr);
    pos=uLens.xy+d*uLens.z*uShape.z;
    vCol=mix(uCore,mix(uArm1,uArm2,smoothstep(.3,1.,aP.y)),smoothstep(0.,.3,r0));
    a=mix(.85,.6,smoothstep(0.,.35,aP.y))*(1.-smoothstep(.85,1.1,aP.y)*.6)*(.75+.25*sin(uTime*.8+seed*60.));
    size=2.4+2.2*fract(seed*7.31);
  }else{
    pos=aP.yz*uRes;
    vCol=vec3(.72,.76,1.);
    a=(.18+.28*fract(seed*13.7))*(.65+.35*sin(uTime*.9+seed*80.));
    size=1.6+1.6*fract(seed*3.1);
  }
  // touch: dots near the finger are pushed aside, then drift back
  vec2 tv=pos-uTouch.xy; float td=length(tv);
  pos+=tv/(td+.001)*exp(-td*td/7200.)*uTouch.z*34.;
  // inside the lens the dots fade, so text there sits on glass
  float ld=length(pos-uLens.xy)/uLens.z; a*=mix(.12,1.,smoothstep(.9,1.08,ld));
  // and they stay in the lens row, never behind the verdict word or the scale
  if(kind<.5) a*=1.-smoothstep(1.,1.2,abs(pos.y-uLens.y)/uLens.z);
  vA=a*uIntro;
  gl_PointSize=size*uDpr;
  gl_Position=vec4(pos.x/uRes.x*2.-1.,1.-pos.y/uRes.y*2.,0.,1.);
}`;
const FS = `#version 300 es
precision mediump float; in vec3 vCol; in float vA; out vec4 o;
void main(){float d=length(gl_PointCoord-.5)*2.;float a=1.-smoothstep(0.,1.,d);a*=a*vA;if(a<.003)discard;o=vec4(vCol*a,a);}`;

// Same family, a different galaxy per page (owner 23.10). shape = [squash, tilt, scale × lens radius, ring].
const THEMES = {
  home: { shape: [.55, -.2, 2.5, 0], core: [.88, .88, 1], arm1: [.52, .60, 1], arm2: [.62, .48, .96] },   // violet two-arm spiral
  weigh: { shape: [.34, .22, 2.3, 1], core: [.85, .97, 1], arm1: [.50, .78, 1], arm2: [.42, .90, .95] },  // ice-cyan ring, tilted the other way
  weight: { shape: [.13, .04, 2.3, 1], core: [.84, .92, 1], arm1: [.48, .70, 1], arm2: [.40, .82, .95] }   // weight page: a flat blue ring in the hero row only, clear of the chart
};
const N_DISC = 5600, N_STARS = 420, INTRO_MS = 900;

function rnd(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function particles() {
  const r = rnd(7), a = new Float32Array((N_DISC + N_STARS) * 4);
  for (let i = 0; i < N_DISC; i++) {
    const arm = i % 2, rad = Math.pow(r(), 1.1) * 1.05;
    const th = arm * Math.PI + rad * 4.2 + (r() - .5) * (0.9 + rad);   // two loose arms
    a.set([0, rad, th, r()], i * 4);
  }
  for (let i = 0; i < N_STARS; i++) a.set([1, r(), r(), r()], (N_DISC + i) * 4);
  return a;
}

// Returns null when WebGL2 is missing (the page keeps its static gradient and CSS glass lens).
export function startGalaxy(canvas, lensEl) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch { gl = null; }
  if (!gl) return null;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aP'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch { return null; }
  const U = n => gl.getUniformLocation(prog, n);
  const u = { shape: U('uShape'), core: U('uCore'), arm1: U('uArm1'), arm2: U('uArm2'), res: U('uRes'), lens: U('uLens'), time: U('uTime'), intro: U('uIntro'), dpr: U('uDpr'), touch: U('uTouch') };
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, particles(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);

  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  const s = { theme: 'home', on: false, raf: 0, last: -1e9, t0: performance.now(), clock: 0, intro0: null, lens: [0, 0, 1], w: 0, h: 0, dpr: 1,
    touch: { x: -1e4, y: -1e4, k: 0, held: false } };

  function resize() {
    s.dpr = Math.min(devicePixelRatio || 1, 2); s.w = innerWidth; s.h = innerHeight;
    canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr);
    const b = lensEl.getBoundingClientRect();
    s.lens = [b.left + b.width / 2, b.top + b.height / 2, Math.max(b.width / 2, 40)];
  }
  function draw(now) {
    const intro = s.intro0 === null ? 1 : Math.min((now - s.intro0) / INTRO_MS, 1);
    const ie = 1 - (1 - intro) ** 3;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const t = THEMES[s.theme] || THEMES.home;
    gl.uniform4f(u.shape, ...t.shape); gl.uniform3f(u.core, ...t.core); gl.uniform3f(u.arm1, ...t.arm1); gl.uniform3f(u.arm2, ...t.arm2);
    gl.uniform2f(u.res, s.w, s.h); gl.uniform3f(u.lens, ...s.lens); gl.uniform1f(u.time, s.clock);
    gl.uniform1f(u.intro, ie); gl.uniform1f(u.dpr, s.dpr); gl.uniform3f(u.touch, s.touch.x, s.touch.y, s.touch.k);
    gl.drawArrays(gl.POINTS, 0, N_DISC + N_STARS);
    document.documentElement.dataset.galaxy = s.raf ? 'running' : 'still';
  }
  function frame(now) {
    s.raf = 0;
    if (!s.on || document.hidden || rm.matches) return;
    s.raf = requestAnimationFrame(frame);
    if (!frameDue(s.last, now)) return;
    const dt = Math.min(now - s.last, 100); s.last = now;
    s.clock += dt / 1000;
    const tk = s.touch; tk.k += ((tk.held ? 1 : 0) - tk.k) * Math.min(dt / (tk.held ? 120 : 600), 1);
    draw(now);
  }
  function kick() {
    resize();
    if (!s.on) return;
    if (rm.matches || document.hidden) { cancelAnimationFrame(s.raf); s.raf = 0; s.intro0 = null; draw(performance.now()); return; }
    if (!s.raf) { s.last = -1e9; s.raf = requestAnimationFrame(frame); }
  }
  // the page can move without a resize (keyboard opening, scroll): re-measure the lens only
  const follow = () => {
    if (!s.on) return;
    const b = lensEl.getBoundingClientRect();
    s.lens = [b.left + b.width / 2, b.top + b.height / 2, Math.max(b.width / 2, 40)];
    if (!s.raf) draw(performance.now());
  };
  addEventListener('scroll', follow, { passive: true });
  visualViewport?.addEventListener('resize', follow);
  visualViewport?.addEventListener('scroll', follow);
  document.addEventListener('visibilitychange', kick);
  rm.addEventListener?.('change', kick);
  addEventListener('resize', kick);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); s.on = false; document.documentElement.classList.remove('gl'); });
  // touch anywhere on the screen bends the dots near the finger; the lens itself never moves
  const host = document;
  const at = e => { s.touch.x = e.clientX; s.touch.y = e.clientY; };
  host.addEventListener('pointerdown', e => { at(e); s.touch.held = true; }, { passive: true });
  host.addEventListener('pointermove', e => { if (s.touch.held) at(e); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) host.addEventListener(ev, () => { s.touch.held = false; }, { passive: true });

  document.documentElement.classList.add('gl');
  return {
    // shown: the home is on screen. intro: play the ≤1 s condense (app open only).
    show(shown, intro = false) {
      s.on = shown;
      if (!shown) { cancelAnimationFrame(s.raf); s.raf = 0; canvas.width = canvas.width; document.documentElement.dataset.galaxy = 'off'; return; }   // resetting the size empties the buffer for sure (a clear alone could leave the last frame on screen)
      if (intro && !rm.matches) s.intro0 = performance.now();
      kick();
    },
    relayout: kick,
    // the galaxy gathers around this element (the home lens, or the weight on the weigh-in screen)
    setLens(el, theme = 'home') { lensEl = el; s.theme = theme; kick(); }
  };
}
