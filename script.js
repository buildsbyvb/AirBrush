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
const ROW1 = ["#000000", "#808080", "#800000", "#808000", "#008000", "#008080", "#000080", "#800080", "#808040", "#004040", "#0080ff", "#004080", "#8000ff", "#804000"];
const ROW2 = ["#ffffff", "#c0c0c0", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffff80", "#00ff80", "#80ffff", "#8080ff", "#ff0080", "#ff8040"];
const COLORS = ROW1.flatMap((c, i) => [c, ROW2[i]]);
const swatchBox = $("swatches");
COLORS.forEach((c) => {
  const d = document.createElement("div");
  d.className = "swatch" + (c === color ? " active" : "");
  d.style.background = c;
  d.dataset.color = c;
  d.onclick = () => setColor(c);
  swatchBox.appendChild(d);
});
function setColor(c) {
  color = c;
  $("colorPicker").value = c;
  $("curColor").style.background = c;
  document.querySelectorAll(".swatch").forEach((s) =>
    s.classList.toggle("active", s.dataset.color === c.toLowerCase())
  );
  setTool("pen");
}
$("colorPicker").oninput = (e) => setColor(e.target.value);

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

function onResults(results) {
  const hands = results.multiHandLandmarks;
  if (!hands || hands.length === 0) {
    current = null; lastPoint = null; showCursor(null); hidePointer();
    if (drawEnabled) statusEl.textContent = "Show your hand to the camera";
    return;
  }
  const lm = hands[0];
  const ratio = pinchRatio(lm);
  updatePinch(ratio, lm);
  const raw = pinching ? "pinch" : getGesture(lm);

  if (raw === stableGesture) { gestureCount = 0; }
  else if (++gestureCount >= 3) { stableGesture = raw; gestureCount = 0; current = null; }
  const g = stableGesture;

  // Open palm (or any hand while not drawing) = pointer mode: control the whole page with your fingertip
  const now = performance.now();
  if (!drawEnabled || g === "palm" || (g === "pinch" && now - lastPointerTime < 2000)) {
    lastPointerTime = now;
    current = null; lastPoint = null; showCursor(null);
    updatePointer(lm, ratio);
    return;
  }
  hidePointer();
  if (g === "draw" || g === "erase") lastPointerTime = 0;

  let fx = lm[8].x, fy = lm[8].y;
  if (g === "erase") { fx = (lm[8].x + lm[12].x) / 2; fy = (lm[8].y + lm[12].y) / 2; }
  const target = { x: (1 - fx) * W, y: fy * H };
  lastPoint = lastPoint
    ? { x: lastPoint.x + (target.x - lastPoint.x) * 0.5, y: lastPoint.y + (target.y - lastPoint.y) * 0.5 }
    : target;

  showCursor(lastPoint, g);

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
    statusEl.textContent = g === "palm" ? "Stopped (palm)" : "Waiting… raise 1 finger to draw";
  }
}

// ================= Hand pointer: control the whole page with your fingertip =================
// Open palm = pointer. Move your hand and items highlight. Pinch thumb + index = select.
// If pinching feels too sensitive or too hard, tune these numbers.
const PINCH_ON = 0.30, PINCH_OFF = 0.45, PINCH_FREEZE = 0.55, PINCH_REACH = 1.0;
const TARGETS = "button, .swatch, .chip, .card:not(.nohover), input[type=range], [data-gesture]";
const pointerEl = $("handPointer");
let pinchFrames = 0, hoverSince = 0, pointerPos = null, pinching = false, wasPinching = false, lastPointerTime = 0, hoverEl = null, sliderDrag = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hdist = (a, b) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
const palmSize = (lm) => hdist(lm[0], lm[9]) || 1;
const pinchRatio = (lm) => hdist(lm[4], lm[8]) / palmSize(lm);

