// ================= AirBrush =================

const W = 640, H = 480;

const $ = (id) => document.getElementById(id);
const video = $("video");
const camCanvas = $("camCanvas");
const paintCanvas = $("paintCanvas");
const camCtx = camCanvas.getContext("2d");
const paintCtx = paintCanvas.getContext("2d");
const statusEl = $("status");

// ---------- state ----------
let color = "#e63946";
let size = 4;
let tool = "pen";
let strokes = [];
let current = null;
let lastPoint = null;
let stableGesture = "none";
let gestureCount = 0;
let started = false;
let drawEnabled = true;       // false after "Done drawing" or inside the gallery
let currentView = "draw";
let currentFolder = null;     // album folder of the drawing being finished
let lastResult = null;        // the image just generated (not in the gallery until "Add to gallery")

// ---------- output styles ----------
const STYLES = [
  { id: "realistic",  label: "Realistic image",   prompt: "realistic photo, ultra detailed, natural lighting, sharp focus" },
  { id: "bw",         label: "Black & white",      prompt: "black and white photograph, monochrome, high contrast, dramatic shading" },
  { id: "watercolor", label: "Watercolour",        prompt: "watercolor painting, soft washes of colour, paper texture, delicate brushwork" },
  { id: "oil",        label: "Oil painting",       prompt: "oil painting, thick brush strokes, rich colours, canvas texture, masterpiece" },
  { id: "pencil",     label: "Pencil sketch",      prompt: "detailed pencil sketch, graphite shading, hand drawn on paper" },
  { id: "cartoon",    label: "Cartoon",            prompt: "cartoon illustration, bold outlines, bright flat colours, cute" },
  { id: "anime",      label: "Anime",              prompt: "anime style illustration, vibrant colours, clean lines, studio quality" },
  { id: "pixel",      label: "Pixel art",          prompt: "pixel art, 16-bit retro game style, limited colour palette" },
  { id: "3d",         label: "3D render",          prompt: "3D render, soft studio lighting, smooth materials, octane render" },
  { id: "comic",      label: "Comic book",         prompt: "comic book art, ink outlines, halftone dots, dynamic colours" },
];
let selectedStyle = "realistic";

const stylesBox = $("styles");
STYLES.forEach((s) => {
  const b = document.createElement("button");
  b.className = "chip" + (s.id === selectedStyle ? " active" : "");
  b.textContent = s.label;
  b.onclick = () => {
    selectedStyle = s.id;
    stylesBox.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    b.classList.add("active");
  };
  stylesBox.appendChild(b);
});

// ---------- colour swatches ----------
// [hex, name]: the name is what the AI is told when it recreates your colours
const PALETTE = [
  ["#1a1625", "black"], ["#4a4660", "slate grey"], ["#9a97ad", "light grey"], ["#fbf7ef", "white"],
  ["#e63946", "crimson red"], ["#ff6b5e", "coral"], ["#ff9a4d", "orange"], ["#c9822b", "ochre"], ["#ffc65c", "golden yellow"], ["#fde68a", "pale yellow"],
  ["#b9d96c", "lime green"], ["#5f7a4a", "moss green"], ["#3ec28f", "emerald green"], ["#2a8f7b", "teal"], ["#19c6d9", "turquoise"],
  ["#58a6ff", "sky blue"], ["#2f5bea", "cobalt blue"], ["#1e2f8a", "navy blue"], ["#7c5cff", "violet"], ["#b794f6", "lavender"],
  ["#d946ef", "fuchsia"], ["#ff7eb6", "pink"], ["#f9c5d1", "light pink"], ["#8c2f4b", "burgundy"], ["#8a5a3c", "brown"], ["#e8c9a0", "sand beige"],
];
const COLORS = PALETTE.map((p) => p[0]);
const swatchBox = $("swatches");
COLORS.forEach((c) => {
  const d = document.createElement("div");
  d.className = "swatch" + (c === color ? " active" : "");
  d.style.backgroundColor = c;
  d.dataset.color = c;
  d.title = c;
  d.onclick = () => setColor(c);
  swatchBox.appendChild(d);
});
function setColor(c, fromWheel) {
  color = c.toLowerCase();
  $("hexIn").value = color;
  $("wheelPrev").style.background = color;
  document.querySelectorAll(".swatch").forEach((s) =>
    s.classList.toggle("active", s.dataset.color === color)
  );
  if (!fromWheel) syncWheel(color);
  setTool("pen");
}

