/** Snap Specs virtual try-on — front camera + face-locked glasses overlay. */

const VISION_ESM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm";
const VISION_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const SIZE_SCALE = { 47: 0.9, 52: 1 };
const LENS_W = 50;
const LENS_H = 35;
const LENS_GAP = 20;
const LENS_RIM = 7.6;
const FRAME_SPAN = LENS_W + LENS_GAP;
const RIM_DEPTH = 5.5;
const FINISHES = {
  black: {
    frame: "#0a0a0a",
    rim: "#141414",
    highlight: "rgba(255,255,255,0.34)",
    metal: "#111111",
    lensHi: "rgba(210, 236, 250, 0.5)",
    lens: "rgba(78, 132, 178, 0.3)",
    lensLo: "rgba(22, 40, 62, 0.38)",
    lensEdge: "rgba(220, 238, 248, 0.4)",
  },
  silver: {
    frame: "#d4d4d4",
    rim: "#efefef",
    highlight: "rgba(255,255,255,0.58)",
    metal: "#b8b8b8",
    lensHi: "rgba(176, 214, 232, 0.5)",
    lens: "rgba(42, 72, 104, 0.38)",
    lensLo: "rgba(16, 26, 40, 0.48)",
    lensEdge: "rgba(220, 232, 242, 0.5)",
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

  const pose = detectPose(cover, performance.now());
  if (pose) {
    lostAt = 0;
    smooth = lerpPose(smooth, pose, smooth ? 0.32 : 1);
    setHint("");
    const faded = { ...smooth, alpha: 1 };
    faded.scale *= SIZE_SCALE[sizeMm] || 1;
    drawSnapSpecs(ctx, faded, FINISHES[finish] || FINISHES.black);
  } else {
    if (!lostAt) lostAt = performance.now();
    const gone = performance.now() - lostAt;
    if (smooth && gone < 280) {
      const faded = { ...smooth, alpha: 1 - gone / 280 };
      faded.scale *= SIZE_SCALE[sizeMm] || 1;
      drawSnapSpecs(ctx, faded, FINISHES[finish] || FINISHES.black);
    } else {
      smooth = null;
      if (videoEl.readyState >= 2) {
        setHint(faceLandmarker ? "Look at the camera" : "Finding your face…");
      }
    }
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
  if (nowMs - lastDetectAt < 33) return smooth;
  lastDetectAt = nowMs;
  let ts = nowMs;
  if (ts <= lastVideoTs) ts = lastVideoTs + 1;
  lastVideoTs = ts;
  let result;
  try {
    result = faceLandmarker.detectForVideo(videoEl, ts);
  } catch {
    return smooth;
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
  const brow = pt(lm, 10, cover);
  const chin = pt(lm, 152, cover);
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

  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2 + ipd * 0.015,
    scale: ipd / FRAME_SPAN,
    ax,
    ay,
    az,
    alpha: 1,
  };
}

function lerpPose(a, b, t) {
  if (!a) return { ...b };
  const mix = (p, q) => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
    z: p.z + (q.z - p.z) * t,
  });
  const ax = normV(mix(a.ax, b.ax));
  let az = crossV(ax, mix(a.ay, b.ay));
  if (az.z < 0) az = { x: -az.x, y: -az.y, z: -az.z };
  az = normV(az);
  const ay = normV(crossV(az, ax));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    scale: a.scale + (b.scale - a.scale) * t,
    ax,
    ay,
    az,
    alpha: b.alpha,
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
  return 0.0021 * x * x;
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

function roundedRectPoints(x, y, w, h, rtl, rtr, rbr, rbl, n = 4) {
  const pts = [];
  const arc = (cx, cy, r, a0, a1) => {
    const rr = Math.max(0.05, r);
    for (let i = 0; i <= n; i += 1) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  arc(x + rtl, y + rtl, rtl, Math.PI, Math.PI * 1.5);
  arc(x + w - rtr, y + rtr, rtr, Math.PI * 1.5, Math.PI * 2);
  arc(x + w - rbr, y + h - rbr, rbr, 0, Math.PI * 0.5);
  arc(x + rbl, y + h - rbl, rbl, Math.PI * 0.5, Math.PI);
  return pts;
}

function lensOutline(cx, w, h, side, inset) {
  const ww = w - inset * 2;
  const hh = h - inset * 2;
  const x = cx - ww / 2;
  const y = -hh / 2;
  const rOut = Math.max(3.4, 10.5 - inset * 0.65);
  const rIn = Math.max(2.2, 5.6 - inset * 0.4);
  if (side > 0) return roundedRectPoints(x, y, ww, hh, rIn, rOut, rOut, rIn);
  return roundedRectPoints(x, y, ww, hh, rOut, rIn, rIn, rOut);
}

function withWrap(pts2) {
  return pts2.map(([x, y]) => [x, y, wrapZ(x)]);
}

/** Chunky wraparound Snap Specs as a rigid 3D pair on the eyes. */
function drawSnapSpecs(ctx, pose, colors) {
  const s = pose.scale;
  if (!Number.isFinite(s) || s < 0.2) return;
  if (!pose.ax || !pose.ay || !pose.az) return;
  const proj = projector(pose);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const leftCx = -(LENS_GAP / 2 + LENS_W / 2);
  const rightCx = LENS_GAP / 2 + LENS_W / 2;
  const leftZ = proj(leftCx, 0, wrapZ(leftCx)).z;
  const rightZ = proj(rightCx, 0, wrapZ(rightCx)).z;
  const farFirst = leftZ >= rightZ ? [-1, 1] : [1, -1];
  const leftHinge = proj(leftCx - LENS_W / 2 - 8, 0, 8);
  const leftTip = proj(leftCx - LENS_W / 2 - 8, 3, 78);
  const rightHinge = proj(rightCx + LENS_W / 2 + 8, 0, 8);
  const rightTip = proj(rightCx + LENS_W / 2 + 8, 3, 78);
  const origin = proj(0, 0, 0);
  const leftOut = Math.abs(leftTip.x - origin.x) - Math.abs(leftHinge.x - origin.x);
  const rightOut = Math.abs(rightTip.x - origin.x) - Math.abs(rightHinge.x - origin.x);
  const minOut = 10 * Math.max(1, s);
  const templeSide =
    leftOut >= rightOut && leftOut > minOut ? -1 : rightOut > minOut ? 1 : 0;

  for (const side of farFirst) {
    const cx = side < 0 ? leftCx : rightCx;
    if (side === templeSide) drawTemple(ctx, colors, proj, side, cx);
    drawLens(ctx, colors, proj, s, cx, side);
    drawPod(ctx, colors, proj, s, cx, side);
  }
  drawBridge(ctx, colors, proj);
  ctx.restore();
}

function ellipsePoly(cx, cy, rx, ry, z, n = 10) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
  }
  return pts;
}

