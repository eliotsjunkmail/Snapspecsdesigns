/** Snap Specs virtual try-on — front camera + face-locked glasses overlay. */

const VISION_ESM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm";
const VISION_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const SIZE_SCALE = { 47: 0.9, 52: 1 };
const SNAP_YELLOW = "#FFFC00";
const FINISHES = {
  black: {
    frame: "#111111",
    rim: "#1c1c1c",
    highlight: "rgba(255,255,255,0.22)",
    metal: "#2a2a2a",
    lens: "rgba(40, 70, 95, 0.28)",
    lensEdge: "rgba(180, 210, 230, 0.35)",
  },
  yellow: {
    frame: SNAP_YELLOW,
    rim: "#fff56a",
    highlight: "rgba(255,255,255,0.4)",
    metal: "#c4b400",
    lens: "rgba(18, 28, 38, 0.42)",
    lensEdge: "rgba(40, 40, 10, 0.35)",
  },
};

let root;
let consentEl;
let stageEl;
let shotEl;
let videoEl;
let canvasEl;
let hintEl;
let shotImg;
let faceLandmarker = null;
let faceLoadPromise = null;
let stream = null;
let rafId = 0;
let running = false;
let startingLive = false;
let lastVideoTs = -1;
let lastDetectAt = 0;
let smooth = null;
let lostAt = 0;
let sizeMm = 52;
let finish = "black";
let photoUrl = "";
let hasConsented = false;
let euro = {};
let lastFilterAt = 0;
let onOpenLens = null;

export function isTryOnOpen() {
  return Boolean(root && !root.hidden);
}

export function bindTryOn({ onOpen, onOpenLens: openLens } = {}) {
  root = document.getElementById("tryon-root");
  consentEl = document.getElementById("tryon-consent");
  stageEl = document.getElementById("tryon-stage");
  shotEl = document.getElementById("tryon-shot-modal");
  videoEl = document.getElementById("tryon-cam");
  canvasEl = document.getElementById("tryon-canvas");
  hintEl = document.getElementById("tryon-hint");
  shotImg = document.getElementById("tryon-shot-img");
  onOpenLens = openLens;
  if (!root) return;

  const open = () => {
    onOpen?.();
    openTryOn();
  };

  document.getElementById("tryon-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  document.getElementById("tryon-settings-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  document.getElementById("swap-to-tryon")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  });
  document.getElementById("tryon-consent-close")?.addEventListener("click", closeTryOn);
  document.getElementById("tryon-close")?.addEventListener("click", () => {
    const fieldEl = document.getElementById("field");
    if (typeof onOpenLens === "function" && fieldEl && !fieldEl.hidden) {
      goToLens();
      return;
    }
    closeTryOn();
  });
  document.getElementById("tryon-agree")?.addEventListener("click", () => {
    hasConsented = true;
    startLiveTryOn();
  });
  document.getElementById("tryon-open-lens")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    goToLens(e);
  });
  document.getElementById("tryon-shot")?.addEventListener("click", takePhoto);
  document.getElementById("tryon-retake")?.addEventListener("click", hideShot);
  document.getElementById("tryon-save")?.addEventListener("click", savePhoto);
  root.addEventListener("click", (e) => {
    if (e.target === root && consentEl && !consentEl.hidden) closeTryOn();
  });

  for (const btn of root.querySelectorAll("[data-tryon-size]")) {
    btn.addEventListener("click", () => setSize(Number(btn.dataset.tryonSize)));
  }
  for (const btn of root.querySelectorAll("[data-tryon-finish]")) {
    btn.addEventListener("click", () => setFinish(btn.dataset.tryonFinish));
  }
}

function goToLens(e) {
  closeTryOn();
  onOpenLens?.(e);
}

export function openTryOn() {
  if (!root) return;
  hideShot();
  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  document.body.classList.add("tryon-open");
  if (hasConsented) {
    if (consentEl) consentEl.hidden = true;
    startLiveTryOn();
    return;
  }
  if (consentEl) consentEl.hidden = false;
  if (stageEl) stageEl.hidden = true;
}

export function closeTryOn() {
  running = false;
  startingLive = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  stopStream();
  hideShot();
  if (root) {
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
  }
  if (consentEl) consentEl.hidden = false;
  if (stageEl) stageEl.hidden = true;
  document.body.classList.remove("tryon-open");
  smooth = null;
  euro = {};
  lastFilterAt = 0;
}