// ---------- custom colour wheel (hue around, saturation outwards, brightness slider) ----------
const wheel = $("wheel"), wctx = wheel.getContext("2d");
let wh = 0, ws = 1, wv = 1;   // hue 0-360, saturation 0-1, brightness 0-1
function hsv2rgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
const rgb2hex = (r, g, b) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
function hex2hsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
function drawWheel() {
  const N = wheel.width, R = N / 2;
  const img = wctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const [r, g, b] = hsv2rgb(hue, d / R, wv);
      const i = (y * N + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  wctx.putImageData(img, 0, 0);
  const mx = R + Math.cos(wh * Math.PI / 180) * ws * (R - 1), my = R + Math.sin(wh * Math.PI / 180) * ws * (R - 1);
  wctx.beginPath(); wctx.arc(mx, my, 8, 0, Math.PI * 2);
  wctx.lineWidth = 3; wctx.strokeStyle = "#fff"; wctx.stroke();
  wctx.lineWidth = 1; wctx.strokeStyle = "#000"; wctx.beginPath(); wctx.arc(mx, my, 9.5, 0, Math.PI * 2); wctx.stroke();
}
function syncWheel(hex) {
  const v = hex2hsv(hex);
  wh = v.h; ws = v.s; wv = Math.max(v.v, 0.1);
  $("bright").value = Math.round(wv * 100);
  drawWheel();
}
function wheelPick(e) {
  const r = wheel.getBoundingClientRect(), R = r.width / 2;
  const dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
  wh = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  ws = Math.min(1, Math.hypot(dx, dy) / R);
  drawWheel();
  setColor(rgb2hex(...hsv2rgb(wh, ws, wv)), true);
}
let wheelDown = false;
wheel.onpointerdown = (e) => { wheelDown = true; wheel.setPointerCapture(e.pointerId); wheelPick(e); };
wheel.onpointermove = (e) => { if (wheelDown) wheelPick(e); };
wheel.onpointerup = () => { wheelDown = false; };
$("bright").oninput = (e) => {
  wv = +e.target.value / 100;
  drawWheel();
  setColor(rgb2hex(...hsv2rgb(wh, ws, wv)), true);
};
$("hexIn").oninput = (e) => {
  let v = e.target.value.trim();
  if (v && v[0] !== "#") v = "#" + v;
  if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v);
};
$("wheelBtn").onclick = () => {
  const pop = $("wheelPop");
  pop.hidden = !pop.hidden;
  if (!pop.hidden) syncWheel(color);
};
document.addEventListener("mousedown", (e) => {
  if (!$("wheelPop").hidden && !e.target.closest(".custom-wrap")) $("wheelPop").hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("wheelPop").hidden = true; });

// ---------- size / tool / undo / clear ----------
$("size").oninput = (e) => { size = +e.target.value; $("sizeVal").textContent = size; };
function setTool(t) {
  tool = t;
  $("penBtn").classList.toggle("active", t === "pen");
  $("eraserBtn").classList.toggle("active", t === "eraser");
}
$("penBtn").onclick = () => setTool("pen");
$("eraserBtn").onclick = () => setTool("eraser");
$("undoBtn").onclick = () => { current = null; strokes.pop(); redraw(); };
$("clearBtn").onclick = () => { current = null; strokes = []; redraw(); };

// ---------- drawing helpers ----------
function segment(ctx, s, a, b) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = s.size * (s.erase ? 5 : 2);   // size 1-10 on the slider
  if (s.erase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = s.color;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function drawBoth(s, a, b) {
  segment(camCtx, s, a, b);
  segment(paintCtx, s, a, b);
}
function redraw() {
  camCtx.clearRect(0, 0, W, H);
  paintCtx.clearRect(0, 0, W, H);
  for (const s of strokes) {
    for (let i = 0; i < s.pts.length; i++) {
      drawBoth(s, s.pts[Math.max(0, i - 1)], s.pts[i]);
    }
  }
}
function snapshot() {
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const c = out.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, H);
  c.drawImage(paintCanvas, 0, 0);
  return out.toDataURL("image/png");
}
function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- gesture detection ----------
function fingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y - 0.02; }

function getGesture(lm) {
  const index = fingerUp(lm, 8, 6);
  const middle = fingerUp(lm, 12, 10);
  const ring = fingerUp(lm, 16, 14);
  const pinky = fingerUp(lm, 20, 18);
  if (index && !middle && !ring && !pinky) return "draw";
  if (index && middle && !ring && !pinky) return "erase";
  if (index && middle && ring && pinky) return "palm";
  return "none";
}

