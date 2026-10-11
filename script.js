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
let color = "#ff3b30";
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
  { id: "realistic",  label: "📷 Realistic image",   prompt: "realistic photo, ultra detailed, natural lighting, sharp focus" },
  { id: "bw",         label: "⚫ Black & white",      prompt: "black and white photograph, monochrome, high contrast, dramatic shading" },
  { id: "watercolor", label: "💧 Watercolour",        prompt: "watercolor painting, soft washes of colour, paper texture, delicate brushwork" },
  { id: "oil",        label: "🎨 Oil painting",       prompt: "oil painting, thick brush strokes, rich colours, canvas texture, masterpiece" },
  { id: "pencil",     label: "✏️ Pencil sketch",      prompt: "detailed pencil sketch, graphite shading, hand drawn on paper" },
  { id: "cartoon",    label: "🧸 Cartoon",            prompt: "cartoon illustration, bold outlines, bright flat colours, cute" },
  { id: "anime",      label: "🌸 Anime",              prompt: "anime style illustration, vibrant colours, clean lines, studio quality" },
  { id: "pixel",      label: "👾 Pixel art",          prompt: "pixel art, 16-bit retro game style, limited colour palette" },
  { id: "3d",         label: "🧊 3D render",          prompt: "3D render, soft studio lighting, smooth materials, octane render" },
  { id: "comic",      label: "💥 Comic book",         prompt: "comic book art, ink outlines, halftone dots, dynamic colours" },
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
const COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759",
                "#00c7be", "#007aff", "#af52de", "#ff2d92",
                "#000000", "#8e8e93", "#ffffff", "#8b5a2b"];
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
  if (!drawEnabled) { current = null; lastPoint = null; showCursor(null); return; }

  const hands = results.multiHandLandmarks;
  if (!hands || hands.length === 0) {
    current = null; lastPoint = null; showCursor(null);
    statusEl.textContent = "👋 Show your hand to the camera";
    return;
  }
  const lm = hands[0];
  const raw = getGesture(lm);

  if (raw === stableGesture) { gestureCount = 0; }
  else if (++gestureCount >= 3) { stableGesture = raw; gestureCount = 0; current = null; }
  const g = stableGesture;

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
    statusEl.textContent = erase ? "🧽 Erasing" : "✏️ Drawing";
  } else {
    current = null;
    statusEl.textContent = g === "palm" ? "✋ Stopped (palm)" : "✊ Waiting… raise 1 finger to draw";
  }
}

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
    statusEl.textContent = "❌ Camera blocked. Click the camera icon in the address bar and allow it, then reload.";
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
    statusEl.textContent = "🖊️ Draw something first, then click Done drawing.";
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
    $("genStatus").textContent = "🎤 Voice input works in Chrome or Edge. Please type instead.";
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
  recognition.onerror = () => { $("genStatus").textContent = "🎤 Couldn't hear you. Check the microphone permission."; };
  recognition.onend = () => { recognition = null; $("micBtn").classList.remove("active"); };
  recognition.start();
  $("micBtn").classList.add("active");
};

// ================= Generate image (free AI through Puter.js, no server needed) =================
async function toDataUrl(src) {
  if (src.startsWith("data:")) return src;
  const blob = await (await fetch(src)).blob();
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

async function generateWithPuter(sketchDataUrl, prompt) {
  if (!window.puter) throw new Error("The AI service did not load. Check your internet and reload the page.");
  const base64 = sketchDataUrl.split(",")[1];
  const img = await puter.ai.txt2img(prompt, {
    provider: "gemini",
    model: "gemini-2.5-flash-image-preview",
    input_image: base64,
    input_image_mime_type: "image/png",
  });
  return await toDataUrl(img.src);
}

$("genBtn").onclick = async () => {
  if (!currentFolder) return;
  const style = STYLES.find((s) => s.id === selectedStyle);
  const desc = $("desc").value.trim();
  const prompt =
    "This is a simple hand-drawn sketch. Turn it into a finished, high quality image. " +
    "Keep the exact shapes, positions and layout of the sketch, and keep its colours where they make sense. " +
    `Style: ${style.prompt}. ` +
    (desc ? `Also include this (even if it is not in the sketch): ${desc}. ` : "") +
    "Do not add any text or watermark.";

  const btn = $("genBtn");
  btn.disabled = true;
  const t0 = Date.now();
  const timer = setInterval(() => {
    $("genStatus").textContent =
      `⏳ Generating… ${Math.round((Date.now() - t0) / 1000)}s (usually 10–60 seconds, keep this tab open)`;
  }, 1000);

  try {
    const image = await generateWithPuter(currentFolder.drawing, prompt);
    clearInterval(timer);
    $("resultImg").src = image;
    $("resultImg").hidden = false;
    $("genStatus").textContent = "✅ Done! Downloaded and saved to your Album.";

    currentFolder.results.push({ style: style.label, prompt: desc, image });
    try { await dbPut(currentFolder); } catch (e) { console.error("Album save failed", e); }
    download(image, `airbrush-${style.id}.png`);
  } catch (e) {
    clearInterval(timer);
    $("genStatus").textContent =
      "❌ " + (e && e.message ? e.message : "Could not make the image") + " — if a Puter sign-in window appeared, sign in (it is free) and click Generate again.";
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
    card.innerHTML = `<img alt="Folder cover" /><div class="label">📁 ${fmt(f.created)}<br>${f.results.length} generated image${f.results.length === 1 ? "" : "s"}</div>`;
    card.querySelector("img").src = f.drawing;
    card.onclick = () => openFolder(f);
    grid.appendChild(card);
  }
}

function openFolder(f) {
  openFolderId = f.id;
  $("albumList").hidden = true;
  $("folderView").hidden = false;
  $("folderTitle").textContent = "📁 " + fmt(f.created);

  const box = $("folderItems");
  box.innerHTML = "";
  const addItem = (src, label, fileName) => {
    const c = document.createElement("div");
    c.className = "card nohover";
    c.innerHTML = `<img alt="" /><div class="label"></div><button class="tool">⬇️ Download</button>`;
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
  if (!confirm("Delete this folder (drawing + generated images)?")) return;
  try { await dbDelete(openFolderId); } catch (e) { console.error(e); }
  showAlbumList();
};