async function startLiveTryOn() {
  if (consentEl) consentEl.hidden = true;
  if (stageEl) stageEl.hidden = false;
  if (running || startingLive) return;
  startingLive = true;
  setHint("Starting camera…");
  try {
    await startFrontCamera();
  } catch (err) {
    console.warn(err);
    startingLive = false;
    setHint("Camera blocked — allow access to try on");
    return;
  }
  setHint("Finding your face…");
  ensureFaceLandmarker();
  running = true;
  startingLive = false;
  lastVideoTs = -1;
  lastDetectAt = 0;
  lostAt = 0;
  euro = {};
  lastFilterAt = 0;
  tick();
}

async function startFrontCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API unavailable");
  }
  stopStream();
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("webkit-playsinline", "");
  videoEl.muted = true;
  videoEl.autoplay = true;
  videoEl.playsInline = true;

  const attempts = [
    { audio: false, video: { facingMode: "user", width: { ideal: 1280 } } },
    { audio: false, video: { facingMode: { ideal: "user" } } },
    { audio: false, video: true },
  ];
  let lastError = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const waitMs = i === 0 ? 8000 : 2500;
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(attempts[i]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Camera request timed out")), waitMs)
        ),
      ]);
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!stream) throw lastError || new Error("Could not open camera");
  videoEl.srcObject = stream;
  try {
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.then === "function") {
      await Promise.race([
        playPromise,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
  } catch {
    /* stream still attached */
  }
}

function stopStream() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}

function ensureFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;
  if (faceLoadPromise) return faceLoadPromise;
  faceLoadPromise = (async () => {
    const mod = await import(VISION_ESM);
    const vision = await mod.FilesetResolver.forVisionTasks(VISION_WASM);
    const options = {
      baseOptions: { modelAssetPath: FACE_MODEL },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    };
    try {
      options.baseOptions.delegate = "GPU";
      faceLandmarker = await mod.FaceLandmarker.createFromOptions(vision, options);
    } catch (gpuErr) {
      console.warn("Face landmarker GPU unavailable, using CPU", gpuErr);
      options.baseOptions.delegate = "CPU";
      faceLandmarker = await mod.FaceLandmarker.createFromOptions(vision, options);
    }
    return faceLandmarker;
  })().catch((err) => {
    console.warn("Face landmarker unavailable", err);
    faceLoadPromise = null;
    return null;
  });
  return faceLoadPromise;
}

function setSize(mm) {
  sizeMm = mm === 47 ? 47 : 52;
  for (const btn of root.querySelectorAll("[data-tryon-size]")) {
    btn.classList.toggle("is-on", Number(btn.dataset.tryonSize) === sizeMm);
  }
}

function setFinish(name) {
  finish = FINISHES[name] ? name : "black";
  for (const btn of root.querySelectorAll("[data-tryon-finish]")) {
    btn.classList.toggle("is-on", btn.dataset.tryonFinish === finish);
  }
}

function setHint(text) {
  if (!hintEl) return;
  hintEl.textContent = text || "";
  hintEl.hidden = !text;
}

function tick() {
  if (!running) return;
  rafId = requestAnimationFrame(tick);
  const canvas = canvasEl;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Mirror selfie: flip then draw camera + glasses in video space.
  ctx.setTransform(-1, 0, 0, 1, w, 0);
  ctx.filter = "grayscale(1) contrast(1.08) brightness(1.02)";
  const cover = drawVideoCover(ctx, videoEl, w, h);
  ctx.filter = "none";

  const now = performance.now();
  const raw = detectPose(cover, now);
  if (raw && raw !== "hold") {
    lostAt = 0;
    const dt = lastFilterAt ? Math.min(0.08, (now - lastFilterAt) / 1000) : 1 / 30;
    lastFilterAt = now;
    smooth = filterPose(smooth, raw, dt);
    setHint("");
  } else if (raw !== "hold" && raw == null) {
    if (!lostAt) lostAt = now;
    const gone = now - lostAt;
    if (!smooth || gone > 700) {
      smooth = null;
      euro = {};
      if (videoEl.readyState >= 2) {
        setHint(faceLandmarker ? "Look at the camera" : "Finding your face…");
      }
    }
  }
  if (smooth) {
    const faded = { ...smooth, alpha: 1 };
    faded.scale *= SIZE_SCALE[sizeMm] || 1;
    drawSnapSpecs(ctx, faded, FINISHES[finish] || FINISHES.black);
  }
}