// ---------- hand skeleton overlay: coloured bones drawn over your hand ----------
const handCanvas = $("handCanvas"), handCtx = handCanvas.getContext("2d");
const MODE_TEXT = { draw: "Drawing", erase: "Erasing", palm: "Paused", none: "Ready" };
const BONE_COL = { carpal: "#c9a7ef", meta: "#ecc76a", prox: "#b5d98a", mid: "#8fb8e8", dist: "#f4a583" };
const BONE_W = { meta: 13, prox: 11, mid: 9.5, dist: 8.5 };
const OUTLINE = "#2b2a3a";
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function clearHand() { handCtx.clearRect(0, 0, W, H); }

// Turn a hand point (0..1 of the camera picture) into canvas pixels, exactly where it appears on the
// webcam box. The video is mirrored and cropped to fill the box, so we must undo the same crop here.
function toCanvas(p) {
  const vw = video.videoWidth || W, vh = video.videoHeight || H;
  const sc = Math.max(W / vw, H / vh);
  const x = p.x * vw * sc + (W - vw * sc) / 2;
  const y = p.y * vh * sc + (H - vh * sc) / 2;
  return { x: W - x, y };
}

function drawHand(lm) {
  const c = handCtx;
  c.clearRect(0, 0, W, H);
  const P = lm.map(toCanvas);   // same mirror and crop as the video
  const s = Math.min(1.5, Math.max(0.55, Math.hypot(P[0].x - P[9].x, P[0].y - P[9].y) / 115));   // bone size follows hand size
  c.save();
  c.lineCap = "round"; c.lineJoin = "round";

  // wrist bones (purple)
  const wrist = [lerp(P[0], P[1], 0.75), lerp(P[0], P[5], 0.5), lerp(P[0], P[9], 0.45), lerp(P[0], P[13], 0.45), lerp(P[0], P[17], 0.5), lerp(P[0], P[17], 0.85), P[0]];
  c.beginPath(); wrist.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
  c.strokeStyle = OUTLINE; c.lineWidth = 10 * s + 3; c.stroke();
  c.strokeStyle = BONE_COL.carpal; c.fillStyle = BONE_COL.carpal; c.lineWidth = 10 * s; c.stroke(); c.fill();

  // one bone = a shaft with rounded knobs at both ends, dark outline, small highlight
  function bone(a, b, kind) {
    const w = BONE_W[kind] * s, r = w * 0.62;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    const inset = Math.min(r * 0.85, d * 0.3);
    const a2 = { x: a.x + ux * inset, y: a.y + uy * inset }, b2 = { x: b.x - ux * inset, y: b.y - uy * inset };
    for (const pass of [0, 1]) {
      const extra = pass ? 0 : 3;
      c.strokeStyle = c.fillStyle = pass ? BONE_COL[kind] : OUTLINE;
      c.lineWidth = w * 0.78 + extra;
      c.beginPath(); c.moveTo(a2.x, a2.y); c.lineTo(b2.x, b2.y); c.stroke();
      [a2, b2].forEach((p) => { c.beginPath(); c.arc(p.x, p.y, r + extra / 2, 0, Math.PI * 2); c.fill(); });
    }
    c.strokeStyle = "rgba(255, 255, 255, 0.35)"; c.lineWidth = w * 0.16;
    c.beginPath(); c.moveTo(a2.x - uy * w * 0.2, a2.y + ux * w * 0.2); c.lineTo(b2.x - uy * w * 0.2, b2.y + ux * w * 0.2); c.stroke();
  }

  bone(P[1], P[2], "meta");                                             // thumb: base bone
  [5, 9, 13, 17].forEach((m) => bone(lerp(P[0], P[m], 0.42), P[m], "meta"));   // palm bones (yellow)
  [[5, 6], [9, 10], [13, 14], [17, 18], [2, 3]].forEach(([a, b]) => bone(P[a], P[b], "prox"));   // green
  [[6, 7], [10, 11], [14, 15], [18, 19]].forEach(([a, b]) => bone(P[a], P[b], "mid"));           // blue
  [[7, 8], [11, 12], [15, 16], [19, 20], [3, 4]].forEach(([a, b]) => bone(P[a], P[b], "dist"));  // orange (fingertips)
  c.restore();
}

// ---------- cursor dot on the webcam and the canvas ----------
function showCursor(p, gesture) {
  for (const id of ["camCursor", "paintCursor"]) {
    const el = $(id);
    if (!p) { el.style.display = "none"; continue; }
    el.style.display = "block";
    el.style.left = (p.x / W) * 100 + "%";
    el.style.top = (p.y / H) * 100 + "%";
    el.style.borderColor =
      gesture === "erase" ? "#ff3b30" : gesture === "draw" ? color : "#ffffff";
  }
}
function setMode(m) { const el = $("modeLabel"); if (el.textContent !== m) el.textContent = m; }

