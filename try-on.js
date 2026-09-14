/** Snap Specs virtual try-on — front camera + face-locked glasses overlay. */

const VISION_ESM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm";
const VISION_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const SIZE_SCALE = { 47: 0.9, 52: 1 };
const FINISHES = {
  black: {
    frame: "#111111",
    rim: "#1c1c1c",
    highlight: "rgba(255,255,255,0.22)",
    metal: "#2a2a2a",
    lens: "rgba(40, 70, 95, 0.28)",
    lensEdge: "rgba(180, 210, 230, 0.35)",
  },
  silver: {
    frame: "#d8d8d8",
    rim: "#f2f2f2",
    highlight: "rgba(255,255,255,0.55)",
    metal: "#9a9a9a",
    lens: "rgba(30, 50, 70, 0.22)",
    lensEdge: "rgba(220, 230, 240, 0.45)",
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
let lastVideoTs = -1;
let lastDetectAt = 0;
let smooth = null;
let lostAt = 0;
let sizeMm = 52;
let finish = "black";
let photoUrl = "";

export function isTryOnOpen() {
  return Boolean(root && !root.hidden);
}

export function bindTryOn({ onOpen } = {}) {
  root = document.getElementById("tryon-root");
  consentEl = document.getElementById("tryon-consent");
  stageEl = document.getElementById("tryon-stage");
  shotEl = document.getElementById("tryon-shot-modal");
  videoEl = document.getElementById("tryon-cam");
  canvasEl = document.getElementById("tryon-canvas");
  hintEl = document.getElementById("tryon-hint");
  shotImg = document.getElementById("tryon-shot-img");
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
  document.getElementById("tryon-consent-close")?.addEventListener("click", closeTryOn);
  document.getElementById("tryon-close")?.addEventListener("click", closeTryOn);
  document.getElementById("tryon-agree")?.addEventListener("click", startLiveTryOn);
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

export function openTryOn() {
  if (!root) return;
  hideShot();
  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  if (consentEl) consentEl.hidden = false;
  if (stageEl) stageEl.hidden = true;
  document.body.classList.add("tryon-open");
}

export function closeTryOn() {
  running = false;
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
  setHint("Starting camera…");
  try {
    await startFrontCamera();
  } catch (err) {
    console.warn(err);
    setHint("Camera blocked — allow access to try on");
    return;
  }
  setHint("Finding your face…");
  ensureFaceLandmarker();
  running = true;
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
    smooth = lerpPose(smooth, pose, smooth ? 0.38 : 1);
    setHint("");
    const faded = { ...smooth, alpha: 1 };
    faded.scale *= SIZE_SCALE[sizeMm] || 1;
    drawSnapSpecs(ctx, faded, FINISHES[finish]);
  } else {
    if (!lostAt) lostAt = performance.now();
    const gone = performance.now() - lostAt;
    if (smooth && gone < 280) {
      const faded = { ...smooth, alpha: 1 - gone / 280 };
      faded.scale *= SIZE_SCALE[sizeMm] || 1;
      drawSnapSpecs(ctx, faded, FINISHES[finish]);
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
    z: lm[i].z || 0,
  };
}

function poseFromLandmarks(lm, cover) {
  const left = pt(lm, 33, cover);
  const right = pt(lm, 263, cover);
  const nose = pt(lm, 1, cover);
  const bridge = pt(lm, 168, cover);
  const brow = pt(lm, 10, cover);
  const chin = pt(lm, 152, cover);
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const ipd = Math.hypot(dx, dy);
  if (ipd < 8) return null;
  const roll = Math.atan2(dy, dx);
  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  const yaw = Math.atan2(left.z - right.z, ipd / cover.dw) * 0.85;
  const faceH = Math.hypot(chin.x - brow.x, chin.y - brow.y) || ipd * 2.4;
  const pitch = Math.atan2(nose.y - midY, faceH) * 1.6;
  return {
    x: midX * 0.35 + bridge.x * 0.65,
    y: midY * 0.55 + bridge.y * 0.45,
    scale: ipd / 64,
    roll,
    yaw,
    pitch,
    alpha: 1,
  };
}

function lerpPose(a, b, t) {
  if (!a) return { ...b };
  const lerpA = (x, y) => x + (y - x) * t;
  let dRoll = b.roll - a.roll;
  while (dRoll > Math.PI) dRoll -= Math.PI * 2;
  while (dRoll < -Math.PI) dRoll += Math.PI * 2;
  return {
    x: lerpA(a.x, b.x),
    y: lerpA(a.y, b.y),
    scale: lerpA(a.scale, b.scale),
    roll: a.roll + dRoll * t,
    yaw: lerpA(a.yaw, b.yaw),
    pitch: lerpA(a.pitch, b.pitch),
    alpha: b.alpha,
  };
}

/** Angular smart-glasses matching the Snap Specs / SPECS silhouette. */
function drawSnapSpecs(ctx, pose, colors) {
  const s = pose.scale;
  if (!Number.isFinite(s) || s < 0.2) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.roll);
  const yaw = clamp(pose.yaw, -0.7, 0.7);
  const pitch = clamp(pose.pitch, -0.45, 0.35);
  const flatten = Math.cos(yaw);
  ctx.transform(flatten, pitch * 0.18, 0, 1 + Math.abs(pitch) * 0.04, 0, 0);

  const lensW = 52;
  const lensH = 36;
  const gap = 16;
  const rim = 6.2;
  const leftCx = -(gap / 2 + lensW / 2);
  const rightCx = gap / 2 + lensW / 2;

  drawTemple(ctx, colors, s, -1, yaw, leftCx, lensW, lensH);
  drawTemple(ctx, colors, s, 1, yaw, rightCx, lensW, lensH);

  drawLens(ctx, colors, s, leftCx, 0, lensW, lensH, rim, -1, yaw);
  drawLens(ctx, colors, s, rightCx, 0, lensW, lensH, rim, 1, yaw);
  drawBridge(ctx, colors, s, gap, rim);
  drawPod(ctx, colors, s, leftCx, lensW, lensH, -1);
  drawPod(ctx, colors, s, rightCx, lensW, lensH, 1);

  ctx.restore();
}

function drawLens(ctx, colors, s, cx, cy, w, h, rim, side, yaw) {
  ctx.save();
  ctx.scale(s, s);
  const outer = lensOutline(cx, cy, w + rim * 2, h + rim * 2, side);
  const inner = lensOutline(cx, cy, w, h, side);

  ctx.beginPath();
  pathPoly(ctx, outer);
  ctx.fillStyle = colors.frame;
  ctx.fill();

  ctx.beginPath();
  pathPoly(ctx, inner);
  const g = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  g.addColorStop(0, "rgba(255,255,255,0.16)");
  g.addColorStop(0.45, colors.lens);
  g.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = colors.lensEdge;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx - 8 * side, cy - 8, 14, 7, -0.4 * side, 0, Math.PI * 2);
  ctx.fillStyle = colors.highlight;
  ctx.fill();

  // Inner temple reflection in the lens (SPECS try-on look).
  ctx.beginPath();
  ctx.moveTo(cx + side * (w * 0.18), cy - h * 0.28);
  ctx.lineTo(cx + side * (w * 0.42), cy - h * 0.08);
  ctx.lineTo(cx + side * (w * 0.38), cy + h * 0.22);
  ctx.lineTo(cx + side * (w * 0.12), cy + h * 0.08);
  ctx.closePath();
  ctx.fillStyle = `rgba(20,20,20,${0.18 + Math.abs(yaw) * 0.2})`;
  ctx.fill();
  ctx.restore();
}

function lensOutline(cx, cy, w, h, side) {
  const ox = side * (w * 0.08);
  return [
    [cx - w / 2 + 7 - ox * 0.2, cy - h / 2],
    [cx + w / 2 - 4 + ox, cy - h / 2 + 3],
    [cx + w / 2 + 2 + ox, cy - h * 0.12],
    [cx + w / 2 + 2 + ox, cy + h * 0.18],
    [cx + w / 2 - 6 + ox, cy + h / 2],
    [cx - w / 2 + 8 - ox * 0.2, cy + h / 2],
    [cx - w / 2 - 1, cy + h * 0.12],
    [cx - w / 2 - 1, cy - h * 0.18],
  ];
}

function pathPoly(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function drawBridge(ctx, colors, s, gap, rim) {
  ctx.save();
  ctx.scale(s, s);
  ctx.beginPath();
  const y = -4;
  roundedRect(ctx, -gap / 2 - 2, y - rim * 0.55, gap + 4, rim * 1.35, 2);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  ctx.beginPath();
  roundedRect(ctx, -gap / 2 + 1, y - 1.2, gap - 2, 2.4, 1);
  ctx.fillStyle = colors.highlight;
  ctx.globalAlpha *= 0.45;
  ctx.fill();
  ctx.restore();
}

function drawPod(ctx, colors, s, lensCx, lensW, lensH, side) {
  ctx.save();
  ctx.scale(s, s);
  const x = lensCx + side * (lensW / 2 + 7);
  const y = 2;
  ctx.beginPath();
  roundedRect(ctx, x - 7, y - lensH * 0.28, 14, 22, 2.5);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + side * 2, y + 2, 2.1, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0a0a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + side * 2.2, y + 1.6, 0.7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(120,180,220,0.85)";
  ctx.fill();
  ctx.restore();
}

function drawTemple(ctx, colors, s, side, yaw, lensCx, lensW, lensH) {
  const visible = side * yaw;
  const length = 78 * (0.55 + Math.max(0, visible) * 1.4);
  if (length < 18) return;
  ctx.save();
  ctx.scale(s, s);
  const x0 = lensCx + side * (lensW / 2 + 12);
  const y0 = -lensH * 0.08;
  const depth = 22 + Math.abs(yaw) * 28;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 5);
  ctx.lineTo(x0 + side * length * 0.15, y0 - 4);
  ctx.lineTo(x0 + side * length, y0 - 2 + depth * 0.15);
  ctx.lineTo(x0 + side * length, y0 + 8 + depth * 0.15);
  ctx.lineTo(x0 + side * length * 0.15, y0 + 8);
  ctx.lineTo(x0, y0 + 7);
  ctx.closePath();
  ctx.fillStyle = colors.metal;
  ctx.fill();
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function takePhoto() {
  if (!canvasEl) return;
  hideShot();
  canvasEl.toBlob(
    (blob) => {
      if (!blob) return;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(blob);
      if (shotImg) shotImg.src = photoUrl;
      if (shotEl) shotEl.hidden = false;
    },
    "image/jpeg",
    0.92
  );
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