function drawVideoCover(ctx, video, w, h) {
  const vw = video?.videoWidth || 0;
  const vh = video?.videoHeight || 0;
  if (!vw || !vh) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    return { dx: 0, dy: 0, dw: w, dh: h };
  }
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(video, dx, dy, dw, dh);
  return { dx, dy, dw, dh };
}

function detectPose(cover, nowMs) {
  if (!faceLandmarker || !videoEl || videoEl.readyState < 2) return null;
  if (nowMs - lastDetectAt < 33) return "hold";
  lastDetectAt = nowMs;
  let ts = nowMs;
  if (ts <= lastVideoTs) ts = lastVideoTs + 1;
  lastVideoTs = ts;
  let result;
  try {
    result = faceLandmarker.detectForVideo(videoEl, ts);
  } catch {
    return "hold";
  }
  const lm = result?.faceLandmarks?.[0];
  if (!lm) return null;
  return poseFromLandmarks(lm, cover);
}

function pt(lm, i, cover) {
  return {
    x: cover.dx + lm[i].x * cover.dw,
    y: cover.dy + lm[i].y * cover.dh,
    z: (lm[i].z || 0) * cover.dw,
  };
}

function subV(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function crossV(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normV(a) {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

function poseFromLandmarks(lm, cover) {
  const leftOuter = pt(lm, 33, cover);
  const leftInner = pt(lm, 133, cover);
  const rightInner = pt(lm, 362, cover);
  const rightOuter = pt(lm, 263, cover);
  const left = {
    x: (leftOuter.x + leftInner.x) * 0.5,
    y: (leftOuter.y + leftInner.y) * 0.5,
    z: (leftOuter.z + leftInner.z) * 0.5,
  };
  const right = {
    x: (rightOuter.x + rightInner.x) * 0.5,
    y: (rightOuter.y + rightInner.y) * 0.5,
    z: (rightOuter.z + rightInner.z) * 0.5,
  };
  const bridge = pt(lm, 168, cover);
  const chin = pt(lm, 152, cover);
  const brow = pt(lm, 10, cover);
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  const ipd = Math.hypot(dx, dy, dz);
  if (ipd < 8) return null;

  const ax = normV(subV(right, left));
  let ay = normV(subV(chin, brow));
  let az = crossV(ax, ay);
  if (az.z < 0) az = { x: -az.x, y: -az.y, z: -az.z };
  az = normV(az);
  ay = normV(crossV(az, ax));

  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  return {
    x: midX * 0.45 + bridge.x * 0.55,
    y: midY + ipd * 0.02,
    scale: ipd / 66,
    ax,
    ay,
    az,
    alpha: 1,
  };
}

function alphaCutoff(dt, cutoff) {
  const te = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + te / Math.max(dt, 1 / 120));
}

function euroScalar(key, value, dt, minCutoff, beta, angle) {
  const prev = euro[key];
  if (!prev) {
    euro[key] = { x: value, dx: 0 };
    return value;
  }
  let target = value;
  if (angle) {
    let d = target - prev.x;
    while (d > Math.PI) {
      target -= Math.PI * 2;
      d = target - prev.x;
    }
    while (d < -Math.PI) {
      target += Math.PI * 2;
      d = target - prev.x;
    }
  }
  const rawDx = (target - prev.x) / Math.max(dt, 1 / 120);
  const dxHat = prev.dx + alphaCutoff(dt, 1) * (rawDx - prev.dx);
  const cutoff = minCutoff + beta * Math.abs(dxHat);
  const x = prev.x + alphaCutoff(dt, cutoff) * (target - prev.x);
  euro[key] = { x, dx: dxHat };
  return x;
}

function filterPose(prev, next, dt) {
  if (!prev) {
    euro = {};
    return { ...next };
  }
  const ax = normV({
    x: euroScalar("axx", next.ax.x, dt, 0.5, 0.006),
    y: euroScalar("axy", next.ax.y, dt, 0.5, 0.006),
    z: euroScalar("axz", next.ax.z, dt, 0.5, 0.006),
  });
  const ayRaw = {
    x: euroScalar("ayx", next.ay.x, dt, 0.5, 0.006),
    y: euroScalar("ayy", next.ay.y, dt, 0.5, 0.006),
    z: euroScalar("ayz", next.ay.z, dt, 0.5, 0.006),
  };
  let az = crossV(ax, ayRaw);
  if (az.z < 0) az = { x: -az.x, y: -az.y, z: -az.z };
  az = normV(az);
  const ay = normV(crossV(az, ax));
  return {
    x: euroScalar("x", next.x, dt, 0.9, 0.008),
    y: euroScalar("y", next.y, dt, 0.9, 0.008),
    scale: euroScalar("scale", next.scale, dt, 0.55, 0.004),
    ax,
    ay,
    az,
    alpha: 1,
  };
}

function projector(pose) {
  const { x: ox, y: oy, scale: s, ax, ay, az } = pose;
  return (lx, ly, lz = 0) => ({
    x: ox + (ax.x * lx + ay.x * ly + az.x * lz) * s,
    y: oy + (ax.y * lx + ay.y * ly + az.y * lz) * s,
    z: (ax.z * lx + ay.z * ly + az.z * lz) * s,
  });
}

function wrapZ(x) {
  return 0.0018 * x * x;
}

function pathLocal(ctx, proj, pts) {
  const p0 = proj(pts[0][0], pts[0][1], pts[0][2]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = proj(pts[i][0], pts[i][1], pts[i][2]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  return p0;
}

/** Angular smart-glasses as a rigid 3D pair that wraps the head. */
function drawSnapSpecs(ctx, pose, colors) {
  const s = pose.scale;
  if (!Number.isFinite(s) || s < 0.2) return;
  if (!pose.ax || !pose.ay || !pose.az) return;
  const proj = projector(pose);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const lensW = 50;
  const lensH = 30;
  const gap = 16;
  const rim = 5.4;
  const leftCx = -(gap / 2 + lensW / 2);
  const rightCx = gap / 2 + lensW / 2;
  const leftZ = proj(leftCx, 0, wrapZ(leftCx)).z;
  const rightZ = proj(rightCx, 0, wrapZ(rightCx)).z;
  const farFirst = leftZ >= rightZ ? [-1, 1] : [1, -1];

  for (const side of farFirst) {
    const cx = side < 0 ? leftCx : rightCx;
    drawTemple(ctx, colors, proj, s, side, cx, lensW);
    drawLens(ctx, colors, proj, s, cx, lensW, lensH, rim, side);
    drawPod(ctx, colors, proj, s, cx, lensW, side);
  }
  drawBridge(ctx, colors, proj, s, gap, rim);
  ctx.restore();
}

function drawLens(ctx, colors, proj, s, cx, w, h, rim, side) {
  const outer2 = lensOutline(cx, 0, w + rim * 2, h + rim * 2, side, 5.5);
  const inner2 = lensOutline(cx, 0, w, h, side, 3.2);
  const outer = outer2.map(([x, y]) => [x, y, wrapZ(x)]);
  const inner = inner2.map(([x, y]) => [x, y, wrapZ(x)]);
  const shadow = outer.map(([x, y, z]) => [x, y + 1.4, z]);

  ctx.beginPath();
  pathLocal(ctx, proj, shadow);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();

  ctx.beginPath();
  pathLocal(ctx, proj, outer);
  ctx.fillStyle = colors.frame;
  ctx.fill();

  ctx.beginPath();
  pathLocal(ctx, proj, inner);
  const a = proj(cx - w / 2, -h / 2, wrapZ(cx - w / 2));
  const b = proj(cx + w / 2, h / 2, wrapZ(cx + w / 2));
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, "rgba(255,255,255,0.2)");
  g.addColorStop(0.4, colors.lens);
  g.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = colors.lensEdge;
  ctx.lineWidth = 0.9 * s;
  ctx.stroke();

  const hx = cx - 6 * side;
  const hy = -7;
  const hz = wrapZ(hx);
  const highlight = [
    [hx - 12, hy, hz],
    [hx, hy - 5.5, hz],
    [hx + 12, hy, hz],
    [hx, hy + 5.5, hz],
  ];
  ctx.beginPath();
  pathLocal(ctx, proj, highlight);
  ctx.fillStyle = colors.highlight;
  ctx.fill();

  const shade = [
    [cx + side * (w * 0.1), -h * 0.22, wrapZ(cx + side * (w * 0.1))],
    [cx + side * (w * 0.38), -h * 0.06, wrapZ(cx + side * (w * 0.38))],
    [cx + side * (w * 0.34), h * 0.18, wrapZ(cx + side * (w * 0.34))],
    [cx + side * (w * 0.06), h * 0.06, wrapZ(cx + side * (w * 0.06))],
  ];
  ctx.beginPath();
  pathLocal(ctx, proj, shade);
  ctx.fillStyle = "rgba(15,15,15,0.2)";
  ctx.fill();
}

function lensOutline(cx, cy, w, h, side, chamfer) {
  const c = chamfer;
  const outer = side; // +1 right lens outer is +x
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  if (outer > 0) {
    return [
      [x0 + 3, y0],
      [x1 - c, y0],
      [x1, y0 + c],
      [x1, y1 - c],
      [x1 - c, y1],
      [x0 + 3, y1],
      [x0, y1 - 3],
      [x0, y0 + 3],
    ];
  }
  return [
    [x0 + c, y0],
    [x1 - 3, y0],
    [x1, y0 + 3],
    [x1, y1 - 3],
    [x1 - 3, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

function drawBridge(ctx, colors, proj, s, gap, rim) {
  const y = -4;
  const z0 = wrapZ(0);
  const body = [
    [-gap / 2 - 2, y - rim * 0.55, z0],
    [gap / 2 + 2, y - rim * 0.55, z0],
    [gap / 2 + 2, y + rim * 0.8, z0],
    [-gap / 2 - 2, y + rim * 0.8, z0],
  ];
  ctx.beginPath();
  pathLocal(ctx, proj, body);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  const shine = [
    [-gap / 2 + 1, y - 1.2, z0],
    [gap / 2 - 1, y - 1.2, z0],
    [gap / 2 - 1, y + 1.2, z0],
    [-gap / 2 + 1, y + 1.2, z0],
  ];
  ctx.beginPath();
  pathLocal(ctx, proj, shine);
  ctx.fillStyle = colors.highlight;
  ctx.globalAlpha *= 0.45;
  ctx.fill();
  ctx.globalAlpha /= 0.45;
}

function drawPod(ctx, colors, proj, s, lensCx, lensW, side) {
  const x = lensCx + side * (lensW / 2 + 6.5);
  const y = 1;
  const z = wrapZ(x);
  const body = [
    [x - 6, y - 11, z],
    [x + 6, y - 11, z],
    [x + 6, y + 9, z],
    [x - 6, y + 9, z],
  ];
  ctx.beginPath();
  pathLocal(ctx, proj, body);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  const cam = proj(x + side * 1.6, y + 1, z + 1);
  ctx.beginPath();
  ctx.arc(cam.x, cam.y, 1.7 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#070707";
  ctx.fill();
  const glint = proj(x + side * 1.8, y + 0.6, z + 1.2);
  ctx.beginPath();
  ctx.arc(glint.x, glint.y, 0.55 * s, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(140,190,230,0.9)";
  ctx.fill();
}

function templePoly(side, lensCx, lensW) {
  const hx = lensCx + side * (lensW / 2 + 11);
  const hy = -2;
  const hz = wrapZ(hx) + 2;
  return [
    [hx, hy - 4.4, hz],
    [hx + side * 3.5, hy + 6 - 3.2, hz + 22],
    [hx + side * 6, hy + 14 - 2.1, hz + 48],
    [hx + side * 6, hy + 14 + 2.5, hz + 48],
    [hx + side * 3.5, hy + 6 + 4.2, hz + 22],
    [hx, hy + 5.4, hz],
  ];
}

function drawTemple(ctx, colors, proj, s, side, lensCx, lensW) {
  ctx.beginPath();
  pathLocal(ctx, proj, templePoly(side, lensCx, lensW));
  ctx.fillStyle = colors.frame;
  ctx.fill();
}

function takePhoto() {
  if (!canvasEl) return;
  hideShot();
  try {
    if (photoUrl && photoUrl.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
    photoUrl = canvasEl.toDataURL("image/jpeg", 0.92);
    if (shotImg) shotImg.src = photoUrl;
    if (shotEl) shotEl.hidden = false;
  } catch (err) {
    console.warn(err);
  }
}

function hideShot() {
  if (shotEl) shotEl.hidden = true;
}

function savePhoto() {
  if (!photoUrl) return;
  const a = document.createElement("a");
  a.href = photoUrl;
  a.download = "snap-specs-try-on.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
