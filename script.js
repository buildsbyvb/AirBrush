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
let color = "#ee3b45";
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
  { id: "realistic",  label: "Realistic image",   prompt: "a photorealistic photograph with real materials, natural lighting, soft realistic shadows, depth and sharp focus" },
  { id: "bw",         label: "Black & white",      prompt: "a black and white photograph in the monochrome style of mid-century photography: the drawn colours converted to matching grey tones, realistic tonal shading, texture and fine film grain" },
  { id: "watercolor", label: "Watercolour",        prompt: "a watercolor painting with soft washes of colour, paper texture and delicate brushwork" },
  { id: "oil",        label: "Oil painting",       prompt: "an oil painting with visible brush strokes, rich colours and canvas texture" },
  { id: "pencil",     label: "Pencil sketch",      prompt: "a detailed pencil sketch with graphite shading, hand drawn on paper" },
  { id: "cartoon",    label: "Cartoon",            prompt: "a cartoon illustration with bold outlines and flat colours" },
  { id: "anime",      label: "Anime",              prompt: "an anime style illustration with clean lines and vibrant colours" },
  { id: "pixel",      label: "Pixel art",          prompt: "pixel art in a 16-bit retro game style with a limited colour palette" },
  { id: "3d",         label: "3D render",          prompt: "a 3D render with soft studio lighting and smooth materials" },
  { id: "comic",      label: "Comic book",         prompt: "comic book art with ink outlines, halftone dots and dynamic colours" },
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
// [hex, name]: the name is what the AI is told when it recreates your colors
const PALETTE = [
  ["#ee3b45", "bright red"], ["#ff8a3d", "orange"], ["#ffd23f", "bright yellow"], ["#a6e04a", "lime green"], ["#22b36b", "green"],
  ["#19d3e6", "cyan"], ["#5aaeff", "sky blue"], ["#2f5bea", "blue"], ["#8b4fe0", "purple"], ["#ff7eb6", "pink"],
  ["#e22fc4", "magenta"], ["#8a5a3c", "brown"], ["#14121c", "black"], ["#ffffff", "white"], ["#8e8ea0", "grey"],
];
const COLORS = PALETTE.map((p) => p[0]);
const swatchBox = $("swatches");
PALETTE.forEach(([c, name]) => {
  const d = document.createElement("button");
  d.type = "button";
  d.className = "swatch" + (c === color ? " active" : "");
  d.style.backgroundColor = c;
  d.dataset.color = c;
  d.title = name;
  d.setAttribute("aria-label", name);
  d.onclick = () => setColor(c);
  swatchBox.appendChild(d);
});
function setColor(c, fromWheel) {
  color = c.toLowerCase();
  current = null;   // the next stroke starts fresh in the new color; strokes already drawn keep their own color
  $("hexIn").value = color;
  $("wheelPrev").style.background = color;
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.color === color));
  const custom = !COLORS.includes(color);
  $("wheelBtn").classList.toggle("active", custom);
  $("wheelDot").style.background = custom ? color : "";
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
  if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + [...v.slice(1)].map((x) => x + x).join("");
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
let sideTimer = null;
function sideSay(t) { const el = $("sideMsg"); el.textContent = t; clearTimeout(sideTimer); sideTimer = setTimeout(() => (el.textContent = ""), 3500); }
$("size").oninput = (e) => { size = +e.target.value; $("sizeVal").textContent = size; current = null; };   // applies to the very next stroke
function setTool(t) { tool = t; current = null; }   // the brush/eraser buttons are gone: drawing is the brush, the two-finger gesture is the eraser
$("undoBtn").onclick = () => {
  if (!strokes.length) { sideSay("Nothing to undo."); return; }
  current = null; strokes.pop(); redraw();
};
$("clearBtn").onclick = async () => {
  if (!strokes.length) { sideSay("The canvas is already empty."); return; }
  if (!(await askConfirm("Clear the whole drawing? This can't be undone."))) return;
  current = null; strokes = []; redraw();
};