function drawLens(ctx, colors, proj, s, cx, side) {
  const outer = withWrap(lensOutline(cx, LENS_W + LENS_RIM * 2, LENS_H + LENS_RIM * 2, side, 0));
  const inner = withWrap(lensOutline(cx, LENS_W, LENS_H, side, 0));
  const outerBack = outer.map(([x, y, z]) => [x + side * 1.4, y, z + RIM_DEPTH]);
  const shadow = outer.map(([x, y, z]) => [x, y + 1.6, z + 1]);

  ctx.beginPath();
  pathLocal(ctx, proj, shadow);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fill();

  ctx.beginPath();
  pathLocal(ctx, proj, outerBack);
  ctx.fillStyle = colors.rim;
  ctx.fill();

  ctx.beginPath();
  pathLocal(ctx, proj, outer);
  ctx.fillStyle = colors.frame;
  ctx.fill();

  ctx.beginPath();
  pathLocal(ctx, proj, inner);
  const a = proj(cx - LENS_W / 2, -LENS_H / 2, wrapZ(cx - LENS_W / 2));
  const b = proj(cx + LENS_W / 2, LENS_H / 2, wrapZ(cx + LENS_W / 2));
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, colors.lensHi);
  g.addColorStop(0.38, colors.lens);
  g.addColorStop(1, colors.lensLo);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = colors.lensEdge;
  ctx.lineWidth = Math.max(0.8, 1.05 * s);
  ctx.stroke();

  const hx = cx - 6 * side;
  const hy = -7.5;
  const hz = wrapZ(hx);
  ctx.beginPath();
  pathLocal(ctx, proj, ellipsePoly(hx, hy, 13, 6.2, hz, 12));
  ctx.fillStyle = colors.highlight;
  ctx.fill();
}

