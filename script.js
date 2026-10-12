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
let color = "#ff0000";
let size = 8;
let tool = "pen";
let strokes = [];
let current = null;
let lastPoint = null;
let stableGesture = "none";
let gestureCount = 0;
let started = false;
let drawEnabled = true;       // false after "Done drawing" or inside Album
let currentView = "draw";
let currentFolder = null;     // album folder of the drawing being finished
let openFolderId = null;

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
const COLOR_GROUPS = [
  { name: "Neutral",   colors: ["#000000", "#555555", "#9a9a9a", "#ffffff"] },
  { name: "Primary",   colors: ["#ff0000", "#ffe600", "#0047ff"] },
  { name: "Secondary", colors: ["#ff8000", "#1faa3c", "#8a2be2"] },
  { name: "More",      colors: ["#ffb300", "#ff4500", "#9acd32", "#00a693", "#00d4ff", "#7ec8ff", "#001f7a", "#ff7eb6",
                               "#ff00ff", "#c3a6ff", "#98f5c3", "#ffcba4", "#d4a017", "#7b4a1e", "#800000", "#808000"] },
];
const COLORS = COLOR_GROUPS.flatMap((g) => g.colors);
const swatchBox = $("swatches");
COLOR_GROUPS.forEach((g) => {
  const grp = document.createElement("div");
  grp.className = "sw-group";
  grp.innerHTML = `<div class="sw-name">${g.name}</div><div class="sw-row"></div>`;
  g.colors.forEach((c) => {
    const d = document.createElement("div");
    d.className = "swatch" + (c === color ? " active" : "");
    d.style.background = c;
    d.dataset.color = c;
    d.title = c;
    d.onclick = () => setColor(c);
    grp.querySelector(".sw-row").appendChild(d);
  });
  swatchBox.appendChild(grp);
});
function setColor(c, fromWheel) {
  color = c.toLowerCase();
  $("curColor").style.background = color;
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
  ctx.lineWidth = s.erase ? s.size * 2.5 : s.size;
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

// ---------- hand skeleton overlay: neon "AI scan" of the hand, dots and lines only ----------
const handCanvas = $("handCanvas"), handCtx = handCanvas.getContext("2d");
const FINGERS = [
  { ids: [1, 2, 3, 4],     c: "#ff5fd2" },   // thumb
  { ids: [5, 6, 7, 8],     c: "#22e1ff" },   // index
  { ids: [9, 10, 11, 12],  c: "#7c8cff" },   // middle
  { ids: [13, 14, 15, 16], c: "#b57bff" },   // ring
  { ids: [17, 18, 19, 20], c: "#ff8ac9" },   // pinky
];
const JOINT_COLOR = Array(21).fill("#ffffff");
FINGERS.forEach((f) => f.ids.forEach((i) => (JOINT_COLOR[i] = f.c)));
const PALM_RING = [0, 1, 5, 9, 13, 17];
const PALM_WEB = [[0, 5], [0, 9], [0, 13], [5, 13], [9, 17], [1, 5]];
const TIPS = [4, 8, 12, 16, 20];
const trails = TIPS.map(() => []);
const MODE_TEXT = { draw: "Drawing", erase: "Erasing", palm: "Paused", none: "Ready" };

function clearHand() { handCtx.clearRect(0, 0, W, H); trails.forEach((t) => (t.length = 0)); }

// Turn a hand point (0..1 of the camera picture) into canvas pixels, exactly where it appears on the
// webcam box. The video is mirrored and cropped to fill the box, so we must undo the same crop here.
function toCanvas(p) {
  const vw = video.videoWidth || W, vh = video.videoHeight || H;
  const sc = Math.max(W / vw, H / vh);
  const x = p.x * vw * sc + (W - vw * sc) / 2;
  const y = p.y * vh * sc + (H - vh * sc) / 2;
  return { x: W - x, y };
}

function drawHand(lm, g) {
  const c = handCtx, now = performance.now();
  c.clearRect(0, 0, W, H);
  const P = lm.map(toCanvas);   // same mirror and crop as the video
  c.save();
  c.lineCap = "round"; c.lineJoin = "round";

  // 1. translucent palm surface + faint web lines
  c.beginPath();
  PALM_RING.forEach((i, k) => (k ? c.lineTo(P[i].x, P[i].y) : c.moveTo(P[i].x, P[i].y)));
  c.closePath();
  c.fillStyle = "rgba(139, 92, 246, 0.16)"; c.fill();
  c.strokeStyle = "rgba(200, 190, 255, 0.45)"; c.lineWidth = 1.2; c.stroke();
  c.beginPath();
  PALM_WEB.forEach(([a, b]) => { c.moveTo(P[a].x, P[a].y); c.lineTo(P[b].x, P[b].y); });
  c.strokeStyle = "rgba(200, 190, 255, 0.22)"; c.lineWidth = 1; c.stroke();

  // 2. comet trails behind each fingertip
  TIPS.forEach((tip, k) => {
    const tr = trails[k];
    tr.push({ x: P[tip].x, y: P[tip].y });
    if (tr.length > 10) tr.shift();
    const col = JOINT_COLOR[tip];
    for (let i = 1; i < tr.length; i++) {
      const f = i / tr.length;
      c.globalAlpha = f * 0.6; c.strokeStyle = col; c.lineWidth = 1 + f * 5;
      c.beginPath(); c.moveTo(tr[i - 1].x, tr[i - 1].y); c.lineTo(tr[i].x, tr[i].y); c.stroke();
    }
  });
  c.globalAlpha = 1;

  // 3. glowing finger bones, then a bright white core line on top
  FINGERS.forEach((f) => {
    c.beginPath();
    c.moveTo(P[f.ids[0]].x, P[f.ids[0]].y);
    f.ids.forEach((i) => c.lineTo(P[i].x, P[i].y));
    c.shadowColor = f.c; c.shadowBlur = 18; c.strokeStyle = f.c; c.lineWidth = 5; c.stroke();
    c.shadowBlur = 0; c.strokeStyle = "rgba(255, 255, 255, 0.9)"; c.lineWidth = 1.6; c.stroke();
  });

  // 4. joint dots: soft halo + white core + coloured ring
  P.forEach((p, i) => {
    const tip = TIPS.includes(i), col = JOINT_COLOR[i];
    c.beginPath(); c.arc(p.x, p.y, tip ? 12 : 8.5, 0, Math.PI * 2);
    c.fillStyle = col; c.globalAlpha = 0.22; c.fill(); c.globalAlpha = 1;
    c.beginPath(); c.arc(p.x, p.y, tip ? 5.5 : 3.8, 0, Math.PI * 2);
    c.shadowColor = col; c.shadowBlur = 12;
    c.fillStyle = "#fff"; c.fill();
    c.shadowBlur = 0; c.lineWidth = 2; c.strokeStyle = col; c.stroke();
  });

  // 5. fingertips pulse like radar pings
  TIPS.forEach((tip, k) => {
    const r = 15 + 5 * Math.sin(now / 230 + k * 1.3);
    c.globalAlpha = 0.55; c.lineWidth = 1.5; c.strokeStyle = JOINT_COLOR[tip];
    c.beginPath(); c.arc(P[tip].x, P[tip].y, r, 0, Math.PI * 2); c.stroke();
  });
  c.globalAlpha = 1;

  // 6. spinning dashed ring on the point that is drawing or erasing
  if (g === "draw" || g === "erase") {
    const t = g === "erase" ? { x: (P[8].x + P[12].x) / 2, y: (P[8].y + P[12].y) / 2 } : P[8];
    c.setLineDash([4, 7]); c.lineDashOffset = -now / 35;
    c.lineWidth = 2; c.strokeStyle = g === "erase" ? "#ff5f7a" : "#ffffff";
    c.beginPath(); c.arc(t.x, t.y, 27, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
  }
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
  try { drawHand(lm, g); } catch (e) { console.error("skeleton error", e); }

  // drawing is paused while the "Done drawing" panel or the Album is open
  if (!drawEnabled) { current = null; lastPoint = null; showCursor(null); setMode("Idle"); return; }

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

// current colour box
$("curColor").style.background = color;

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

  console.log("AirBrush v5 loaded");
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

// ---------- front page: a spray of light that follows the pointer, like painting in the air ----------
(function () {
  const cv = $("fx"), ctx = cv.getContext("2d"), landing = $("landing");
  const HUES = [265, 300, 190, 330];
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let parts = [], dpr = 1, last = null;
  function fit() { dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
  fit(); addEventListener("resize", fit);
  function spray(x, y) {
    for (let i = 0; i < 5 && parts.length < 700; i++) {
      const a = Math.random() * 6.283, r = Math.random() * 16;
      parts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.7, vy: (Math.random() - 0.5) * 0.7 - 0.15,
                   life: 1, s: 2 + Math.random() * 8, hue: HUES[(Math.random() * HUES.length) | 0] });
    }
  }
  function brushTo(x, y) {
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y), n = Math.ceil(d / 10);
      for (let i = 1; i <= n; i++) spray(last.x + (x - last.x) * i / n, last.y + (y - last.y) * i / n);
    } else spray(x, y);
    last = { x, y };
  }
  landing.addEventListener("pointermove", (e) => brushTo(e.clientX, e.clientY));
  landing.addEventListener("pointerleave", () => (last = null));
  const t0 = performance.now(), SWEEP = 2400;
  function frame(now) {
    if (landing.hidden) return;
    if (!calm && now - t0 < SWEEP) {            // one opening stroke so the page paints itself on load
      const k = (now - t0) / SWEEP;
      brushTo(innerWidth * (0.08 + 0.84 * k), innerHeight * (0.52 + Math.sin(k * 7) * 0.13 - k * 0.04));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${p.life * 0.22})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.6 + p.life * 0.6), 0, 6.283); ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

$("startBtn").onclick = () => {
  $("landing").hidden = true;
  $("app").hidden = false;
  startApp();
};

// ================= Album storage (IndexedDB, free, in your browser) =================
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("airbrush-album", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("folders", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("folders", mode);
    const req = fn(t.objectStore("folders"));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const dbPut = (f) => dbRun("readwrite", (s) => s.put(f));
const dbAll = () => dbRun("readonly", (s) => s.getAll());
const dbDelete = (id) => dbRun("readwrite", (s) => s.delete(id));

// ================= Views (Draw / Album) =================
function showView(name) {
  currentView = name;
  $("drawView").hidden = name !== "draw";
  $("albumView").hidden = name !== "album";
  $("tabDraw").classList.toggle("active", name === "draw");
  $("tabAlbum").classList.toggle("active", name === "album");
  if (name === "album") {
    drawEnabled = false;
    showAlbumList();
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
  $("genStatus").textContent = "";
  $("finish").hidden = false;

  currentFolder = { id: Date.now(), created: Date.now(), drawing: img, results: [], colors: usedColorNames() };
  try { await dbPut(currentFolder); } catch (e) { console.error("Album save failed", e); }

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
    $("genStatus").textContent = "Done! Downloaded and saved to your Album.";

    currentFolder.results.push({ style: style.label, prompt: [subject, desc].filter(Boolean).join("; "), image });
    try { await dbPut(currentFolder); } catch (e) { console.error("Album save failed", e); }
    download(image, `airbrush-${style.id}.png`);
  } catch (e) {
    clearInterval(timer);
    $("genStatus").textContent =
      "Error: " + errText(e) + " — you can click Generate image again.";
  }
  btn.disabled = false;
};

// ================= Album screens =================
const fmt = (ms) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function showAlbumList() {
  openFolderId = null;
  $("folderView").hidden = true;
  $("albumList").hidden = false;
  let folders = [];
  try { folders = await dbAll(); } catch (e) { console.error(e); }
  folders.sort((a, b) => b.id - a.id);

  const grid = $("albumGrid");
  grid.innerHTML = "";
  $("albumEmpty").hidden = folders.length > 0;
  for (const f of folders) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<img alt="Folder cover" /><div class="label">${fmt(f.created)}<br>${f.results.length} generated image${f.results.length === 1 ? "" : "s"}</div>`;
    card.querySelector("img").src = f.drawing;
    card.onclick = () => openFolder(f);
    grid.appendChild(card);
  }
}

function openFolder(f) {
  openFolderId = f.id;
  $("albumList").hidden = true;
  $("folderView").hidden = false;
  $("folderTitle").textContent = "Folder: " + fmt(f.created);

  const box = $("folderItems");
  box.innerHTML = "";
  const addItem = (src, label, fileName) => {
    const c = document.createElement("div");
    c.className = "card nohover";
    c.innerHTML = `<img alt="" /><div class="label"></div><button class="tool">Download</button>`;
    c.querySelector("img").src = src;
    c.querySelector(".label").textContent = label;
    c.querySelector("button").onclick = () => download(src, fileName);
    box.appendChild(c);
  };
  addItem(f.drawing, "My drawing", "airbrush-drawing.png");
  f.results.forEach((r, i) =>
    addItem(r.image, `${r.style}${r.prompt ? " – " + r.prompt : ""}`, `airbrush-generated-${i + 1}.png`)
  );
}

$("folderBack").onclick = showAlbumList;
$("folderDelete").onclick = async () => {
  if (openFolderId === null) return;
  if (!(await askConfirm("Delete this folder (drawing + generated images)?"))) return;
  try { await dbDelete(openFolderId); } catch (e) { console.error(e); }
  showAlbumList();
};