// one place that switches hand-drawing on or off; hand tracking itself keeps running either way
function setDrawing(on) {
  drawEnabled = on; current = null; lastPoint = null;
  $("drawState").className = "state " + (on ? "on" : "off");
  $("drawStateText").textContent = on ? "Drawing active" : "Drawing paused";
  $("resumeBtn").disabled = on;
}

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

// ---------- hand skeleton overlay: one visible point for every landmark the model returns ----------
// MediaPipe Hands returns 21 landmarks per hand (0 wrist, 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky).
// The point count below always follows the model's actual output (lm.length).
const handCanvas = $("handCanvas"), handCtx = handCanvas.getContext("2d");
const MODE_TEXT = { draw: "Drawing", erase: "Erasing", palm: "Paused", none: "Ready" };
const HAND_LINES = [
  [0, 1], [1, 2], [2, 3], [3, 4],            // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],            // index
  [5, 9], [9, 10], [10, 11], [11, 12],       // middle
  [9, 13], [13, 14], [14, 15], [15, 16],     // ring
  [13, 17], [17, 18], [18, 19], [19, 20],    // pinky
  [0, 17],                                   // outer edge of the palm
];
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

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

// Tech look: hairline skeleton with glow, ring joints, reticles on the fingertips, a faint palm mesh and a slow scanning ring
const FINGER_COL = ["#ff7eb3", "#ffb86b", "#ffe66d", "#7ee8d1", "#8ab4ff"];   // thumb, index, middle, ring, pinky
const fingerOf = (i) => Math.min(4, Math.floor((i - 1) / 4));
function drawHand(lm) {
  const c = handCtx;
  c.clearRect(0, 0, W, H);
  const P = lm.map(toCanvas);   // same mirror and crop as the video, one point per landmark
  const hand = P.length > 9 ? Math.hypot(P[0].x - P[9].x, P[0].y - P[9].y) : 100;
  const s = Math.min(1.3, Math.max(0.75, hand / 115));
  c.save(); c.lineCap = "round"; c.lineJoin = "round";
  if (P.length > 17) {   // palm mesh, fingertip web and scanning ring
    c.beginPath(); [0, 1, 5, 9, 13, 17].forEach((i, k) => (k ? c.lineTo(P[i].x, P[i].y) : c.moveTo(P[i].x, P[i].y))); c.closePath();
    c.fillStyle = "rgba(126, 232, 209, 0.05)"; c.fill();
    c.strokeStyle = "rgba(255,255,255,0.2)"; c.lineWidth = 0.6; c.setLineDash([2, 3]); c.stroke();
    [[4, 8], [8, 12], [12, 16], [16, 20]].forEach(([a, b]) => { c.beginPath(); c.moveTo(P[a].x, P[a].y); c.lineTo(P[b].x, P[b].y); c.stroke(); });
    c.setLineDash([]);
  }
  HAND_LINES.forEach(([a, b]) => {   // hairline bones with a soft glow
    if (!P[a] || !P[b]) return;
    const fin = b === a + 1 || (a === 0 && b === 1), col = fin ? FINGER_COL[fingerOf(b)] : "rgba(255,255,255,0.75)";
    c.strokeStyle = col; c.shadowColor = fin ? col : "#fff"; c.shadowBlur = 6; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(P[a].x, P[a].y); c.lineTo(P[b].x, P[b].y); c.stroke();
  });
  P.forEach((p, i) => {   // one ring for every landmark the model returns; fingertips get a reticle
    const tip = FINGERTIPS.has(i), col = i ? FINGER_COL[fingerOf(i)] : "#ffffff", r = (tip ? 4.4 : 2.4) * s;
    c.shadowColor = col; c.shadowBlur = 5; c.strokeStyle = col; c.lineWidth = 0.9;
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fillStyle = "rgba(0,0,0,0.55)"; c.fill(); c.stroke();
    c.beginPath(); c.arc(p.x, p.y, 0.9, 0, Math.PI * 2); c.fillStyle = col; c.fill();
    if (tip) { c.lineWidth = 0.8; c.beginPath(); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, y]) => { c.moveTo(p.x + x * (r + 2), p.y + y * (r + 2)); c.lineTo(p.x + x * (r + 6 * s), p.y + y * (r + 6 * s)); }); c.stroke(); }
  });
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
    showCursor(null); setMode("Paused");
    const hs = results.multiHandLandmarks;
    if (hs && hs.length && currentView === "draw") { try { drawHand(hs[0]); } catch (err) { console.error(err); } } else clearHand();
    if (currentView === "draw") statusEl.textContent = "Drawing is paused. Click Resume drawing to continue.";
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

  if (!$("dlg").hidden) { current = null; lastPoint = null; showCursor(null); return; }
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

  console.log("AirBrush v11 loaded");
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

