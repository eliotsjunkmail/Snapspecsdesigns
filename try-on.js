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
    z: lm[i].z || 0,
  };
}

function poseFromLandmarks(lm, cover) {
  const leftOuter = pt(lm, 33, cover);
  const leftInner = pt(lm, 133, cover);
  const rightInner = pt(lm, 362, cover);
  const rightOuter = pt(lm, 263, cover);
  const left = {
    x: (leftOuter.x + leftInner.x) * 0.5,
    y: (leftOuter.y + leftInner.y) * 0.5,
  };
  const right = {
    x: (rightOuter.x + rightInner.x) * 0.5,
    y: (rightOuter.y + rightInner.y) * 0.5,
  };
  const nose = pt(lm, 1, cover);
  const bridge = pt(lm, 168, cover);
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const ipd = Math.hypot(dx, dy);
  if (ipd < 8) return null;
  const roll = Math.atan2(dy, dx);
  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  // Nose offset is stabler than per-ear landmarks; temples stay a rigid pair.
  const yaw = clamp((nose.x - midX) / ipd, -0.85, 0.85);
  const pitch = clamp(((nose.y - midY) / ipd) * 0.7, -0.5, 0.4);
  return {
    x: midX * 0.4 + bridge.x * 0.6,
    y: midY + ipd * 0.04,
    scale: ipd / 72,
    roll,
    yaw,
    pitch,
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
  return {
    x: euroScalar("x", next.x, dt, 0.9, 0.008),
    y: euroScalar("y", next.y, dt, 0.9, 0.008),
    scale: euroScalar("scale", next.scale, dt, 0.55, 0.004),
    roll: euroScalar("roll", next.roll, dt, 0.5, 0.006, true),
    yaw: euroScalar("yaw", next.yaw, dt, 0.38, 0.004),
    pitch: euroScalar("pitch", next.pitch, dt, 0.4, 0.004),
    alpha: 1,
  };
}

/** Angular smart-glasses matching the Snap Specs / SPECS silhouette. */
function drawSnapSpecs(ctx, pose, colors) {
  const s = pose.scale;
  if (!Number.isFinite(s) || s < 0.2) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
  const yaw = clamp(pose.yaw, -0.85, 0.85);
  const pitch = clamp(pose.pitch, -0.5, 0.4);
  ctx.translate(pose.x, pose.y + pitch * s * 6);
  ctx.rotate(pose.roll);
  ctx.scale(Math.max(0.42, Math.cos(yaw)), 1);

  const lensW = 50;
  const lensH = 30;
  const gap = 14;
  const rim = 5.4;
  const leftCx = -(gap / 2 + lensW / 2);
  const rightCx = gap / 2 + lensW / 2;

  drawTemple(ctx, colors, s, -1, yaw, pitch, leftCx, lensW);
  drawTemple(ctx, colors, s, 1, yaw, pitch, rightCx, lensW);
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
  const outer = lensOutline(cx, cy, w + rim * 2, h + rim * 2, side, 5.5);
  const inner = lensOutline(cx, cy, w, h, side, 3.2);

  ctx.beginPath();
  pathPoly(ctx, outer);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.translate(0, 1.4);
  ctx.fill();
  ctx.translate(0, -1.4);

  ctx.beginPath();
  pathPoly(ctx, outer);
  ctx.fillStyle = colors.frame;
  ctx.fill();

  ctx.beginPath();
  pathPoly(ctx, inner);
  const g = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  g.addColorStop(0, "rgba(255,255,255,0.2)");
  g.addColorStop(0.4, colors.lens);
  g.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = colors.lensEdge;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx - 6 * side, cy - 7, 12, 5.5, -0.35 * side, 0, Math.PI * 2);
  ctx.fillStyle = colors.highlight;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + side * (w * 0.1), cy - h * 0.22);
  ctx.lineTo(cx + side * (w * 0.38), cy - h * 0.06);
  ctx.lineTo(cx + side * (w * 0.34), cy + h * 0.18);
  ctx.lineTo(cx + side * (w * 0.06), cy + h * 0.06);
  ctx.closePath();
  ctx.fillStyle = `rgba(15,15,15,${0.14 + Math.abs(yaw) * 0.18})`;
  ctx.fill();
  ctx.restore();
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
  const x = lensCx + side * (lensW / 2 + 6.5);
  const y = 1;
  ctx.beginPath();
  roundedRect(ctx, x - 6, y - 11, 12, 20, 2);
  ctx.fillStyle = colors.frame;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + side * 1.6, y + 1, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = "#070707";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + side * 1.8, y + 0.6, 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(140,190,230,0.9)";
  ctx.fill();
  ctx.restore();
}

function templeShape(side, yaw, pitch, hingeX, hingeY) {
  const recede = yaw * side;
  // Short front stubs wrap back toward the ears; yaw only changes length.
  const length = Math.max(8, 12 + recede * 18);
  const drop = 11 + clamp(pitch, -0.4, 0.4) * 2;
  return {
    x0: hingeX,
    y0: hingeY,
    x1: hingeX + side * length,
    y1: hingeY + drop,
    mx: hingeX + side * length * 0.52,
    my: hingeY + drop * 0.38,
  };
}

function drawTemple(ctx, colors, s, side, yaw, pitch, lensCx, lensW) {
  ctx.save();
  ctx.scale(s, s);
  const hingeX = lensCx + side * (lensW / 2 + 11);
  const hingeY = -2;
  const t = templeShape(side, yaw, pitch, hingeX, hingeY);
  ctx.beginPath();
  ctx.moveTo(t.x0, t.y0 - 4.2);
  ctx.quadraticCurveTo(t.mx, t.my - 3.2, t.x1, t.y1 - 2.2);
  ctx.lineTo(t.x1, t.y1 + 2.6);
  ctx.quadraticCurveTo(t.mx, t.my + 4.4, t.x0, t.y0 + 5.6);
  ctx.closePath();
  ctx.fillStyle = colors.frame;
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