// ---------- main hand loop: gestures only draw. Buttons and colours use the mouse. ----------
const SETTLE_MS = 320;   // after an open palm, wait this long before drawing starts (no accidental marks)
let pointerExitTime = 0;

function onResults(results) {
  // Locked (after "Done drawing" or inside the gallery): ignore the hand completely, even if it is raised.
  if (!drawEnabled) {
    current = null; lastPoint = null; stableGesture = "none"; gestureCount = 0;
    pointerExitTime = performance.now();   // when drawing resumes, wait a moment before the first mark
    showCursor(null); clearHand(); setMode("Locked");
    if (currentView === "draw") statusEl.textContent = "Drawing is locked. Click Back to drawing to continue.";
    return;
  }
  const hands = results.multiHandLandmarks;
  if (!hands || hands.length === 0) {
    current = null; lastPoint = null; showCursor(null); clearHand(); setMode("No hand");
    if (drawEnabled) statusEl.textContent = "Show your hand to the camera";
    return;
  }
  const lm = hands[0];
  const raw = getGesture(lm);
  if (raw === stableGesture) { gestureCount = 0; }
  else if (++gestureCount >= 3) { stableGesture = raw; gestureCount = 0; current = null; }
  const g = stableGesture;
  try { drawHand(lm); } catch (e) { console.error("skeleton error", e); }

  const now = performance.now();
  let fx = lm[8].x, fy = lm[8].y;
  if (g === "erase") { fx = (lm[8].x + lm[12].x) / 2; fy = (lm[8].y + lm[12].y) / 2; }
  const target = toCanvas({ x: fx, y: fy });
  lastPoint = lastPoint
    ? { x: lastPoint.x + (target.x - lastPoint.x) * 0.5, y: lastPoint.y + (target.y - lastPoint.y) * 0.5 }
    : target;
  showCursor(lastPoint, g);
  setMode(MODE_TEXT[g] || "Ready");

  if (g === "palm") {
    pointerExitTime = now;
    current = null;
    statusEl.textContent = "Paused (open palm). Raise 1 finger to draw";
    return;
  }

  // just came from the open palm: show where the pen will start, but do not mark the canvas yet
  if (now - pointerExitTime < SETTLE_MS) {
    current = null;
    statusEl.textContent = "Get ready: hold up one finger to draw";
    return;
  }

  if (g === "draw" || g === "erase") {
    const erase = g === "erase" || tool === "eraser";
    if (!current || current.erase !== erase) {
      current = { erase, color, size, pts: [{ ...lastPoint }] };
      strokes.push(current);
      drawBoth(current, lastPoint, lastPoint);
    } else {
      const prev = current.pts[current.pts.length - 1];
      const p = { ...lastPoint };
      current.pts.push(p);
      drawBoth(current, prev, p);
    }
    statusEl.textContent = erase ? "Erasing" : "Drawing";
  } else {
    current = null;
    statusEl.textContent = "Waiting… raise 1 finger to draw";
  }
}

// confirm box that works with gestures (replaces the browser's confirm pop-up)
function askConfirm(msg) {
  return new Promise((resolve) => {
    $("dlgText").textContent = msg;
    $("dlg").hidden = false;
    const done = (v) => { $("dlg").hidden = true; resolve(v); };
    $("dlgYes").onclick = () => done(true);
    $("dlgNo").onclick = () => done(false);
  });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("dlg").hidden) $("dlgNo").click(); });

$("hexIn").value = color; $("wheelPrev").style.background = color;

// ---------- start camera + hand tracking ----------
async function startApp() {
  if (started) return;
  started = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    statusEl.textContent = "Camera blocked. Click the camera icon in the address bar and allow it, then reload.";
    started = false;
    return;
  }

  console.log("AirBrush v7 loaded");
  statusEl.textContent = "Loading hand tracking (first time takes a few seconds)…";
  const hands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  hands.onResults(onResults);

  let busy = false;
  async function loop() {
    if (!busy && video.readyState >= 2) {
      busy = true;
      try { await hands.send({ image: video }); } catch (e) { console.error(e); }
      busy = false;
    }
    requestAnimationFrame(loop);
  }
  loop();
}