// ---------- ambient background: one or two long pastel brush strokes are painted across the screen, then slowly dissolve ----------
(function () {
  const host = $("paint"), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;   // calm: plain black
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d"); host.appendChild(cv); cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  const HUES = [345, 205, 265, 120, 22, 52, 172, 285];   // dusty pink, powder blue, lavender, sage, peach, pale yellow, turquoise, lilac
  const LIFE = 6500, N = 16, CHUNK = 8, R = (a, b) => a + Math.random() * (b - a);
  let dpr = 1, w = 0, h = 0, strokes = [], nextSpawn = 600, prev = performance.now();
  function fit() { dpr = Math.min(devicePixelRatio || 1, 1.5); w = innerWidth; h = innerHeight; cv.width = w * dpr; cv.height = h * dpr; }
  fit(); addEventListener("resize", fit);
  function spawn(now) {
    const horiz = Math.random() < 0.8, dir = Math.random() < 0.5 ? 1 : -1, dur = R(4200, 5800), L = (horiz ? w : h) * R(1.05, 1.3);
    const x = horiz ? (dir > 0 ? -0.06 * w : 1.06 * w) : w * R(0.15, 0.85), y = horiz ? h * R(0.15, 0.85) : (dir > 0 ? -0.06 * h : 1.06 * h);
    const a = (horiz ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2)) + R(-0.3, 0.3);
    strokes.push({ x, y, a, ph: R(0, 6.28), sp: L / ((dur / 1000) * 0.72), born: now, dur, W: R(55, 90), hue: HUES[(Math.random() * HUES.length) | 0], shift: R(-18, 18), pts: [],
      br: Array.from({ length: N }, (_, j) => ({ o: (j / (N - 1)) * 2 - 1 + R(-0.05, 0.05), lw: R(2, 5.5), al: R(0.45, 1), dl: R(-7, 7), dry: R(0.5, 0.95) })) });
  }
  function frame(now) {
    const dt = Math.min(now - prev, 50) / 1000; prev = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (now > nextSpawn && strokes.length < 2) { spawn(now); nextSpawn = now + R(1500, 4500); }
    const dim = document.body.classList.contains("in-app") || scrollY > h * 0.4 ? 0.5 : 1;
    ctx.lineCap = ctx.lineJoin = "round";
    strokes = strokes.filter((s) => { s.pts = s.pts.filter((p) => now - p.t < LIFE); return s.pts.length > 0 || now - s.born < s.dur; });
    for (const s of strokes) {
      if (now - s.born < s.dur) {   // the brush is moving: long S-curve, pressure builds then lifts
        const k = (now - s.born) / s.dur, env = Math.pow(Math.sin(Math.PI * k), 0.7), v = s.sp * (0.35 + 0.65 * env) * dt;
        s.a += Math.sin((now / 1000) * 0.9 + s.ph) * 0.8 * dt; s.x += Math.cos(s.a) * v; s.y += Math.sin(s.a) * v;
        s.pts.push({ x: s.x, y: s.y, t: now, k, nx: -Math.sin(s.a), ny: Math.cos(s.a), w: s.W * Math.max(0.15, env),
          b: s.br.map((r) => r.al * (k > r.dry ? (Math.random() < 0.5 ? 0.1 : 0.85) : 1)) });   // bristles run dry near the end
      }
      const pts = s.pts;
      for (let i = 0; i + 1 < pts.length; i += CHUNK) {
        const e = Math.min(i + CHUNK, pts.length - 1), m = pts[Math.min(i + 3, pts.length - 1)], f = Math.pow(Math.max(0, 1 - (now - m.t) / LIFE), 1.3);
        if (f <= 0.01) continue;
        const hue = s.hue + s.shift * m.k;
        s.br.forEach((r, j) => {
          const al = m.b[j] * f * 0.5 * dim; if (al < 0.02) return;
          ctx.globalAlpha = al; ctx.lineWidth = r.lw; ctx.strokeStyle = `hsl(${hue}, 52%, ${79 + r.dl}%)`;
          ctx.beginPath();
          for (let q = i; q <= e; q++) { const p = pts[q], X = p.x + p.nx * r.o * p.w, Y = p.y + p.ny * r.o * p.w; q === i ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
          ctx.stroke();
        });
      }
    }
    ctx.globalAlpha = 1; requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

$("startBtn").onclick = () => {
  $("landing").hidden = true;
  $("site").hidden = true;
  $("app").hidden = false;
  document.body.classList.add("in-app");   // a little more shading behind the interface for readability
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
  $("tutorialView").hidden = name !== "tutorial";
  $("tabTutorial").classList.toggle("active", name === "tutorial");
  $("tabDraw").classList.toggle("active", name === "draw");
  $("tabAlbum").classList.toggle("active", name === "album");
  if (name === "album") {
    setDrawing(false);
    renderGallery();
  } else if (name === "tutorial") {
    setDrawing(false);
  } else {
    setDrawing($("finish").hidden);   // stay paused while the preview is open
  }
  window.scrollTo({ top: 0 });
}
$("tabDraw").onclick = () => showView("draw");
$("tabAlbum").onclick = () => showView("album");
$("tabTutorial").onclick = () => showView("tutorial");
$("tutGo").onclick = () => showView("draw");

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

// ---------- measure the drawing itself, so the AI is told what was really drawn (not what is usual) ----------
// Works on the pixels of the canvas: which colours are where, how big, and whether a colour forms stacked
// sections of clearly different width (for example the tiers of a cake). Only confident findings are reported.
function analyzeStructure() {
  const gw = 160, gh = 120;
  const c = document.createElement("canvas"); c.width = gw; c.height = gh;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(paintCanvas, 0, 0, gw, gh);
  const d = x.getImageData(0, 0, gw, gh).data;
  const groups = {}, cache = {};
  let total = 0;
  for (let y = 0; y < gh; y++) {
    for (let xx = 0; xx < gw; xx++) {
      const i = (y * gw + xx) * 4;
      if (d[i + 3] < 110) continue;
      const hex = rgb2hex(d[i], d[i + 1], d[i + 2]);
      const name = cache[hex] || (cache[hex] = nearestColorName(hex));
      const g = groups[name] || (groups[name] = { name, n: 0, x0: gw, x1: -1, y0: gh, y1: -1, rows: {} });
      g.n++; total++;
      g.x0 = Math.min(g.x0, xx); g.x1 = Math.max(g.x1, xx); g.y0 = Math.min(g.y0, y); g.y1 = Math.max(g.y1, y);
      const r = g.rows[y] || (g.rows[y] = [xx, xx]);
      r[0] = Math.min(r[0], xx); r[1] = Math.max(r[1], xx);
    }
  }
  if (!total) return { text: "", parts: [] };
  const parts = Object.values(groups).filter((g) => g.n >= Math.max(10, total * 0.02));
  const pct = (v, m) => Math.round((v / m) * 100);
  const out = parts.map((g) => {
    // row-by-row width; a sudden jump in width between neighbouring rows marks a new stacked section
    const ext = [];
    for (let y = g.y0; y <= g.y1; y++) if (g.rows[y]) ext.push(g.rows[y][1] - g.rows[y][0] + 1);
    const segs = []; let cur = [ext[0]];
    for (let i = 1; i < ext.length; i++) {
      const jump = Math.abs(ext[i] - ext[i - 1]) >= Math.max(10, 0.25 * Math.max(ext[i], ext[i - 1]));
      if (jump && cur.length >= 5) { segs.push(cur); cur = [ext[i]]; } else cur.push(ext[i]);
    }
    segs.push(cur);
    const real = segs.filter((q) => q.length >= 5);
    const widths = real.map((q) => pct(q.slice().sort((a, b) => a - b)[Math.floor(q.length / 2)], gw));
    return { name: g.name, cx: (g.x0 + g.x1) / 2, cy: (g.y0 + g.y1) / 2, x0: pct(g.x0, gw), x1: pct(g.x1 + 1, gw), y0: pct(g.y0, gh), y1: pct(g.y1 + 1, gh), sections: real.length >= 2 ? real.length : 0, widths };
  }).sort((a, b) => a.cy - b.cy);
  const lines = out.map((p) =>
    `the ${p.name} part spans ${p.x0}% to ${p.x1}% across and ${p.y0}% to ${p.y1}% down the picture` +
    (p.sections ? `, and it is made of exactly ${p.sections} stacked sections (top to bottom their widths are about ${p.widths.join("%, ")}% of the picture width): keep exactly ${p.sections} stacked sections, no more and no fewer` : ""));
  const text = out.length ? "Measured layout of the sketch, from top to bottom: " + lines.join("; ") + ". " : "";
  return { text, parts: out };
}

// ================= Done drawing / Resume drawing =================
$("doneBtn").onclick = async () => {
  if (strokes.length === 0) { sideSay("Draw something first, then click Done drawing."); return; }
  const img = snapshot();
  setDrawing(false);   // from here on, hand gestures cannot create strokes
  $("doneImg").src = img;
  $("resultImg").hidden = true;
  $("addGalleryBtn").hidden = true;
  lastResult = null;
  $("genStatus").textContent = "";
  $("finish").hidden = false;
  let structure = { text: "", parts: [] };
  try { structure = analyzeStructure(); } catch (err) { console.warn("structure analysis skipped", err); }
  // the original drawing is stored here and never modified: every generation reads it, none writes to it
  currentFolder = Object.freeze({ drawing: img, colors: usedColorNames(), structure: structure.text });
  try { await $("doneImg").decode(); } catch (e) { /* scroll anyway */ }
  requestAnimationFrame(() => $("finish").scrollIntoView({ behavior: "smooth", block: "start" }));
};

$("resumeBtn").onclick = () => {
  if (drawEnabled) return;
  $("finish").hidden = true;
  setDrawing(true);   // same canvas, tool, color and size as before
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ================= Voice input (browser speech recognition: Chrome, Edge, Safari) =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MIC_ERRORS = {
  "not-allowed": "Microphone access is blocked. Allow it in the browser's address bar, then try again.",
  "service-not-allowed": "Microphone access is blocked. Allow it in the browser's address bar, then try again.",
  "audio-capture": "No microphone was found. Connect one and try again.",
  "no-speech": "No speech was heard. Click the microphone and try again.",
  "network": "Voice input needs an internet connection.",
  "language-not-supported": "This language isn't supported for voice input.",
};
let activeMic = null;   // only one microphone listens at a time
function setupMic(btnId, boxId, msgId) {
  const btn = $(btnId), box = $(boxId), say = (t) => ($(msgId).textContent = t);
  btn.setAttribute("aria-pressed", "false");
  btn.onclick = () => {
    if (activeMic && activeMic.btn === btn) { activeMic.rec.stop(); return; }   // click again = stop
    if (!SR) { say("Voice input isn't supported in this browser. Use Chrome or Edge, or type instead."); return; }
    if (activeMic) activeMic.rec.abort();                                        // the other field's mic stops first
    const rec = new SR(), me = { btn, rec };
    rec.lang = navigator.language || "en-US";
    rec.continuous = true; rec.interimResults = true;
    const base = box.value;          // what was already typed stays; speech is added after it
    let spoken = "", failed = false;
    const show = (interim) => {
      const text = (spoken + " " + interim).trim();
      box.value = base && text ? base + (/\s$/.test(base) ? "" : " ") + text : base + text;
    };
    rec.onstart = () => { activeMic = me; btn.classList.add("active"); btn.setAttribute("aria-pressed", "true"); box.readOnly = true; say("Listening… speak now, click the microphone again to stop."); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) spoken = (spoken + " " + t).trim(); else interim += " " + t;
      }
      show(interim.trim());
    };
    rec.onerror = (e) => { failed = true; say(MIC_ERRORS[e.error] || "Voice input stopped (" + e.error + ").");  };
    rec.onend = () => {
      btn.classList.remove("active"); btn.setAttribute("aria-pressed", "false"); box.readOnly = false;
      if (activeMic === me) activeMic = null;
      show("");
      if (!failed) say(spoken ? "Added. You can edit the text." : "No speech was heard. Click the microphone and try again.");
    };
    try { rec.start(); } catch (err) { say("Couldn't start voice input. Please try again."); }
  };
}
setupMic("micBtn2", "subject", "subjectMsg");
setupMic("micBtn", "desc", "descMsg");

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

async function generateWithHorde(sketchDataUrl, prompt, negative, styleId, onStatus) {
  const source = await sketchToBase64(sketchDataUrl);
  const model = await pickModel();

  // Structure control: the sketch is also given to a ControlNet ("scribble") so the lines of the drawing guide the geometry.
  // A lower denoising value keeps the result closer to the drawing; the lines carry the shape, the prompt carries the rendering.
  const body = {
    prompt: prompt + " ### " + negative,
    params: {
      sampler_name: "k_euler_a",
      cfg_scale: 7.5,
      denoising_strength: styleId === "realistic" || styleId === "bw" ? 0.6 : 0.5,
      control_type: "scribble",
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

  const post = () => fetch(`${HORDE}/generate/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: HORDE_KEY },
    body: JSON.stringify(body),
  });
  let start = await post();
  if (!start.ok) { delete body.params.control_type; start = await post(); }   // structure control unavailable: still use img2img
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
  const subject = $("subject").value.trim();   // what the drawing IS (e.g. "cake")
  const desc = $("desc").value.trim();          // optional extras for the scene (e.g. "add balloons")
  const colors = (currentFolder.colors || []).join(", ");
  const structure = currentFolder.structure || "";
  const photo = style.id === "realistic";

  // Priority order: 1 the drawing, 2 the description, 3 the style, 4 additional instructions, 5 creative detail.
  const drawingRules =
    "Image 0 is a hand-drawn sketch and it is the single source of truth for the design of the main subject. " +
    (subject ? `The description "${subject}" only tells you what the drawing represents; it is NOT permission to redesign it or to draw a typical ${subject} from scratch. ` : "") +
    structure +
    (colors ? `The sketch uses these colours: ${colors}. Keep these colours on the matching parts. ` : "Keep the colours of the sketch. ") +
    "Keep EXACTLY the same silhouette, proportions, height and width, number of objects, number of parts (tiers, layers, limbs, wheels, petals, windows and similar), decorations, positions and arrangement as drawn. " +
    "Never add a part, never remove a part, and never swap the drawing for the usual version of that object: if the drawing is unusual or imperfect, keep it that way. " +
    "Only the rendering may change (materials, lighting, shadows, texture, depth), never the geometry. ";

  const styleLine = `Render the drawn subject as ${style.prompt}. `;
  const sceneLine = photo
    ? "Place it in a tasteful, fitting real-world setting that suits what it is" + (subject ? ` (${subject})` : "") + ", with a realistic background and gentle depth of field. The drawn subject stays the clear main subject, in the same position and relative size. "
    : (style.id === "bw"
        ? "Use a simple neutral background so the subject stays the clear main subject. "
        : "Keep the background simple and plain, as in the sketch, so the subject stays the clear main subject. ");
  const addLine = desc
    ? `Additional instructions for the surrounding scene only: ${desc}. Add these around or next to the drawn subject without changing the subject itself. ` +
      "If an instruction would change a defining feature of the drawing (its shape, size or number of parts), ignore that part and apply it in a way that keeps the drawing unchanged. " +
      "If a colour is stated for an added item, use exactly that colour; otherwise use the item's natural colour. Match lighting, scale and shadows. "
    : "";

  const aiPrompt = "Edit image 0. " + drawingRules + styleLine + sceneLine + addLine +
    "Never create a new picture from the text alone: the main subject must clearly be the exact design drawn in image 0. Do not add any text or watermark.";

  const hordePrompt = `${style.prompt}, ${subject ? subject + ", " : ""}exactly the same drawn subject as the sketch, same silhouette, same number of parts, same proportions, same position, same colours${colors ? " (" + colors + ")" : ""}` +
    (photo ? ", fitting realistic environment" : ", plain simple background") + (desc ? `, scene extras: ${desc}` : "") + ", high quality";
  const hordeNegative = "extra tiers, extra parts, missing parts, different design, redesigned subject, changed proportions, text, watermark, blurry, deformed, low quality";

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
      image = await generateWithHorde(currentFolder.drawing, hordePrompt, hordeNegative, style.id, (c) => {
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


// ---------- front page: nav appears after the hero, buttons open the app ----------
(function () {
  const nav = $("sitenav");
  const upd = () => nav.classList.toggle("show", scrollY > innerHeight * 0.6);
  addEventListener("scroll", upd, { passive: true }); upd();
  document.querySelectorAll("[data-start]").forEach((b) => (b.onclick = () => $("startBtn").click()));
})();

// ---------- feedback form ----------
// To receive feedback: make a free form at formspree.io and paste its address below (https://formspree.io/f/xxxxxxx),
// or put your email in FEEDBACK_EMAIL to open the visitor's email app instead.
const FEEDBACK_ENDPOINT = "", FEEDBACK_EMAIL = "buildsbyvb@gmail.com";
(function () {
  const f = $("fbForm"), msg = $("fbMsg"), btn = $("fbBtn");
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.company.value) return;   // hidden field: only bots fill it
    const message = f.fbText.value.trim();
    if (!message) { msg.textContent = "Please write your feedback first."; return; }
    const data = { name: f.fbName.value.trim(), email: f.fbEmail.value.trim(), message };
    if (FEEDBACK_ENDPOINT) {
      btn.disabled = true; msg.textContent = "Sending…";
      try {
        const r = await fetch(FEEDBACK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) });
        if (!r.ok) throw new Error("send failed");
        f.reset(); msg.textContent = "Thank you. Your feedback has been sent.";
      } catch (err) { msg.textContent = "Sorry, your feedback could not be sent. Please try again."; }
      btn.disabled = false; return;
    }
    if (FEEDBACK_EMAIL) {
      location.href = "mailto:" + FEEDBACK_EMAIL + "?subject=" + encodeURIComponent("AirBrush feedback") + "&body=" + encodeURIComponent((data.name ? "Name: " + data.name + "\n" : "") + (data.email ? "Email: " + data.email + "\n" : "") + "\n" + message);
      msg.textContent = "Your email app should open with the message ready to send."; return;
    }
    msg.textContent = "Feedback is not switched on yet. Please try again soon.";
  };
})();