function drawBridge(ctx, colors, proj) {
  const y = -2.6;
  const z0 = wrapZ(0);
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [-LENS_GAP / 2 + 1, y - 4.2, z0],
    [LENS_GAP / 2 - 1, y - 4.2, z0],
    [LENS_GAP / 2 - 1, y + 5.4, z0],
    [-LENS_GAP / 2 + 1, y + 5.4, z0],
  ]);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [-LENS_GAP / 2 + 3, y - 1.2, z0],
    [LENS_GAP / 2 - 3, y - 1.2, z0],
    [LENS_GAP / 2 - 3, y + 1.4, z0],
    [-LENS_GAP / 2 + 3, y + 1.4, z0],
  ]);
  ctx.fillStyle = colors.highlight;
  ctx.globalAlpha *= 0.4;
  ctx.fill();
  ctx.globalAlpha /= 0.4;
}

function drawPod(ctx, colors, proj, s, lensCx, side) {
  const x = lensCx + side * (LENS_W / 2 + 8.2);
  const y = 0.4;
  const z = wrapZ(x) + 2.5;
  const xIn = x - side * 6;
  const xOut = x + side * 9.2;
  const y0 = y - 14;
  const y1 = y + 13;
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [xOut, y0 + 1.2, z + 9],
    [xOut, y1 - 1.2, z + 9],
    [x + side * 5.4, y1, z],
    [x + side * 5.4, y0, z],
  ]);
  ctx.fillStyle = colors.rim;
  ctx.fill();
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [xIn, y0, z],
    [x + side * 5.4, y0, z],
    [x + side * 5.4, y1, z],
    [xIn, y1, z],
  ]);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  const cam = proj(x + side * 2.6, y + 1.5, z + 2.4);
  ctx.beginPath();
  ctx.arc(cam.x, cam.y, 2.25 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#050505";
  ctx.fill();
  const glint = proj(x + side * 2.9, y + 0.7, z + 2.8);
  ctx.beginPath();
  ctx.arc(glint.x, glint.y, 0.74 * s, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(140, 195, 230, 0.9)";
  ctx.fill();
}

function drawTemple(ctx, colors, proj, side, lensCx) {
  const hx = lensCx + side * (LENS_W / 2 + 7.6);
  const y0 = -9.2;
  const y1 = 9.8;
  const z0 = wrapZ(hx) + 5;
  const z1 = z0 + 58;
  const xOut = hx + side * 3.8;
  const xIn = hx - side * 0.8;
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [xOut, y0, z0],
    [xOut + side * 2.4, y0 + 4.5, z1],
    [xOut + side * 2.4, y1 + 6.5, z1],
    [xOut, y1, z0],
  ]);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  ctx.beginPath();
  pathLocal(ctx, proj, [
    [xIn, y0, z0],
    [xOut, y0, z0],
    [xOut + side * 2.4, y0 + 4.5, z1],
    [xIn + side * 2.4, y0 + 4.5, z1],
  ]);
  ctx.fillStyle = colors.highlight;
  ctx.globalAlpha *= 0.22;
  ctx.fill();
  ctx.globalAlpha /= 0.22;
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