function updatePinch(ratio, lm) {
  const reach = hdist(lm[8], lm[0]) / palmSize(lm);   // stops a closed fist counting as a pinch
  if (!pinching) {
    pinchFrames = (ratio < PINCH_ON && reach > PINCH_REACH) ? pinchFrames + 1 : 0;
    if (pinchFrames >= 2) pinching = true;
  } else if (ratio > PINCH_OFF) { pinching = false; pinchFrames = 0; }
}
function setHover(t) {
  if (t === hoverEl) return;
  if (hoverEl) hoverEl.classList.remove("hot", "pressed");
  hoverEl = t;
  hoverSince = performance.now();
  if (hoverEl) hoverEl.classList.add("hot");
}
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const t = el && el.closest(TARGETS);
  return t && !t.disabled ? t : null;
}
function setSlider(el, x) {
  const r = el.getBoundingClientRect();
  const f = clamp((x - r.left) / r.width, 0, 1);
  el.value = Math.round(+el.min + f * (+el.max - +el.min));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function activate(el) {
  if (el.matches("input[type=range]")) { sliderDrag = el; setSlider(el, pointerPos.x); return; }
  el.click();
}
function labelOf(el) {
  return el.getAttribute("aria-label") || el.title || el.textContent.trim().slice(0, 30) ||
    (el.dataset.color ? "colour " + el.dataset.color : "item");
}
function updatePointer(lm, ratio) {
  // the middle of thumb + index stays put while you pinch, so the click lands where you aimed
  const mx = 1 - (lm[4].x + lm[8].x) / 2, my = (lm[4].y + lm[8].y) / 2;
  const t = { x: clamp((mx - 0.12) / 0.76, 0, 1) * (innerWidth - 1), y: clamp((my - 0.1) / 0.75, 0, 1) * (innerHeight - 1) };
  if (!pointerPos) pointerPos = t;
  else if (sliderDrag || ratio > PINCH_FREEZE) {      // freeze while closing the pinch (unless dragging the slider)
    pointerPos = { x: pointerPos.x + (t.x - pointerPos.x) * 0.4, y: pointerPos.y + (t.y - pointerPos.y) * 0.4 };
  }
  pointerEl.hidden = false;
  pointerEl.style.transform = `translate(${pointerPos.x}px, ${pointerPos.y}px)`;
  pointerEl.classList.toggle("pinched", pinching);

  if (sliderDrag && !pinching) sliderDrag = null;
  if (sliderDrag) setSlider(sliderDrag, pointerPos.x);
  else if (!pinching) setHover(targetAt(pointerPos.x, pointerPos.y));
  if (hoverEl) hoverEl.classList.toggle("pressed", pinching);

  if (pinching && !wasPinching && hoverEl && performance.now() - hoverSince > 150) activate(hoverEl);                                   // select
  if (pinching && hoverEl && hoverEl.dataset.scroll) window.scrollBy(0, +hoverEl.dataset.scroll * 22); // hold to scroll
  wasPinching = pinching;
  setMode("Pointer");
  statusEl.textContent = hoverEl ? "Pinch to select: " + labelOf(hoverEl) : "Pointer mode: hover over an item, then pinch to select";
}
function setMode(m) { const el = $("modeLabel"); if (el.textContent !== m) el.textContent = m; }
function hidePointer() {
  pointerEl.hidden = true;
  setHover(null);
  sliderDrag = null;
  wasPinching = pinching;
  setMode("Draw");
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

// scroll buttons (hold with the mouse, or hold a pinch)
document.querySelectorAll("[data-scroll]").forEach((b) => {
  let timer;
  const dir = +b.dataset.scroll, stop = () => clearInterval(timer);
  b.onmousedown = () => { window.scrollBy(0, dir * 40); timer = setInterval(() => window.scrollBy(0, dir * 22), 30); };
  b.onmouseup = stop; b.onmouseleave = stop;
});
setInterval(() => { $("scrollpad").hidden = document.documentElement.scrollHeight <= innerHeight + 4; }, 500);

// front-page colour strip + current colour box
COLORS.forEach((c) => { const i = document.createElement("i"); i.style.background = c; $("ornament").appendChild(i); });
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

  currentFolder = { id: Date.now(), created: Date.now(), drawing: img, results: [] };
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
$("micBtn").onclick = () => {
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
    $("desc").value = ($("desc").value ? $("desc").value + " " : "") + text;
  };
  recognition.onerror = () => { $("genStatus").textContent = "Couldn't hear you. Check the microphone permission."; };
  recognition.onend = () => { recognition = null; $("micBtn").classList.remove("active"); };
  recognition.start();
  $("micBtn").classList.add("active");
};

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
      denoising_strength: 0.72,   // lower = stays closer to your drawing, higher = more AI freedom
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
  const desc = $("desc").value.trim();
  // When there is no description, avoid style words that make the AI invent a scene (like "photo").
  const NO_SCENE_STYLE = {
    realistic: "photorealistic rendering of the drawn object only, soft even studio lighting, sharp focus, highly detailed",
    bw: "black and white, monochrome, high contrast, dramatic shading",
  };
  const stylePrompt = desc ? style.prompt : (NO_SCENE_STYLE[style.id] || style.prompt);

  const keepDrawing =
    "Image 0 is a hand-drawn sketch and it is the main subject. " +
    "The drawn subject must stay EXACTLY as the person drew it: the same shapes, proportions, position, size and colours. " +
    "Do not redesign, replace, move, add to or remove parts of the drawn subject. ";

  const aiPrompt = desc
    ? "Edit image 0. " + keepDrawing +
      `Render the drawn subject in this style: ${stylePrompt}. ` +
      `Then add the following into the same picture, around and together with the drawn subject, without changing the subject itself: ${desc}. ` +
      "Blend the added parts naturally with matching lighting, shadows, scale and perspective, all in the same style. " +
      "Never create a new picture from the description alone: the drawn subject must clearly be the one from image 0. " +
      "Do not add any text or watermark."
    : "Edit image 0. " + keepDrawing +
      `Only change how the drawn subject is rendered, in this style: ${stylePrompt}. ` +
      "IMPORTANT: keep the background of image 0 exactly as it is: a pure, plain, empty white background filling the whole picture, like a blank white painting canvas. " +
      "There must be NO scenery, NO beach, NO sky, NO room, NO table or surface, NO hands, NO people, NO other objects and NO background details of any kind. " +
      "Only the drawn subject, alone, on plain white. " +
      "Do not add any text or watermark.";

  const hordePrompt = desc
    ? `${stylePrompt}, the same drawn subject as in the sketch, same shapes and position, with ${desc}, high quality`
    : `${stylePrompt}, the same drawn subject as in the sketch, same shapes and position, isolated on a plain pure white background, nothing else, high quality`;

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

    currentFolder.results.push({ style: style.label, prompt: desc, image });
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