// ---------- front page: brush strokes that follow the pointer, then fade away ----------
(function () {
  const cv = $("fx"), ctx = cv.getContext("2d"), landing = $("landing");
  const INKS = ["#ffe2b0", "#9bd8ff", "#ffffff", "#5b8cff", "#ffb38a"];
  const LIFE = 1700;   // how long a stroke stays (ms)
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let strokes = [], cur = null, nextInk = 0, dpr = 1;
  function fit() { dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
  fit(); addEventListener("resize", fit);
  function add(x, y) {
    const now = performance.now();
    if (!cur || now - cur.last > 140) {
      cur = { pts: [], last: now, ink: INKS[nextInk++ % INKS.length],
              hairs: Array.from({ length: 7 }, () => ({ o: Math.random() * 2 - 1, w: 0.6 + Math.random() * 1.6, a: 0.25 + Math.random() * 0.5 })) };
      strokes.push(cur);
    }
    const p = cur.pts[cur.pts.length - 1];
    if (p && Math.hypot(x - p.x, y - p.y) < 4) return;
    cur.pts.push({ x, y, t: now }); cur.last = now;
  }
  landing.addEventListener("pointermove", (e) => add(e.clientX, e.clientY));
  landing.addEventListener("pointerleave", () => (cur = null));
  const t0 = performance.now(), SWEEP = 2400;
  function frame(now) {
    if (landing.hidden) return;
    if (!calm && now - t0 < SWEEP) {            // one opening stroke so the page paints itself on load
      const k = (now - t0) / SWEEP;
      add(innerWidth * (0.08 + 0.84 * k), innerHeight * (0.52 + Math.sin(k * 7) * 0.13 - k * 0.04));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    strokes = strokes.filter((s) => { s.pts = s.pts.filter((p) => now - p.t < LIFE); return s.pts.length > 0; });
    if (cur && !strokes.includes(cur)) cur = null;
    for (const s of strokes) {
      ctx.strokeStyle = s.ink;
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i], f = 1 - (now - b.t) / LIFE;   // 1 = fresh paint, 0 = gone
        const half = 16 * (0.3 + 0.7 * f);
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
        ctx.globalAlpha = 0.32 * f; ctx.lineWidth = half * 1.6;                 // wet body of the stroke
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        for (const h of s.hairs) {                                              // bristle streaks
          ctx.globalAlpha = h.a * f; ctx.lineWidth = h.w;
          ctx.beginPath(); ctx.moveTo(a.x + nx * h.o * half, a.y + ny * h.o * half); ctx.lineTo(b.x + nx * h.o * half, b.y + ny * h.o * half); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

$("startBtn").onclick = () => {
  $("landing").hidden = true;
  $("app").hidden = false;
  startApp();
};

// ================= Art gallery storage (IndexedDB, free, in your browser) =================
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("airbrush-gallery", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pieces", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("pieces", mode);
    const req = fn(t.objectStore("pieces"));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const dbPut = (f) => dbRun("readwrite", (s) => s.put(f));
const dbAll = () => dbRun("readonly", (s) => s.getAll());
const dbDelete = (id) => dbRun("readwrite", (s) => s.delete(id));

// ================= Views (Draw / Art gallery) =================
function showView(name) {
  currentView = name;
  $("drawView").hidden = name !== "draw";
  $("albumView").hidden = name !== "album";
  $("tabDraw").classList.toggle("active", name === "draw");
  $("tabAlbum").classList.toggle("active", name === "album");
  if (name === "album") {
    drawEnabled = false;
    renderGallery();
  } else {
    drawEnabled = $("finish").hidden; // keep paused if the "finish" part is open
  }
  window.scrollTo({ top: 0 });
}
$("tabDraw").onclick = () => showView("draw");
$("tabAlbum").onclick = () => showView("album");

// ---------- which colours were used (sent to the AI so it keeps them) ----------
const COLOR_NAMES = {
  "#000000": "black", "#808080": "grey", "#800000": "dark red", "#808000": "olive green", "#008000": "dark green",
  "#008080": "teal", "#000080": "navy blue", "#800080": "purple", "#808040": "khaki", "#004040": "dark teal",
  "#0080ff": "sky blue", "#004080": "dark blue", "#8000ff": "violet", "#804000": "brown", "#c0c0c0": "light grey",
  "#ff0000": "red", "#ffff00": "yellow", "#00ff00": "bright green", "#00ffff": "cyan", "#0000ff": "blue",
  "#ff00ff": "magenta", "#ffff80": "pale yellow", "#00ff80": "mint green", "#80ffff": "light cyan",
  "#8080ff": "periwinkle blue", "#ff0080": "pink", "#ff8040": "orange", "#ffc0cb": "light pink",
};
PALETTE.forEach(([hex, name]) => (COLOR_NAMES[hex] = name));
function nearestColorName(hex) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = "", bd = Infinity;
  for (const [h, n] of Object.entries(COLOR_NAMES)) {
    const [x, y, z] = rgb(h);
    const d = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function usedColorNames() {
  const w = {};
  for (const st of strokes) {
    if (st.erase || st.color.toLowerCase() === "#ffffff") continue;
    w[st.color] = (w[st.color] || 0) + st.pts.length * st.size;
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const names = [];
  Object.entries(w).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => {
    const n = nearestColorName(c);
    if (v / total >= 0.08 && !names.includes(n)) names.push(n);
  });
  return names.slice(0, 4);
}

// ================= Done drawing =================
$("doneBtn").onclick = async () => {
  if (strokes.length === 0) {
    statusEl.textContent = "Draw something first, then click Done drawing.";
    return;
  }
  const img = snapshot();
  drawEnabled = false;
  current = null;
  $("doneImg").src = img;
  $("resultImg").hidden = true;
  $("addGalleryBtn").hidden = true;
  lastResult = null;
  $("genStatus").textContent = "";
  $("finish").hidden = false;
  currentFolder = { drawing: img, colors: usedColorNames() };

  $("finish").scrollIntoView({ behavior: "smooth" });
};

$("downloadDrawing").onclick = () => download($("doneImg").src, "airbrush-drawing.png");

$("backToDraw").onclick = () => {
  $("finish").hidden = true;
  drawEnabled = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ================= Voice input (free, built into Chrome / Edge) =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
function setupMic(btnId, boxId) {
  const btn = $(btnId);
  btn.onclick = () => {
    if (!SR) {
      $("genStatus").textContent = "Voice input works in Chrome or Edge. Please type instead.";
      return;
    }
    if (recognition) { recognition.stop(); return; }
    recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      $(boxId).value = ($(boxId).value ? $(boxId).value + " " : "") + text;
    };
    recognition.onerror = () => { $("genStatus").textContent = "Couldn't hear you. Check the microphone permission."; };
    recognition.onend = () => { recognition = null; btn.classList.remove("active"); };
    recognition.start();
    btn.classList.add("active");
  };
}
setupMic("micBtn", "desc");
setupMic("micBtn2", "subject");

// ================= Generate image with Cloudflare Workers AI (free, fast) =================
// Paste your Cloudflare Worker link below (see the setup steps). Ends with .workers.dev
const WORKER_URL = "https://airbrush.buildsbyvb.workers.dev";

async function generateWithCloudflare(sketchDataUrl, prompt) {
  const image = await sketchToBase64(sketchDataUrl);   // sketch on white background, 512x384
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.image) throw new Error(json.error || `Fast service error (${res.status})`);
  return await toPngDataUrl(json.image);
}

// ================= Generate image (free AI through AI Horde, no server, no sign-in) =================
// AI Horde is a free community service. "0000000000" is its public anonymous key.
// (Optional: put your own free key from https://aihorde.net/register here for a faster queue.)
const HORDE_KEY = "0000000000";
const HORDE = "https://aihorde.net/api/v2";

function errText(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  return e.message || (e.error && (e.error.message || e.error)) || JSON.stringify(e);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Put the drawing on a white background (the canvas is transparent) and shrink it to 512x384.
function sketchToBase64(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 384;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, 512, 384);
      x.drawImage(img, 0, 0, 512, 384);
      resolve(c.toDataURL("image/jpeg", 0.92).split(",")[1]);
    };
    img.onerror = () => reject(new Error("Could not read the drawing."));
    img.src = dataUrl;
  });
}

// Turn whatever Horde returns (link or base64 webp) into a PNG data URL.
async function toPngDataUrl(img) {
  let src = img;
  if (!img.startsWith("http") && !img.startsWith("data:")) src = "data:image/webp;base64," + img;
  const el = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not load the generated image."));
    i.src = src;
  });
  const c = document.createElement("canvas");
  c.width = el.naturalWidth; c.height = el.naturalHeight;
  c.getContext("2d").drawImage(el, 0, 0);
  return c.toDataURL("image/png");
}

// Pick a good Stable Diffusion 1.5 model that is online right now.
async function pickModel() {
  const preferred = ["Deliberate", "DreamShaper", "Realistic Vision V6.0 B1", "Anything v5", "stable_diffusion"];
  try {
    const r = await fetch(`${HORDE}/status/models?type=image`);
    const list = await r.json();
    const online = new Set(list.filter((m) => m.count > 0).map((m) => m.name));
    for (const p of preferred) if (online.has(p)) return p;
  } catch (e) { /* ignore, use default below */ }
  return "stable_diffusion";
}

async function generateWithHorde(sketchDataUrl, prompt, onStatus) {
  const source = await sketchToBase64(sketchDataUrl);
  const model = await pickModel();

  const body = {
    prompt: prompt + " ### text, watermark, signature, blurry, deformed, low quality",
    params: {
      sampler_name: "k_euler_a",
      cfg_scale: 7.5,
      denoising_strength: 0.65,   // lower = stays closer to your drawing, higher = more AI freedom
      width: 512,
      height: 384,
      steps: 28,
      n: 1,
      karras: true,
    },
    nsfw: false,
    censor_nsfw: true,
    models: [model],
    source_image: source,
    source_processing: "img2img",
    r2: false,
    shared: false,
    slow_workers: true,
  };

  const start = await fetch(`${HORDE}/generate/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: HORDE_KEY },
    body: JSON.stringify(body),
  });
  const startJson = await start.json().catch(() => ({}));
  if (!start.ok || !startJson.id) {
    throw new Error(startJson.message || `The free AI service refused the request (${start.status}).`);
  }
  const id = startJson.id;

  // wait for the result (max ~6 minutes)
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const c = await (await fetch(`${HORDE}/generate/check/${id}`)).json();
    if (c.faulted) throw new Error("The free AI service had a problem. Please click Generate again.");
    if (c.done) break;
    if (onStatus) onStatus(c);
    if (i === 119) {
      fetch(`${HORDE}/generate/status/${id}`, { method: "DELETE" }).catch(() => {});
      throw new Error("It took too long (the free service is busy). Please try again in a minute.");
    }
  }

  const res = await (await fetch(`${HORDE}/generate/status/${id}`)).json();
  const gen = res.generations && res.generations[0];
  if (!gen || !gen.img) throw new Error("No image came back. Please click Generate again.");
  if (gen.censored) throw new Error("The AI blocked this image. Try a different description.");
  return await toPngDataUrl(gen.img);
}

$("genBtn").onclick = async () => {
  if (!currentFolder) return;
  const style = STYLES.find((s) => s.id === selectedStyle);
  const subject = $("subject").value.trim();   // what the drawing is (e.g. "a tree")
  const desc = $("desc").value.trim();          // what to add (e.g. "a blue apple on the tree")
  // When there is no description, avoid style words that make the AI invent a scene (like "photo").
  const NO_SCENE_STYLE = {
    realistic: "photorealistic rendering of the drawn object only, soft even studio lighting, sharp focus, highly detailed",
    bw: "black and white, monochrome, high contrast, dramatic shading",
  };
  const stylePrompt = desc ? style.prompt : (NO_SCENE_STYLE[style.id] || style.prompt);

  const colors = (currentFolder.colors || []).join(", ");
  const subjectLine = subject ? `The sketch shows ${subject}. ` : "";
  const colorLine = colors
    ? `The sketch uses these colours: ${colors}. Keep exactly these colours on the matching parts (for example a pink tree must stay pink). `
    : "Keep the colours of the sketch. ";
  const keepDrawing =
    "Image 0 is a hand-drawn sketch and it is the main subject. " + subjectLine + colorLine +
    "The drawn subject must keep EXACTLY the same shape, proportions, position and size as drawn. " +
    "Do not redesign it, replace it, move it, or swap it for a different generic version of the same thing. ";
  const realism = (style.id === "realistic" || style.id === "bw")
    ? "Make it look a little more realistic: add natural texture, soft shading and gentle lighting, while keeping the shape and the colours of the drawing. "
    : "";
  const addLine = desc
    ? `Add the following to the same picture, together with the drawn subject, without changing the subject itself: ${desc}. ` +
      "If a colour is stated for an added item, use exactly that colour (a blue apple must be blue). " +
      "If no colour is stated, use that item's natural colour (an apple is red). " +
      "Attach the added items naturally to the drawn subject with matching lighting, scale and shadows. "
    : "";

  const aiPrompt = desc
    ? "Edit image 0. " + keepDrawing +
      `Render the drawn subject in this style: ${stylePrompt}. ` + realism + addLine +
      "Never create a new picture from the description alone: the drawn subject must clearly be the one from image 0. " +
      "Do not add any text or watermark."
    : "Edit image 0. " + keepDrawing +
      `Only change how the drawn subject is rendered, in this style: ${stylePrompt}. ` + realism +
      "IMPORTANT: keep the background of image 0 exactly as it is: a pure, plain, empty white background filling the whole picture, like a blank white painting canvas. " +
      "There must be NO scenery, NO beach, NO sky, NO room, NO table or surface, NO hands, NO people, NO other objects and NO background details of any kind. " +
      "Only the drawn subject, alone, on plain white. " +
      "Do not add any text or watermark.";

  const hordeBase = `${stylePrompt}, ${subject ? subject + ", " : ""}the same drawn subject as in the sketch, same shapes, position and colours${colors ? " (" + colors + ")" : ""}`;
  const hordePrompt = desc
    ? `${hordeBase}, with ${desc}, high quality`
    : `${hordeBase}, isolated on a plain pure white background, nothing else, high quality`;

  const btn = $("genBtn");
  btn.disabled = true;
  lastResult = null;
  $("addGalleryBtn").hidden = true;
  const t0 = Date.now();
  let queueInfo = "";
  let hint = "(usually 5–20 seconds, keep this tab open)";
  const timer = setInterval(() => {
    $("genStatus").textContent =
      `Generating… ${Math.round((Date.now() - t0) / 1000)}s ${queueInfo}${hint}`;
  }, 1000);

  try {
    let image;
    try {
      if (WORKER_URL.startsWith("PASTE")) throw new Error("Fast service not set up yet");
      image = await generateWithCloudflare(currentFolder.drawing, aiPrompt);
    } catch (fastErr) {
      console.warn("Fast service failed, using free backup:", fastErr);
      hint = "(fast service unavailable, using the free backup: 30 seconds to 3 minutes, keep this tab open)";
      image = await generateWithHorde(currentFolder.drawing, hordePrompt, (c) => {
        queueInfo = c.queue_position > 0 ? `· waiting in line: ${c.queue_position} ahead of you ` : "· drawing now ";
      });
    }
    clearInterval(timer);
    $("resultImg").src = image;
    $("resultImg").hidden = false;
    $("genStatus").textContent = 'Done! Choose "Add to gallery" to keep it.';
    lastResult = { style: style.label, prompt: [subject, desc].filter(Boolean).join("; "), image };
    const add = $("addGalleryBtn");
    add.textContent = "Add to gallery"; add.disabled = false; add.hidden = false;
  } catch (e) {
    clearInterval(timer);
    $("genStatus").textContent =
      "Error: " + errText(e) + " — you can click Generate image again.";
  }
  btn.disabled = false;
};

// ================= Art gallery =================
const fmt = (ms) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

$("addGalleryBtn").onclick = async () => {
  if (!lastResult || !currentFolder) return;
  const btn = $("addGalleryBtn");
  btn.disabled = true;
  try {
    const now = Date.now();
    await dbPut({ id: now, created: now, drawing: currentFolder.drawing, image: lastResult.image, style: lastResult.style, prompt: lastResult.prompt });
    btn.textContent = "Added to gallery";
    $("genStatus").textContent = "Saved. Open the Art gallery tab to see your drawing next to the generated image.";
  } catch (e) {
    console.error("Gallery save failed", e);
    btn.disabled = false;
    $("genStatus").textContent = "Couldn't save to the gallery. Please try again.";
  }
};

// one row per piece: your drawing on the left, the generated image on the right; newest rows go below older ones
async function renderGallery() {
  let items = [];
  try { items = await dbAll(); } catch (e) { console.error(e); }
  items.sort((a, b) => a.id - b.id);

  const grid = $("albumGrid");
  grid.innerHTML = "";
  $("albumEmpty").hidden = items.length > 0;
  for (const it of items) {
    const row = document.createElement("article");
    row.className = "piece";
    row.innerHTML = `
      <div class="pair">
        <figure><img alt="Your drawing" /><figcaption>My drawing</figcaption><button class="tool dl-a">Download</button></figure>
        <figure><img alt="Generated image" /><figcaption class="cap-b"></figcaption><button class="tool dl-b">Download</button></figure>
      </div>
      <div class="piece-foot"><span class="when"></span><button class="tool del">Delete</button></div>`;
    const imgs = row.querySelectorAll("img");
    imgs[0].src = it.drawing;
    imgs[1].src = it.image;
    row.querySelector(".cap-b").textContent = it.style + (it.prompt ? " – " + it.prompt : "");
    row.querySelector(".when").textContent = fmt(it.created);
    row.querySelector(".dl-a").onclick = () => download(it.drawing, "airbrush-drawing.png");
    row.querySelector(".dl-b").onclick = () => download(it.image, "airbrush-generated.png");
    row.querySelector(".del").onclick = async () => {
      if (!(await askConfirm("Delete this drawing and its generated image from the gallery?"))) return;
      try { await dbDelete(it.id); } catch (e) { console.error(e); }
      renderGallery();
    };
    grid.appendChild(row);
  }
}
