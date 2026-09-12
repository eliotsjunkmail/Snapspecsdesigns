import * as THREE from "three";
import {
  cloudConfigured,
  loadSpots,
  publishSpot,
  deleteSpot,
  videoUrl,
  thumbUrl,
  posterUrl,
} from "./cloud.js";
import { readVideoCaptureMeta, formatTakenLabel } from "./video-meta.js";
import { formatTownName } from "./place-name.js";
import {
  distanceMeters,
  nearestCachedPlace as nearestPlaceInCache,
  placeCacheKey,
  fetchTownName,
} from "./place-geo.js";
import {
  carouselDragLiftDelta,
  carouselRelativePitch,
  carouselTiltTravel,
  screenYToWorldY,
  carouselHudBandPx,
  clampShiftToBand,
  carouselTravelShiftY,
  carouselAimAngle,
  stickyViewSize,
  carouselYearGroups,
  carouselYearMarkY,
  carouselYearMarkRadius,
  carouselYearMarkMinAngle,
  spreadYearMarkAngles,
  carouselFocusLabel,
} from "./carousel-tilt.js";
import {
  playGrowTarget,
  stepPlayGrow,
  playGrowScale,
  layoutSizeWithGrow,
} from "./play-grow.js";
import {
  videoHasPaintedFrame,
  waitForPaintedVideoFrame,
} from "./video-preview.js";

const CAMERA_RANGE_MIN_FT = 25;
const CAMERA_RANGE_MAX_FT = 10 * 5280;
const CAMERA_RANGE_DEFAULT_FT = 100;
const FALLBACK_TOWN = "Nearby";
const CAMERA_RANGE_SLIDER_MAX = 1000;
const TIME_RANGE_MAX_YR = 20;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const FEET_PER_MILE = 5280;
const RADAR_DOT_COUNT = 10;
const VIEW_CLIP_COUNT = 20;
const CAMERA_SPREAD_M = 2.05;
const CAMERA_STACK_M = 2.4;
const CAROUSEL_DIST_M = 6.2;
const CAROUSEL_MAX = VIEW_CLIP_COUNT;
const CAROUSEL_GAP_M = 0.03;
const CAROUSEL_PACK = 0.98;
const CAROUSEL_SCALE = 3;
const CAROUSEL_SCALE_SMALL = 1.45;
const CAROUSEL_FLOOR_Y = 0.05;
const CAROUSEL_ROW_GAP_M = 0.85;
/** Sit with the viewfinder, slightly above mid-screen. */
const CAROUSEL_DROP_Y = -0.2;
/** Input safety; the header–shutter band is the real visual stop. */
const CAROUSEL_DRAG_Y_MIN = -10;
const CAROUSEL_DRAG_Y_MAX = 10;
const CAROUSEL_DRAG_LIFT = 0.007;
/** Phone tilt reaches the header or shutter with a modest lean. */
const CAROUSEL_TILT_GAIN = 2.1;
const CAROUSEL_TILT_SPAN = 0.36;
const LOOK_FOV_DEFAULT = 60;
const LOOK_FOV_MIN = 28;
const LOOK_FOV_MAX = 78;
/** Horizontal FOV so 3× clips fill the lens without shrinking the ring. */
const CAROUSEL_HFOV = 40;
const CAROUSEL_HFOV_SMALL = 56;
const CAROUSEL_FOV_MAX = 145;
/** Dark matte around image planes. Video frames stay clear. */
const CLIP_FRAME_COLOR = 0x242424;

/** Stable anonymous id so users can delete their own shared pins. */
function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem("lumen-device");
  } catch {
    /* private browsing */
  }
  if (!id) {
    id =
      crypto.randomUUID?.() ||
      `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      localStorage.setItem("lumen-device", id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

// Sample clips are off by default — the field starts from the phone library.
// To showcase clips for every visitor, add entries here (files in ./media):
// { id, title, blurb, src: "./media/name.mp4", position: [x, y, z], demo: true }
const CATALOG = [];

const gate = document.getElementById("gate");
const field = document.getElementById("field");
const enterBtn = document.getElementById("enter-btn");
const camEl = document.getElementById("cam");
const canvas = document.getElementById("stage");
const rangeSlider = document.getElementById("range-slider");
const rangeSheetValue = document.getElementById("range-sheet-value");
const timeMinSlider = document.getElementById("time-min");
const timeMaxSlider = document.getElementById("time-max");
const timeSheetValue = document.getElementById("time-sheet-value");
const timeFill = document.getElementById("time-fill");
const layoutPlaceBtn = document.getElementById("layout-place");
const layoutCarouselBtn = document.getElementById("layout-carousel");
const videoSizeLargeBtn = document.getElementById("video-size-large");
const videoSizeSmallBtn = document.getElementById("video-size-small");
const createSettingOffBtn = document.getElementById("create-setting-off");
const createSettingOnBtn = document.getElementById("create-setting-on");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const focusLabel = document.getElementById("focus-label");
const townSelect = document.getElementById("town-select");
const townSlot = document.querySelector(".town-slot");
const watchBtn = document.getElementById("watch-btn");
const statusEl = document.getElementById("status");
const radarDots = document.getElementById("radar-dots");
const theater = document.getElementById("theater");
const theaterVideo = document.getElementById("theater-video");
const theaterImage = document.getElementById("theater-image");
const theaterTitle = document.getElementById("theater-title");
const theaterScreenWrap = document.querySelector(".theater-screen-wrap");
const uploadNote = document.getElementById("upload-note");
const videoInputGate = document.getElementById("video-input-gate");
const videoInputField = document.getElementById("video-input-field");
const videoInputCapture = document.getElementById("video-input-capture");
const addBtn = document.getElementById("add-btn");
const fieldLoading = document.getElementById("field-loading");
const uploadOverlay = document.getElementById("upload-overlay");
const uploadOverlayTitle = document.getElementById("upload-overlay-title");
const uploadOverlayCopy = document.getElementById("upload-overlay-copy");
const libraryPick = document.getElementById("library-pick");
const libraryPickBtn = document.getElementById("library-pick-btn");
const libraryPickSkip = document.getElementById("library-pick-skip");
const addModal = document.getElementById("add-modal");
const addCapture = document.getElementById("add-capture");
const addAlbum = document.getElementById("add-album");
const addCreate = document.getElementById("add-create");
const addClose = document.getElementById("add-close");
const createModal = document.getElementById("create-modal");
const createForm = document.getElementById("create-form");
const createInput = document.getElementById("create-input");
const createCancel = document.getElementById("create-cancel");
const createSubmit = document.getElementById("create-submit");
const createStatus = document.getElementById("create-status");
const createProgress = document.getElementById("create-progress");
const createProgressFill = document.getElementById("create-progress-fill");
const deleteBtn = document.getElementById("delete-btn");
const theaterDelete = document.getElementById("theater-delete");
const theaterClose = document.getElementById("theater-close");
const theaterDone = document.getElementById("theater-done");
const reactBurst = document.getElementById("react-burst");
const confirmModal = document.getElementById("confirm-modal");
const confirmCopy = document.getElementById("confirm-copy");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmOk = document.getElementById("confirm-ok");
const nameModal = document.getElementById("name-modal");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const nameFile = document.getElementById("name-file");
const nameHint = document.getElementById("name-hint");
const nameSubmit = document.getElementById("name-submit");
const nameCancel = document.getElementById("name-cancel");
const radar = document.getElementById("radar");
const fieldLocate = document.getElementById("field-locate");
const mapModal = document.getElementById("map-modal");
const mapBackdrop = document.getElementById("map-backdrop");
const mapClose = document.getElementById("map-close");
const mapViewport = document.getElementById("map-viewport");
const mapList = document.getElementById("map-list");
const guide = document.getElementById("guide");
const guideArrow = document.getElementById("guide-arrow");
const guideLabel = document.getElementById("guide-label");

const state = {
  offsetYaw: 0,
  offsetPitch: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  focused: null,
  watchingNode: null,
  watching: false,
  theaterFromMap: false,
  booting: false,
  booted: false,
  pendingUploads: [],
  nameQueue: [],
  naming: false,
  uploadCount: 0,
  originGeo: null,
  userGeo: null,
  viewGeo: null,
  viewFollowsUser: true,
  mapProgrammatic: false,
  geoWatchId: null,
  demoGeoReady: false,
  mapOpen: false,
  selectedClusterId: null,
  selectedTown: null,
  townFollowsUser: true,
  mapExpandedTown: null,
  mapTownCollapsed: false,
  mapArrowEls: new Map(),
  mapRowEls: new Map(),
  mapTownEls: new Map(),
  mapListAt: 0,
  leafletMap: null,
  leafletMarkers: new Map(),
  leafletYou: null,
  nodes: [],
  clock: new THREE.Clock(),
  hasGyro: false,
  orientReady: false,
  northAligned: false,
  theaterAnimId: null,
  cameraRangeFt: CAMERA_RANGE_DEFAULT_FT,
  timeMinYr: 0,
  timeMaxYr: TIME_RANGE_MAX_YR,
  cameraLayout: "carousel",
  videoSize: "small",
  settingsOpen: false,
  carouselFwdX: null,
  carouselFwdZ: null,
  carouselYearMarks: [],
  carouselLookPitch: 0,
  carouselTiltT: 0,
  carouselPitchBaseline: null,
  carouselDragY: 0,
  carouselViewH: 0,
  showCreate: false,
  fovPinched: false,
  mediaLoading: false,
};

let renderer;
let scene;
let camera;
let statusTimer;

// Device-orientation → camera (Three.js DeviceOrientationControls math)
const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 on X
const _deviceQuat = new THREE.Quaternion();
const _offsetQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _to = new THREE.Vector3();
const _right = new THREE.Vector3();
const _place = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _upHeading = new THREE.Vector3();
const _northQuat = new THREE.Quaternion();
const _northForward = new THREE.Vector3();
const _camLocal = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _groundEuler = new THREE.Euler(0, 0, 0, "YXZ");

function enuFromOrigin(originLat, originLng, lat, lng) {
  const R = 6378137;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat - originLat);
  const dLng = toRad(lng - originLng);
  const east = dLng * Math.cos(toRad(originLat)) * R;
  const north = dLat * R;
  return { x: east, y: 0, z: -north };
}

function offsetLatLng(lat, lng, eastM, northM) {
  const R = 6378137;
  const dLat = (northM / R) * (180 / Math.PI);
  const dLng =
    (eastM / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

function readGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      reject,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 4000 }
    );
  });
}

function setLocationUi() {
  /* Gate no longer shows a location chip. */
}

async function requestLocationAccess({ interactive = false } = {}) {
  if (!navigator.geolocation) {
    setLocationUi("denied", "This phone doesn’t support location.");
    return null;
  }

  setLocationUi(
    "pending",
    interactive
      ? "Allow location when your phone asks…"
      : "Checking location access…"
  );

  try {
    const geo = await readGps();
    state.userGeo = geo;
    state.originGeo = state.originGeo || { ...geo };
    if (state.viewFollowsUser) state.viewGeo = { lat: geo.lat, lng: geo.lng };
    startGeoWatch();
    updateRadarMapBackground();
    anchorDemoVideosToLaunch();
    updateGeoAnchors();
    syncLocateButtons();
    setLocationUi("ready");
    return geo;
  } catch (err) {
    console.warn(err);
    const denied =
      err && (err.code === 1 || /denied/i.test(String(err.message || "")));
    setLocationUi(
      "denied",
      denied
        ? "Location is blocked. Enable it in Settings, then tap Try again."
        : "Couldn’t get location yet. Tap Enable location to allow access."
    );
    return null;
  }
}

async function initLocationOnLoad() {
  // Ask as soon as the app opens (HTTPS / GitHub Pages).
  // If the browser requires a tap, the Enable location button is ready.
  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "granted") {
        await requestLocationAccess({ interactive: false });
        return;
      }
      if (status.state === "denied") {
        setLocationUi(
          "denied",
          "Location is blocked. Enable it for this site in your phone settings."
        );
        return;
      }
    } catch {
      // Safari may not support permissions.query for geolocation
    }
  }

  setLocationUi(
    "ask",
    "Turn on location to pin clips."
  );
  // Attempt immediately on load; many mobile browsers will show the system prompt.
  await requestLocationAccess({ interactive: false });
}

initLocationOnLoad();

function startGeoWatch() {
  if (!navigator.geolocation || state.geoWatchId != null) return;
  state.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      state.userGeo = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      if (!state.originGeo) state.originGeo = { ...state.userGeo };
      if (state.viewFollowsUser) {
        state.viewGeo = {
          lat: state.userGeo.lat,
          lng: state.userGeo.lng,
        };
      }
      updateRadarMapBackground();
      anchorDemoVideosToLaunch();
      updateGeoAnchors();
      syncLocateButtons();
    },
    (err) => console.warn(err),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

function gpsOrigin() {
  return state.userGeo || state.originGeo;
}

function viewOrigin() {
  return state.viewGeo || gpsOrigin();
}

function radarZoomForNearby() {
  const origin = viewOrigin();
  if (!origin) return 15;
  const nearby = closestGeoNodes(RADAR_DOT_COUNT);
  if (!nearby.length) return 16;
  const farthest = Math.max(
    ...nearby.map((n) =>
      distanceMeters(origin.lat, origin.lng, n.lat, n.lng)
    )
  );
  if (farthest < 250) return 16;
  if (farthest < 900) return 15;
  if (farthest < 3000) return 14;
  if (farthest < 10000) return 13;
  return 12;
}

/** Light street-map tile behind the camera radar, centered on the user. */
function latLngToTile(lat, lng, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y, z: zoom };
}

function updateRadarMapBackground() {
  if (!radar || state.cameraLayout === "carousel") return;
  const geo = viewOrigin();
  if (!geo) return;
  const zoom = radarZoomForNearby();
  const key = `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)},${zoom}`;
  if (radar.dataset.mapKey === key) return;
  radar.dataset.mapKey = key;
  const { x, y, z } = latLngToTile(geo.lat, geo.lng, zoom);
  // Match the Nearby map: light OSM street tiles
  radar.style.backgroundImage = `url("https://tile.openstreetmap.org/${z}/${x}/${y}.png")`;
}

/** Place sample clips around wherever this user opened the site. */
function anchorDemoVideosToLaunch() {
  const origin = state.originGeo;
  if (!origin || !state.nodes.length) return;

  for (const node of state.nodes) {
    if (!node.demo) continue;
    const east = node.anchorX ?? node.position?.[0] ?? 0;
    const north = -(node.anchorZ ?? node.position?.[2] ?? 0);
    const ll = offsetLatLng(origin.lat, origin.lng, east, north);
    node.lat = ll.lat;
    node.lng = ll.lng;
  }
  state.demoGeoReady = true;
  if (state.mapOpen) {
    refreshMapList();
    syncLeafletMarkers();
  }
}

function aimMetersOnGround(distance = 3.5) {
  const forward = getLookForwardFlat();
  forward.multiplyScalar(distance);
  return { east: forward.x, north: -forward.z };
}

/** Unsmoothed look direction on the ground plane (matches what the user is aiming). */
function getLookForwardFlat() {
  // Snap rig so placement isn't behind a slerp lag
  if (camera) updateCameraRig(1);

  const q = new THREE.Quaternion();
  if (state.orientReady) {
    _offsetQuat.setFromEuler(
      new THREE.Euler(state.offsetPitch, state.offsetYaw, 0, "YXZ")
    );
    q.copy(_deviceQuat).multiply(_offsetQuat);
  } else if (camera) {
    q.copy(camera.quaternion);
  } else {
    return new THREE.Vector3(0, 0, -1);
  }

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
  forward.normalize();
  return forward;
}

function placementAlongLook(distance = 3.2, y = 1.4) {
  const forward = getLookForwardFlat();
  const origin = camera ? camera.position : new THREE.Vector3(0, 1.4, 0);
  return [
    origin.x + forward.x * distance,
    y,
    origin.z + forward.z * distance,
  ];
}

function snapRangeFt(ft) {
  if (ft >= FEET_PER_MILE) {
    const miles = Math.round((ft / FEET_PER_MILE) * 10) / 10;
    return THREE.MathUtils.clamp(miles, 1, 10) * FEET_PER_MILE;
  }
  if (ft >= 1000) return Math.round(ft / 100) * 100;
  if (ft >= 200) return Math.round(ft / 50) * 50;
  return Math.round(ft / 25) * 25;
}

function clampCameraRangeFt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return CAMERA_RANGE_DEFAULT_FT;
  return THREE.MathUtils.clamp(
    snapRangeFt(n),
    CAMERA_RANGE_MIN_FT,
    CAMERA_RANGE_MAX_FT
  );
}

function sliderPosFromFt(ft) {
  const min = Math.log(CAMERA_RANGE_MIN_FT);
  const max = Math.log(CAMERA_RANGE_MAX_FT);
  const t = (Math.log(Math.max(ft, CAMERA_RANGE_MIN_FT)) - min) / (max - min);
  return Math.round(THREE.MathUtils.clamp(t, 0, 1) * CAMERA_RANGE_SLIDER_MAX);
}

function ftFromSliderPos(pos) {
  const t = THREE.MathUtils.clamp(Number(pos) / CAMERA_RANGE_SLIDER_MAX, 0, 1);
  const min = Math.log(CAMERA_RANGE_MIN_FT);
  const max = Math.log(CAMERA_RANGE_MAX_FT);
  return clampCameraRangeFt(Math.exp(min + t * (max - min)));
}

function loadCameraRangeFt() {
  try {
    const raw = localStorage.getItem("lumen-camera-range-ft");
    if (raw != null && raw !== "") return clampCameraRangeFt(raw);
  } catch {
    /* private browsing */
  }
  return CAMERA_RANGE_DEFAULT_FT;
}

function geoRangeM() {
  return state.cameraRangeFt * 0.3048;
}

function formatRangeFt(ft) {
  if (ft >= FEET_PER_MILE) {
    const miles = Math.round((ft / FEET_PER_MILE) * 10) / 10;
    const label = miles === 1 ? "mile" : "miles";
    return `${miles} ${label}`;
  }
  return `${Number(ft).toLocaleString("en-US")} ft`;
}

function syncRangeControls() {
  const ft = state.cameraRangeFt;
  const label = formatRangeFt(ft);
  if (rangeSheetValue) rangeSheetValue.textContent = label;
  if (rangeSlider) rangeSlider.value = String(sliderPosFromFt(ft));
}

function setCameraRangeFt(value, { persist = true } = {}) {
  state.cameraRangeFt = clampCameraRangeFt(value);
  syncRangeControls();
  if (persist) {
    try {
      localStorage.setItem("lumen-camera-range-ft", String(state.cameraRangeFt));
    } catch {
      /* ignore */
    }
  }
  updateGeoAnchors();
}

function openSettingsModal() {
  if (!settingsModal) return;
  if (state.watching || state.naming) return;
  closeAddModal();
  closeCreateModal(true);
  state.settingsOpen = true;
  settingsModal.hidden = false;
  settingsBtn?.setAttribute("aria-expanded", "true");
}

function closeSettingsModal() {
  state.settingsOpen = false;
  if (settingsModal) settingsModal.hidden = true;
  settingsBtn?.setAttribute("aria-expanded", "false");
}

function closeFilterSheets() {
  closeSettingsModal();
}

function clampTimeYr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(THREE.MathUtils.clamp(n, 0, TIME_RANGE_MAX_YR));
}

function loadTimeRange() {
  let min = 0;
  let max = TIME_RANGE_MAX_YR;
  try {
    const rawMin = localStorage.getItem("lumen-time-min-yr");
    const rawMax = localStorage.getItem("lumen-time-max-yr");
    if (rawMin != null && rawMin !== "") min = clampTimeYr(rawMin);
    if (rawMax != null && rawMax !== "") max = clampTimeYr(rawMax);
  } catch {
    /* private browsing */
  }
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

function formatTimeRange(min, max) {
  if (min <= 0 && max >= TIME_RANGE_MAX_YR) return "Any year";
  if (min <= 0 && max <= 0) return "This year";
  if (min <= 0) return `Within ${max} ${max === 1 ? "year" : "years"}`;
  if (max >= TIME_RANGE_MAX_YR) return `${min}+ years ago`;
  if (min === max) return `${min} ${min === 1 ? "year" : "years"} ago`;
  return `${min}–${max} years ago`;
}

function nodeYearsAgo(node) {
  if (!node?.takenAt) return null;
  const t = new Date(node.takenAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / MS_PER_YEAR);
}

function nodeInTimeRange(node) {
  const years = nodeYearsAgo(node);
  if (years == null) return true;
  const age = Math.floor(years);
  if (age < state.timeMinYr) return false;
  if (state.timeMaxYr >= TIME_RANGE_MAX_YR) return true;
  return age <= state.timeMaxYr;
}

function syncTimeFill() {
  if (!timeFill) return;
  const span = TIME_RANGE_MAX_YR || 1;
  const left = (state.timeMinYr / span) * 100;
  const width = ((state.timeMaxYr - state.timeMinYr) / span) * 100;
  timeFill.style.left = `${left}%`;
  timeFill.style.width = `${Math.max(width, 0)}%`;
}

function syncTimeControls() {
  const label = formatTimeRange(state.timeMinYr, state.timeMaxYr);
  if (timeSheetValue) timeSheetValue.textContent = label;
  if (timeMinSlider) timeMinSlider.value = String(state.timeMinYr);
  if (timeMaxSlider) timeMaxSlider.value = String(state.timeMaxYr);
  syncTimeFill();
}

function setTimeRange(minYr, maxYr, { persist = true } = {}) {
  let min = clampTimeYr(minYr);
  let max = clampTimeYr(maxYr);
  if (min > max) [min, max] = [max, min];
  state.timeMinYr = min;
  state.timeMaxYr = max;
  syncTimeControls();
  if (persist) {
    try {
      localStorage.setItem("lumen-time-min-yr", String(min));
      localStorage.setItem("lumen-time-max-yr", String(max));
    } catch {
      /* ignore */
    }
  }
  updateGeoAnchors();
}

function loadCameraLayout() {
  try {
    const raw = localStorage.getItem("lumen-camera-layout");
    if (raw === "place") return "place";
  } catch {
    /* private browsing */
  }
  return "carousel";
}

function syncLayoutControls() {
  const carousel = state.cameraLayout === "carousel";
  layoutPlaceBtn?.classList.toggle("is-on", !carousel);
  layoutCarouselBtn?.classList.toggle("is-on", carousel);
  layoutPlaceBtn?.setAttribute("aria-pressed", String(!carousel));
  layoutCarouselBtn?.setAttribute("aria-pressed", String(carousel));
  field?.classList.toggle("is-carousel", carousel);
}

function captureCarouselHeading() {
  const f = getLookForwardFlat();
  state.carouselFwdX = f.x;
  state.carouselFwdZ = f.z;
}

/** Put the current town's carousel in front of wherever the phone is aimed. */
function centerCarouselInView() {
  if (state.cameraLayout !== "carousel") return;
  captureCarouselHeading();
  state.carouselDragY = 0;
  state.carouselTiltT = 0;
  state.carouselPitchBaseline = null;
  state.carouselLookPitch = 0;
}

function applyLayoutFov() {
  if (!camera) return;
  const aspect =
    camera.aspect ||
    (window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 0.5);
  if (state.cameraLayout === "carousel") {
    if (!state.fovPinched) {
      const hFov =
        state.videoSize === "small" ? CAROUSEL_HFOV_SMALL : CAROUSEL_HFOV;
      const h = THREE.MathUtils.degToRad(hFov);
      camera.fov = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(h * 0.5) / Math.max(0.2, aspect))
      );
    }
    camera.fov = THREE.MathUtils.clamp(camera.fov, LOOK_FOV_MIN, CAROUSEL_FOV_MAX);
  } else {
    if (!state.fovPinched) camera.fov = LOOK_FOV_DEFAULT;
    camera.fov = THREE.MathUtils.clamp(camera.fov, LOOK_FOV_MIN, LOOK_FOV_MAX);
  }
  camera.updateProjectionMatrix();
}

function setCameraLayout(mode, { persist = true } = {}) {
  const next = mode === "carousel" ? "carousel" : "place";
  const changed = state.cameraLayout !== next;
  state.cameraLayout = next;
  if (next === "place") {
    state.carouselFwdX = null;
    state.carouselFwdZ = null;
    hideCarouselYearMarks();
  } else if (changed || state.carouselFwdX == null) {
    captureCarouselHeading();
    guide?.classList.remove("is-on");
    state.carouselPitchBaseline = null;
  }
  if (changed) state.fovPinched = false;
  applyLayoutFov();
  syncLayoutControls();
  if (persist) {
    try {
      localStorage.setItem("lumen-camera-layout", next);
    } catch {
      /* ignore */
    }
  }
  updateGeoAnchors();
  for (const node of state.nodes) refreshNodeChrome(node);
}

function loadVideoSize() {
  try {
    const raw = localStorage.getItem("lumen-video-size");
    if (raw === "large") return "large";
    if (raw === "small") return "small";
  } catch {
    /* private browsing */
  }
  return "small";
}

function syncVideoSizeControls() {
  const small = state.videoSize === "small";
  videoSizeLargeBtn?.classList.toggle("is-on", !small);
  videoSizeSmallBtn?.classList.toggle("is-on", small);
  videoSizeLargeBtn?.setAttribute("aria-pressed", String(!small));
  videoSizeSmallBtn?.setAttribute("aria-pressed", String(small));
}

function setVideoSize(size, { persist = true } = {}) {
  const next = size === "small" ? "small" : "large";
  const changed = state.videoSize !== next;
  state.videoSize = next;
  if (changed) {
    state.fovPinched = false;
    if (next === "large") {
      state.offsetPitch = 0;
      state.carouselTiltT = 0;
      state.carouselDragY = 0;
    }
  }
  applyLayoutFov();
  syncVideoSizeControls();
  if (persist) {
    try {
      localStorage.setItem("lumen-video-size", next);
    } catch {
      /* ignore */
    }
  }
  updateGeoAnchors();
}

function loadShowCreate() {
  try {
    return localStorage.getItem("lumen-show-create") === "1";
  } catch {
    return false;
  }
}

function syncShowCreateControls() {
  const on = Boolean(state.showCreate);
  createSettingOnBtn?.classList.toggle("is-on", on);
  createSettingOffBtn?.classList.toggle("is-on", !on);
  createSettingOnBtn?.setAttribute("aria-pressed", String(on));
  createSettingOffBtn?.setAttribute("aria-pressed", String(!on));
  if (addCreate) addCreate.hidden = !on;
}

function setShowCreate(on, { persist = true } = {}) {
  state.showCreate = Boolean(on);
  if (!state.showCreate) closeCreateModal(true);
  syncShowCreateControls();
  if (persist) {
    try {
      localStorage.setItem("lumen-show-create", state.showCreate ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

function carouselScale() {
  return state.videoSize === "small" ? CAROUSEL_SCALE_SMALL : CAROUSEL_SCALE;
}

function carouselIsTwoRow() {
  return state.cameraLayout === "carousel" && state.videoSize === "small";
}

function carouselNodeHeight(node) {
  return layoutSizeWithGrow(
    (node.screen?.geometry?.parameters?.height || 1.35) * carouselScale(),
    node?.playGrow
  );
}

function carouselPairColumns(nodes) {
  const cols = [];
  for (let i = 0; i < nodes.length; i += 2) {
    cols.push(nodes.slice(i, i + 2));
  }
  return cols;
}

/** Birds, planes, and other airborne subjects sit in the sky instead of on the ground. */
function isFlyingSubject(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  return /\b(bird|birds|eagle|eagles|hawk|hawks|owl|owls|parrot|parrots|crow|crows|raven|ravens|sparrow|sparrows|pigeon|pigeons|dove|doves|seagull|seagulls|gull|gulls|albatross|hummingbird|hummingbirds|falcon|falcons|vulture|vultures|swan|swans|duck|ducks|goose|geese|heron|stork|pelican|toucan|macaw|canary|finch|robin|bluejay|cardinal|woodpecker|flamingo|peacock|condor|kite|kites|plane|planes|airplane|airplanes|aeroplane|aeroplanes|jet|jets|airliner|helicopter|helicopters|chopper|drone|drones|quadcopter|ufo|ufos|spaceship|spacecraft|rocket|rockets|butterfly|butterflies|moth|moths|dragonfly|dragonflies|bee|bees|wasp|wasps|hornet|hornets|fly|flies|firefly|bat|bats|pterodactyl|pteranodon|dragon|dragons|phoenix|griffin|griffon|pegasus|angel|angels|fairy|fairies|pixie|blimp|zeppelin|glider|paraglider|airship|seaplane|biplane|warplane|hot[- ]?air[- ]?balloon|hang[- ]?glider|superhero|superman|witch|hovering|soaring|flying|in flight|in the (air|sky)|with wings)\b/.test(
    t
  );
}

function syncCreationStand(node) {
  if (!node || node.kind !== "image" || !node.screen?.geometry) return;
  const h = node.screen.geometry.parameters?.height || 1.35;
  if (node.flying) {
    node.restY = 2.55 + Math.min(0.75, h * 0.2);
    node.baseY = node.restY;
    node.velY = 0;
    node.settled = true;
  } else {
    node.restY = h * 0.5 + 0.02;
    if (node.settled) node.baseY = node.restY;
  }
  if (node.beacon) node.beacon.visible = false;
}

/** Fan clips that share a GPS point into a left-to-right row in camera view. */
function spreadCoincidentPins() {
  if (state.cameraLayout === "carousel") {
    layoutCameraCarousel();
    return;
  }

  for (const node of state.nodes) {
    if (node.geoX == null) node.geoX = node.anchorX;
    if (node.geoZ == null) node.geoZ = node.anchorZ;
    node.spreadX = 0;
    node.spreadZ = 0;
  }

  const visible = state.nodes.filter(
    (n) =>
      n.geoX != null &&
      n.geoZ != null &&
      n.group &&
      n.inRange !== false &&
      n.group.visible !== false
  );

  const assigned = new Set();
  for (const node of visible) {
    if (assigned.has(node.id)) continue;
    const group = [node];
    assigned.add(node.id);
    for (const other of visible) {
      if (assigned.has(other.id)) continue;
      const d = Math.hypot(other.geoX - node.geoX, other.geoZ - node.geoZ);
      if (d <= CAMERA_STACK_M) {
        group.push(other);
        assigned.add(other.id);
      }
    }
    if (group.length < 2) continue;
    group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const cx = group.reduce((s, n) => s + n.geoX, 0) / group.length;
    const cz = group.reduce((s, n) => s + n.geoZ, 0) / group.length;
    let px = -cz;
    let pz = cx;
    const plen = Math.hypot(px, pz);
    if (plen < 0.4) {
      px = 1;
      pz = 0;
    } else {
      px /= plen;
      pz /= plen;
    }
    const mid = (group.length - 1) / 2;
    group.forEach((n, i) => {
      const t = (i - mid) * CAMERA_SPREAD_M;
      n.spreadX = px * t;
      n.spreadZ = pz * t;
    });
  }

  for (const node of state.nodes) {
    if (node.geoX == null || node.geoZ == null) continue;
    node.anchorX = node.geoX + (node.spreadX || 0);
    node.anchorZ = node.geoZ + (node.spreadZ || 0);
  }
}

/** Ring in-range clips around the camera, oldest left of heading, newer right. */
function layoutCameraCarousel() {
  let nearby = viewClipNodes().filter((n) => n.group);
  if (!nearby.length) {
    nearby = state.nodes.filter((n) => n.group && n.inRange !== false);
  }
  nearby.sort((a, b) => {
    const ta = nodeTakenMs(a);
    const tb = nodeTakenMs(b);
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  const inRow = new Set(nearby.map((n) => n.id));
  for (const node of state.nodes) {
    if (!node.group) continue;
    node.group.visible = node.inRange !== false && inRow.has(node.id);
  }
  if (!nearby.length) {
    hideCarouselYearMarks();
    return;
  }

  const { fx, fz, rx, rz } = carouselRingVectors();
  const originX = camera ? camera.position.x : 0;
  const originZ = camera ? camera.position.z : 0;
  const twoRow = carouselIsTwoRow();
  const columns = twoRow
    ? carouselPairColumns(nearby)
    : nearby.map((node) => [node]);
  const widths = columns.map((col) =>
    Math.max(...col.map((node) => carouselNodeWidth(node)))
  );
  const { radius, angles } = carouselRingLayout(
    widths,
    CAROUSEL_DIST_M,
    CAROUSEL_GAP_M
  );

  columns.forEach((col, i) => {
    const p = pointOnCarouselRing(
      angles[i],
      radius,
      originX,
      originZ,
      fx,
      fz,
      rx,
      rz
    );
    const bottom = col[0];
    const top = col[1];
    const hb = carouselNodeHeight(bottom);
    bottom.anchorX = p.x;
    bottom.anchorZ = p.z;
    bottom.anchorY = CAROUSEL_FLOOR_Y + hb * 0.5;
    if (top) {
      const ht = carouselNodeHeight(top);
      top.anchorX = p.x;
      top.anchorZ = p.z;
      top.anchorY = CAROUSEL_FLOOR_Y + hb + CAROUSEL_ROW_GAP_M + ht * 0.5;
    }
  });

  let stackBottom = Infinity;
  let stackTop = -Infinity;
  for (const col of columns) {
    for (const node of col) {
      const h = carouselNodeHeight(node);
      stackBottom = Math.min(stackBottom, node.anchorY - h * 0.5);
      stackTop = Math.max(stackTop, node.anchorY + h * 0.5);
    }
  }

  const viewH = stickyViewSize(
    state.carouselViewH,
    renderer?.domElement?.clientHeight || window.innerHeight || 1
  );
  state.carouselViewH = viewH;
  const hudEl = document.querySelector(".hud-top");
  const { topPx, botPx } = carouselHudBandPx(
    hudEl?.getBoundingClientRect?.().bottom,
    viewH,
    viewH
  );
  const camY = camera?.position.y ?? 1.4;
  const fov = camera?.fov ?? LOOK_FOV_DEFAULT;
  const bandTop = screenYToWorldY(topPx, viewH, camY, radius, fov);
  const bandBottom = screenYToWorldY(botPx, viewH, camY, radius, fov);
  let travelBottom = stackBottom;
  const focused = state.focused;
  if (focused?.group && columns.some((col) => col.includes(focused))) {
    const fh = carouselNodeHeight(focused);
    travelBottom = focused.anchorY - fh * 0.5;
  }
  const restShift = -CAROUSEL_DROP_Y;
  const highShift = bandTop - stackTop;
  const lowShift = bandBottom - travelBottom;
  const targetT = carouselTiltTravel(
    state.carouselLookPitch,
    CAROUSEL_TILT_SPAN,
    CAROUSEL_TILT_GAIN
  );
  state.carouselTiltT += (targetT - state.carouselTiltT) * 0.22;
  const tiltShift = carouselTravelShiftY(
    state.carouselTiltT,
    restShift,
    highShift,
    lowShift
  );
  let shiftY = clampShiftToBand(
    tiltShift + state.carouselDragY,
    travelBottom,
    stackTop,
    bandBottom,
    bandTop
  );
  state.carouselDragY = shiftY - tiltShift;
  for (const col of columns) {
    for (const node of col) node.anchorY += shiftY;
  }

  const yearNodes = [];
  const yearAngles = [];
  columns.forEach((col, i) => {
    for (const node of col) {
      yearNodes.push(node);
      yearAngles.push(angles[i]);
    }
  });
  syncCarouselYearMarks(
    yearNodes,
    yearAngles,
    radius,
    originX,
    originZ,
    fx,
    fz,
    rx,
    rz,
    stackBottom + shiftY
  );
}

function carouselNodeWidth(node) {
  const scale = carouselScale();
  const sw = (node.screen?.geometry?.parameters?.width || 1.65) * scale;
  const fw =
    node.kind === "video"
      ? (node.frame?.geometry?.parameters?.width || sw / scale + 0.14) *
        scale
      : 0;
  return layoutSizeWithGrow(Math.max(sw, fw, 1.15 * scale), node?.playGrow);
}

function carouselRingVectors() {
  if (state.carouselFwdX == null || state.carouselFwdZ == null) {
    captureCarouselHeading();
  }
  let fx = state.carouselFwdX;
  let fz = state.carouselFwdZ;
  const flen = Math.hypot(fx, fz);
  if (flen < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= flen;
    fz /= flen;
  }
  return { fx, fz, rx: -fz, rz: fx };
}

function carouselChordAngle(width, radius) {
  const half = Math.max(0, width) * 0.5;
  if (radius <= half + 1e-4) return Math.PI;
  // Visual half-width of a facing plane, so neighbors stay off its silhouette.
  return 2 * Math.atan(half / radius);
}

/** Pack clip widths onto a circle around the viewer, centered on heading.
 *  Leftover arc stays empty behind you so neighbors stay almost touching. */
function carouselRingLayout(widths, distM = CAROUSEL_DIST_M, gapM = CAROUSEL_GAP_M) {
  const n = widths.length;
  if (!n) return { radius: distM, angles: [] };

  const packed = widths.map((w) => Math.max(0.4, w * CAROUSEL_PACK));
  let radius = Math.max(0.5, distM, Math.max(...packed) * 0.55);
  let itemAng = [];
  let gapAng = 0;
  let needed = 0;
  let wrap = false;
  for (let i = 0; i < 16; i += 1) {
    itemAng = packed.map((w) => carouselChordAngle(w, radius));
    gapAng = gapM / radius;
    const closed = itemAng.reduce((s, a) => s + a, 0) + n * gapAng;
    wrap = closed > Math.PI * 2 + 1e-6;
    needed = wrap
      ? closed
      : itemAng.reduce((s, a) => s + a, 0) + Math.max(0, n - 1) * gapAng;
    if (needed <= Math.PI * 2 + 1e-6) break;
    radius *= needed / (Math.PI * 2);
  }

  const angles = [];
  let cursor = 0;
  for (let i = 0; i < n; i += 1) {
    cursor += itemAng[i] * 0.5;
    angles.push(cursor);
    cursor += itemAng[i] * 0.5;
    if (i < n - 1 || wrap) cursor += gapAng;
  }
  const mid = (angles[0] + angles[n - 1]) * 0.5;
  for (let i = 0; i < n; i += 1) angles[i] -= mid;
  return { radius, angles };
}

function pointOnCarouselRing(alpha, radius, originX, originZ, fx, fz, rx, rz) {
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  return {
    x: originX + (fx * ca + rx * sa) * radius,
    z: originZ + (fz * ca + rz * sa) * radius,
  };
}

function yawTowardOrigin(x, z, originX, originZ) {
  const dx = originX - x;
  const dz = originZ - z;
  return dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : 0;
}

/** Midpoint traveling forward along the ring from angle a to b. */
function carouselForwardMidAngle(a, b) {
  let d = b - a;
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return a + d * 0.5;
}

function nodeTakenYear(node) {
  if (!node?.takenAt) return null;
  const d = new Date(node.takenAt);
  const y = d.getFullYear();
  return Number.isFinite(y) && y > 1900 && y < 2100 ? y : null;
}

function createYearMarkTexture(year) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 92px Inter, sans-serif";
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillText(String(year), 258, 84);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(year), 256, 80);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ensureCarouselYearMark() {
  if (!scene) return null;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 0.42),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  mesh.renderOrder = 26;
  mesh.visible = false;
  scene.add(mesh);
  state.carouselYearMarks.push(mesh);
  return mesh;
}

function hideCarouselYearMarks() {
  for (const mark of state.carouselYearMarks) mark.visible = false;
}

function syncCarouselYearMarks(
  nearby,
  angles,
  radius,
  originX,
  originZ,
  fx,
  fz,
  rx,
  rz,
  stackBottomY = 0
) {
  if (state.cameraLayout !== "carousel" || !scene) {
    hideCarouselYearMarks();
    return;
  }

  const groups = carouselYearGroups(nearby.map((node) => nodeTakenYear(node)));

  while (state.carouselYearMarks.length < groups.length) ensureCarouselYearMark();

  const markR = carouselYearMarkRadius(radius);
  const rawAlphas = groups.map((group) => {
    const a0 = angles[group.indices[0]];
    const a1 = angles[group.indices[group.indices.length - 1]];
    if (!Number.isFinite(a0)) return 0;
    if (!Number.isFinite(a1) || a0 === a1) return a0;
    return (a0 + a1) * 0.5;
  });
  const spaced = spreadYearMarkAngles(
    rawAlphas,
    carouselYearMarkMinAngle(markR)
  );

  state.carouselYearMarks.forEach((mark, i) => {
    const group = groups[i];
    if (!group) {
      mark.visible = false;
      return;
    }
    const p = pointOnCarouselRing(
      spaced[i] ?? 0,
      markR,
      originX,
      originZ,
      fx,
      fz,
      rx,
      rz
    );
    mark.position.set(p.x, carouselYearMarkY(stackBottomY), p.z);
    mark.scale.setScalar(1.7);
    _groundEuler.set(0, yawTowardOrigin(p.x, p.z, originX, originZ), 0, "YXZ");
    mark.quaternion.setFromEuler(_groundEuler);
    if (mark.userData.year !== group.year) {
      const prev = mark.material.map;
      mark.material.map = createYearMarkTexture(group.year);
      mark.material.needsUpdate = true;
      mark.userData.year = group.year;
      prev?.dispose?.();
    }
    mark.visible = true;
  });
}

function nodeTakenMs(node) {
  if (!node?.takenAt) return Number.POSITIVE_INFINITY;
  const t = new Date(node.takenAt).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function allGeoNodes() {
  const origin = viewOrigin();
  const geo = state.nodes.filter(
    (n) => n.lat != null && n.lng != null && nodeInTimeRange(n)
  );
  if (!geo.length) return [];
  if (!origin) return geo;
  return geo
    .map((n) => ({
      n,
      d: distanceMeters(origin.lat, origin.lng, n.lat, n.lng),
    }))
    .sort((a, b) => a.d - b.d)
    .map(({ n }) => n);
}

function closestGeoNodes(limit) {
  return allGeoNodes().slice(0, limit);
}

function viewClipNodes() {
  const geo = allGeoNodes();
  const town = formatTownName(state.selectedTown);
  if (!town || town === FALLBACK_TOWN) return geo.slice(0, VIEW_CLIP_COUNT);
  return geo.filter((n) => nodeTown(n) === town);
}

function syncRadarDots() {
  const keep = new Set(viewClipNodes().slice(0, RADAR_DOT_COUNT).map((n) => n.id));
  for (const node of state.nodes) {
    if (!node.radar) continue;
    node.radar.style.display = keep.has(node.id) ? "" : "none";
  }
}

function radarSpanM() {
  const origin = viewOrigin();
  const closest = viewClipNodes().slice(0, RADAR_DOT_COUNT);
  if (!closest.length) return 40;
  let farthest = 25;
  for (const n of closest) {
    const d =
      n.distanceM ??
      (origin ? distanceMeters(origin.lat, origin.lng, n.lat, n.lng) : 25);
    if (d > farthest) farthest = d;
  }
  return farthest;
}

function updateGeoAnchors() {
  const origin = viewOrigin();
  ensureTownPlaces();
  if (!origin) {
    spreadCoincidentPins();
    syncRadarDots();
    updateRadarMapBackground();
    syncTownDropdown();
    return;
  }

  const nearbyIds = new Set(viewClipNodes().map((n) => n.id));

  for (const node of state.nodes) {
    if (node.lat == null || node.lng == null) continue;

    const dist = distanceMeters(origin.lat, origin.lng, node.lat, node.lng);
    node.distanceM = dist;
    const inTime = nodeInTimeRange(node);
    const inRange = nearbyIds.has(node.id) && inTime;
    node.inRange = inRange;
    node.group.visible = inRange;

    // Place relative to the user so scene distance matches GPS range checks.
    // (Origin-relative ENU left nearby pins stranded far from the camera.)
    if (!node.worldLocked) {
      const enu = enuFromOrigin(origin.lat, origin.lng, node.lat, node.lng);
      node.geoX = enu.x;
      node.geoZ = enu.z;
    } else if (node.geoX == null || node.geoZ == null) {
      node.geoX = node.anchorX;
      node.geoZ = node.anchorZ;
    }

    const feet = Math.max(1, Math.round(dist * 3.28084));
    const taken = formatTakenLabel(node.takenAt);
    node.blurb = inRange
      ? taken
        ? `${feet} ft · ${taken}`
        : `${feet} ft · aim from any side`
      : !inTime
        ? taken
          ? `Outside time frame · ${taken}`
          : "Outside time frame"
        : `Outside this town (${feet} ft)`;
    if (!inRange && state.focused === node) setFocus(null);
  }

  spreadCoincidentPins();
  syncRadarDots();
  updateRadarMapBackground();
  syncTownDropdown();
}

function setAddMediaLoading(on) {
  state.mediaLoading = Boolean(on);
  if (addBtn) {
    addBtn.classList.toggle("is-loading", state.mediaLoading);
    addBtn.disabled = state.mediaLoading;
    addBtn.setAttribute(
      "aria-label",
      state.mediaLoading ? "Opening your videos" : "Add"
    );
    addBtn.title = state.mediaLoading ? "Opening your videos" : "Add";
  }
  if (fieldLoading) fieldLoading.hidden = !state.mediaLoading;
}

function nodePosterReady(node) {
  if (!node || node.kind === "image") return true;
  if (node.posterFailed) return true;
  if (!videoPosterSrc(node)) return true;
  return Boolean(node.posterTex);
}

function waitForNodePoster(node, ms = 10000) {
  if (nodePosterReady(node)) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (nodePosterReady(node) || Date.now() - started > ms) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function setStatus(message, ms = 2800) {
  if (!statusEl) return;
  const text = String(message || "").trim();
  if (!text) {
    statusEl.textContent = "";
    statusEl.classList.remove("is-on");
    clearTimeout(statusTimer);
    return;
  }
  statusEl.textContent = text;
  statusEl.classList.add("is-on");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove("is-on"), ms);
}

function showUploadOverlay(title, copy) {
  if (uploadOverlayTitle) uploadOverlayTitle.textContent = title || "Uploading";
  if (uploadOverlayCopy) uploadOverlayCopy.textContent = copy || "Sending your video…";
  if (uploadOverlay) uploadOverlay.hidden = false;
  if (addBtn) addBtn.disabled = true;
}

function hideUploadOverlay() {
  if (uploadOverlay) uploadOverlay.hidden = true;
  if (addBtn) addBtn.disabled = state.mediaLoading;
}

function syncLabelPlacement(node) {
  if (!node?.label) return;
  const h = node.screen?.geometry?.parameters?.height || 1.35;
  if (state.cameraLayout === "carousel") {
    node.label.visible = false;
    if (node.beacon) node.beacon.visible = false;
    return;
  }
  node.label.position.set(0, h * 0.5 + 0.55, 0.02);
  node.label.visible = node.kind !== "image";
  if (node.beacon) node.beacon.visible = node.kind !== "image";
}

function createLabelTexture(title, blurb, { reserveDelete = false, thumbs = 0, kind = "video" } = {}) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  roundRect(ctx, 24, 36, 976, 184, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 42px Inter, sans-serif";
  ctx.fillText(kind === "image" ? "LOOK" : "WATCH", 64, 110);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 64px Inter, sans-serif";
  // Leave room on the right for the HTML × when this is a deletable upload
  const titleMax = reserveDelete ? 18 : thumbs ? 22 : 28;
  ctx.fillText(title.slice(0, titleMax), 64, 175);
  ctx.font = "500 34px Inter, sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillText(blurb.slice(0, reserveDelete ? 28 : 40), 260, 110);
  if (thumbs > 0) {
    ctx.font = "800 72px Inter, Apple Color Emoji, Segoe UI Emoji, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(thumbs > 1 ? `👍${thumbs}` : "👍", 960, 155);
    ctx.textAlign = "left";
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createThumbsBadgeTexture(count) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  roundRect(ctx, 24, 24, 208, 208, 48);
  ctx.fill();
  ctx.font = "160px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("👍", 128, 118);
  if (count > 1) {
    ctx.font = "700 56px Inter, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(count), 128, 200);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function refreshNodeChrome(node) {
  if (!node?.label) return;
  if (state.cameraLayout === "carousel") {
    node.label.visible = false;
    syncLabelPlacement(node);
  } else {
    const old = node.label.material.map;
    node.label.material.map = createLabelTexture(node.title, node.blurb || "", {
      thumbs: node.thumbs || 0,
      kind: node.kind || "video",
    });
    node.label.material.needsUpdate = true;
    old?.dispose?.();
    node.label.visible = node.kind !== "image";
    syncLabelPlacement(node);
  }

  const count = node.thumbs || 0;
  if (count > 0) {
    if (!node.thumbsBadge) {
      const badge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.55),
        new THREE.MeshBasicMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
        })
      );
      badge.position.set(0.95, 0.55, 0.04);
      node.group.add(badge);
      node.thumbsBadge = badge;
    }
    const prev = node.thumbsBadge.material.map;
    node.thumbsBadge.material.map = createThumbsBadgeTexture(count);
    node.thumbsBadge.material.needsUpdate = true;
    node.thumbsBadge.visible = true;
    prev?.dispose?.();
    // Keep badge in the top-right of the current video plane
    const w = node.screen?.geometry?.parameters?.width || 2.4;
    const h = node.screen?.geometry?.parameters?.height || 1.35;
    node.thumbsBadge.position.set(w * 0.42, h * 0.38, 0.04);
  } else if (node.thumbsBadge) {
    node.thumbsBadge.visible = false;
  }
}

function showThumbsBurst() {
  if (!reactBurst) return;
  reactBurst.hidden = false;
  reactBurst.classList.remove("is-on");
  // Retrigger CSS animation
  void reactBurst.offsetWidth;
  reactBurst.classList.add("is-on");
  clearTimeout(showThumbsBurst._t);
  showThumbsBurst._t = setTimeout(() => {
    reactBurst.classList.remove("is-on");
    reactBurst.hidden = true;
  }, 1100);
}

function addThumbsUp(node) {
  if (!node) return;
  node.thumbs = (node.thumbs || 0) + 1;
  refreshNodeChrome(node);
  showThumbsBurst();
  if (state.focused === node) {
    focusLabel.textContent = `${node.title} 👍`;
  }
  setStatus(`👍 on “${node.title}”`);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeVideoElement(src) {
  const video = document.createElement("video");
  video.src = src;
  // Blob/object URLs break if crossOrigin is forced
  if (!src.startsWith("blob:") && !src.startsWith("file:")) {
    video.crossOrigin = "anonymous";
  }
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  return video;
}

function nextRingPosition(index) {
  const radius = 3.6 + Math.floor(index / 8) * 1.15;
  const angle = (index * 2.399) % (Math.PI * 2); // golden-angle spread
  const y = 1.25 + (index % 3) * 0.18;
  return [Math.sin(angle) * radius, y, -Math.cos(angle) * radius];
}

/** Place along the current camera aim — where the phone is pointed when adding. */
function placementFromAim(spreadIndex = 0, spreadCount = 1) {
  if (!camera) return nextRingPosition(spreadIndex);

  camera.getWorldDirection(_forward);
  if (_forward.lengthSq() < 0.0001) _forward.set(0, 0, -1);

  _right.crossVectors(_forward, _worldUp);
  if (_right.lengthSq() < 0.0001) {
    _right.set(1, 0, 0);
  } else {
    _right.normalize();
  }

  const distance = 3.8;
  const spread = (spreadIndex - (spreadCount - 1) / 2) * 1.35;
  _place
    .copy(camera.position)
    .addScaledVector(_forward, distance)
    .addScaledVector(_right, spread);

  // Keep screens near eye height if the user is aiming almost flat
  if (Math.abs(_forward.y) < 0.35) {
    _place.y = camera.position.y + spreadIndex * 0.05;
  }

  return [_place.x, _place.y, _place.z];
}

function applyMediaAspect(node, width, height) {
  if (!node?.screen || !width || !height) return;
  const aspect = width / height;
  // Keep videos compact so a close pin does not fill the whole camera
  const base = node.kind === "image" ? 2.1 : 1.65;
  const finalW = aspect >= 1 ? base : base * aspect;
  const finalH = finalW / aspect;

  node.screen.geometry.dispose();
  node.screen.geometry = new THREE.PlaneGeometry(finalW, finalH);
  node.frame.geometry.dispose();
  node.frame.geometry = new THREE.PlaneGeometry(finalW + 0.14, finalH + 0.14);
  if (node.backing) {
    node.backing.geometry.dispose();
    node.backing.geometry = new THREE.PlaneGeometry(finalW + 0.14, finalH + 0.14);
  }
  syncLabelPlacement(node);
  node.beacon.position.set(0, -finalH * 0.5 - 0.35, 0.05);
  node.screen.position.y = 0;
  node.frame.position.y = 0;
  if (node.thumbsBadge) {
    node.thumbsBadge.position.set(finalW * 0.42, finalH * 0.38, 0.04);
  }
  syncCreationStand(node);
}

function applyVideoAspect(node) {
  const w = node.video?.videoWidth || 0;
  const h = node.video?.videoHeight || 0;
  if (w > 1 && h > 1) applyMediaAspect(node, w, h);
}

function makePlaceholderTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function videoPosterSrc(node) {
  if (node?.storagePath) return posterUrl(node.storagePath);
  if (node?.thumbUrl) return node.thumbUrl;
  return "";
}

function setNodeMap(node, tex) {
  if (!node?.screen?.material || !tex) return;
  node.texture = tex;
  if (node.screen.material.map !== tex) {
    node.screen.material.map = tex;
    node.screen.material.needsUpdate = true;
  }
  node.screen.material.transparent = node.kind === "image";
  node.screen.material.opacity = 1;
}

function ensureVideoCanvas(node) {
  if (node.videoCanvasTex) return node.videoCanvasTex;
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  node.videoCanvas = canvas;
  node.videoCtx = canvas.getContext("2d");
  node.videoCanvasTex = new THREE.CanvasTexture(canvas);
  node.videoCanvasTex.colorSpace = THREE.SRGBColorSpace;
  node.videoCanvasTex.minFilter = THREE.LinearFilter;
  node.videoCanvasTex.generateMipmaps = false;
  return node.videoCanvasTex;
}

/** Copy a decoded video frame so iOS WebGL does not show a black VideoTexture. */
function paintVideoFrame(node) {
  const video = node?.video;
  if (!videoHasPaintedFrame(video)) return false;
  const tex = ensureVideoCanvas(node);
  const canvas = node.videoCanvas;
  const ctx = node.videoCtx;
  if (!canvas || !ctx) return false;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  try {
    ctx.drawImage(video, 0, 0, w, h);
  } catch {
    return false;
  }
  tex.needsUpdate = true;
  setNodeMap(node, tex);
  return true;
}

function showLiveVideoTexture(node) {
  if (!node?.video) return;
  if (paintVideoFrame(node)) return;
  if (!node.videoTex) {
    node.videoTex = new THREE.VideoTexture(node.video);
    node.videoTex.colorSpace = THREE.SRGBColorSpace;
    node.videoTex.minFilter = THREE.LinearFilter;
    node.videoTex.generateMipmaps = false;
  }
  node.videoTex.needsUpdate = true;
  setNodeMap(node, node.videoTex);
}

function showPosterTexture(node) {
  if (node?.posterTex) setNodeMap(node, node.posterTex);
}

function applyPosterTexture(node, src) {
  if (!node || node.kind !== "video" || !src) return;
  if (node.posterSrc === src && node.posterTex) return;
  node.posterSrc = src;
  const img = new Image();
  if (!String(src).startsWith("blob:") && !String(src).startsWith("data:")) {
    img.crossOrigin = "anonymous";
  }
  img.onload = () => {
    if (node.posterSrc !== src) return;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w < 2 || h < 2) return;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const prev = node.posterTex;
    node.posterTex = tex;
    if (!node.previewing) setNodeMap(node, tex);
    if (prev && prev !== tex && prev !== node.videoTex) prev.dispose();
    applyMediaAspect(node, w, h);
  };
  img.onerror = () => {
    if (node.posterSrc === src) {
      node.posterSrc = "";
      node.posterFailed = true;
    }
  };
  img.src = src;
}

function createNode(item, index) {
  const group = new THREE.Group();
  group.position.set(...item.position);
  const kind = item.kind === "image" ? "image" : "video";

  let video = null;
  let texture;
  let pendingImage = null;
  let animCanvas = null;
  let animCtx = null;
  const animFrames = Array.isArray(item.animFrames) ? item.animFrames.slice() : [];

  if (kind === "image") {
    animCanvas = document.createElement("canvas");
    animCanvas.width = 768;
    animCanvas.height = 768;
    animCtx = animCanvas.getContext("2d");
    texture = new THREE.CanvasTexture(animCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    if (item.src && !animFrames.length) {
      pendingImage = new Image();
      if (!String(item.src).startsWith("blob:")) pendingImage.crossOrigin = "anonymous";
    }
  } else {
    video = makeVideoElement(item.src);
    texture = makePlaceholderTexture();
  }

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.35),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: kind === "image",
      opacity: 1,
      alphaTest: kind === "image" ? 0.08 : 0,
      depthWrite: true,
      depthTest: true,
    })
  );
  screen.position.y = 0.2;
  screen.userData.hit = true;

  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(2.56, 1.51),
    new THREE.MeshBasicMaterial({
      color: CLIP_FRAME_COLOR,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    })
  );
  frame.position.z = -0.01;
  frame.position.y = 0.2;
  frame.visible = kind === "image";

  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(2.56, 1.51),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
  );
  backing.position.z = -0.02;
  backing.position.y = 0.2;
  backing.visible = false;

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.55),
    new THREE.MeshBasicMaterial({
      map: createLabelTexture(item.title, item.blurb, {
        kind,
      }),
      transparent: true,
      side: THREE.DoubleSide,
    })
  );
  label.position.set(0, 1.2, 0.02);
  label.visible = kind !== "image";

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x9ec4c8 })
  );
  beacon.position.set(0, -0.65, 0.05);

  group.add(backing, frame, screen, label, beacon);
  scene.add(group);

  const radar = document.createElement("span");
  const isUserPin = Boolean(item.deletable || item.worldLocked);
  radar.className = isUserPin ? "radar-dot radar-dot--user" : "radar-dot";
  radar.title = isUserPin
    ? kind === "image"
      ? "Your creation"
      : "Your recording"
    : item.title || "Video";
  radarDots.appendChild(radar);

  const node = {
    ...item,
    kind,
    demo: Boolean(item.demo),
    deletable: Boolean(item.deletable),
    thumbs: Number(item.thumbs) || 0,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    worldLocked: Boolean(item.worldLocked),
    inRange: item.lat == null ? true : Boolean(item.inRange),
    geoX: item.position[0],
    geoZ: item.position[2],
    spreadX: 0,
    spreadZ: 0,
    anchorX: item.position[0],
    anchorZ: item.position[2],
    group,
    screen,
    frame,
    backing,
    label,
    beacon,
    video,
    texture,
    radar,
    flying: kind === "image" && Boolean(item.flying || isFlyingSubject(item.title)),
    settled: kind !== "image" ? true : Boolean(item.flying || item.settled),
    velY: Number(item.velY) || 0,
    restY: kind === "image" && !(item.flying || isFlyingSubject(item.title)) ? 1.07 : item.position[1],
    baseY: item.position[1],
    phase: index * 1.1,
    previewing: false,
    playGrow: 0,
    posterTex: null,
    posterFailed: false,
    videoTex: null,
    posterSrc: "",
    placeholderTex: kind === "video" ? texture : null,
    videoCanvas: null,
    videoCtx: null,
    videoCanvasTex: null,
    animFrames,
    animCanvas,
    animCtx,
    animIndex: -1,
    animUrls: Array.isArray(item.animUrls) ? item.animUrls.slice() : [],
  };
  if (node.lat != null) {
    node.group.visible = node.inRange;
  }
  refreshNodeChrome(node);

  if (video) {
    applyPosterTexture(node, videoPosterSrc(node));
    const onMeta = () => applyVideoAspect(node);
    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });
  }

  const paintFrame = (img) => {
    if (!node.animCanvas || !node.animCtx || !img) return;
    const w = img.naturalWidth || img.width || 768;
    const h = img.naturalHeight || img.height || 768;
    if (node.animCanvas.width !== w || node.animCanvas.height !== h) {
      node.animCanvas.width = w;
      node.animCanvas.height = h;
    }
    node.animCtx.clearRect(0, 0, node.animCanvas.width, node.animCanvas.height);
    node.animCtx.drawImage(img, 0, 0);
    node.texture.needsUpdate = true;
    applyMediaAspect(node, w, h);
  };

  if (pendingImage) {
    pendingImage.onload = () => {
      node.animFrames = [pendingImage];
      paintFrame(pendingImage);
    };
    pendingImage.onerror = () => {
      console.warn("Creation image failed to decode");
      setStatus("Creation image failed to load", 3200);
    };
    pendingImage.src = item.src;
  } else if (animFrames.length) {
    paintFrame(animFrames[0]);
    node.animIndex = 0;
  }

  if (node.thumbs > 0) refreshNodeChrome(node);

  return node;
}

function disposeNode(node) {
  scene.remove(node.group);
  node.radar?.remove();
  removeLeafletMarker(node);
  if (node.video) {
    try {
      node.video.pause();
    } catch {
      /* ignore */
    }
    node.video.removeAttribute("src");
    node.video.load();
  }
  if (node.objectUrl) URL.revokeObjectURL(node.objectUrl);
  if (Array.isArray(node.animUrls)) {
    for (const u of node.animUrls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
  }
  const textures = new Set([
    node.texture,
    node.posterTex,
    node.videoTex,
    node.videoCanvasTex,
  ]);
  for (const tex of textures) tex?.dispose();
  node.screen.geometry.dispose();
  node.frame.geometry.dispose();
  node.backing?.geometry.dispose();
  node.label.geometry.dispose();
  node.beacon.geometry.dispose();
  node.screen.material.dispose();
  node.frame.material.map?.dispose();
  node.frame.material.dispose();
  node.backing?.material.dispose();
  node.label.material.map?.dispose();
  node.label.material.dispose();
  node.beacon.material.dispose();
  if (node.thumbsBadge) {
    node.thumbsBadge.geometry.dispose();
    node.thumbsBadge.material.map?.dispose();
    node.thumbsBadge.material.dispose();
  }
}

function removeNode(node) {
  if (!node?.deletable) return;

  if (node.cloudId) {
    deleteSpot(node.cloudId, node.storagePath, node.deleteToken).catch((err) =>
      console.warn("Cloud delete failed", err)
    );
  }

  if (state.watchingNode === node) closeTheaterMode();
  disposeNode(node);
  state.nodes = state.nodes.filter((n) => n !== node);

  if (state.focused === node) setFocus(null);

  if (state.mapOpen) refreshMapList();
  syncLeafletMarkers();
  setStatus(`Removed ${node.title}`);
}

function updateDeleteControls() {
  if (deleteBtn) {
    deleteBtn.hidden = true;
    deleteBtn.style.visibility = "hidden";
  }
  if (theaterDelete) theaterDelete.hidden = true;
}

/** Pin the × to the right side of the title label (red-circle spot). */
function positionDeleteBtn() {
  if (deleteBtn) deleteBtn.style.visibility = "hidden";
}

function buildScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    LOOK_FOV_DEFAULT,
    window.innerWidth / window.innerHeight,
    0.1,
    20000
  );
  camera.position.set(0, 1.4, 0);
  applyLayoutFov();

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const hemi = new THREE.HemisphereLight(0xf2f2f2, 0x1a1a1a, 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(2, 4, 1);
  scene.add(key);

  const ground = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 8.5, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.03,
      side: THREE.DoubleSide,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  scene.add(ground);

  state.nodes = CATALOG.map((item, index) => createNode(item, index));
  anchorDemoVideosToLaunch();
  updateGeoAnchors();
}

function getScreenOrientRad() {
  const angle =
    screen.orientation?.angle ??
    (typeof window.orientation === "number" ? window.orientation : 0);
  return THREE.MathUtils.degToRad(angle);
}

function setDeviceQuaternion(alphaDeg, betaDeg, gammaDeg, compassDeg) {
  const alpha = THREE.MathUtils.degToRad(alphaDeg);
  const beta = THREE.MathUtils.degToRad(betaDeg);
  const gamma = THREE.MathUtils.degToRad(gammaDeg);
  const orient = getScreenOrientRad();

  // Device frame → world, then aim through the back camera
  _euler.set(beta, alpha, -gamma, "YXZ");
  _deviceQuat.setFromEuler(_euler);
  _deviceQuat.multiply(_q1);
  _deviceQuat.multiply(_q0.setFromAxisAngle(_zee, -orient));

  // Align scene north (-Z) with real compass north once, so GPS directions
  // stored while recording stay true across sessions and devices.
  if (!state.northAligned && compassDeg != null && Number.isFinite(compassDeg)) {
    _northForward.set(0, 0, -1).applyQuaternion(_deviceQuat);
    _northForward.y = 0;
    // Wait until the phone is upright enough for a stable heading
    if (_northForward.lengthSq() > 0.12) {
      _northForward.normalize();
      const sceneYaw = Math.atan2(_northForward.x, -_northForward.z);
      const trueYaw = THREE.MathUtils.degToRad(compassDeg);
      _northQuat.setFromAxisAngle(_worldUp, sceneYaw - trueYaw);
      state.northAligned = true;
    }
  }
  if (state.northAligned) _deviceQuat.premultiply(_northQuat);

  state.orientReady = true;
}

function updateCameraRig(dt) {
  _offsetQuat.setFromEuler(
    new THREE.Euler(state.offsetPitch, state.offsetYaw, 0, "YXZ")
  );

  if (state.orientReady) {
    // World-locked look: phone gyro drives the camera; drag is a small calibration offset
    _targetQuat.copy(_deviceQuat).multiply(_offsetQuat);
  } else {
    // Desktop / no gyro: free-look from drag / keys only
    _targetQuat.copy(_offsetQuat);
  }

  if (state.cameraLayout === "carousel") {
    // Keep the ring level; pitch slides the stack between the header and shutter.
    _euler.setFromQuaternion(_targetQuat, "YXZ");
    const pitch = _euler.x;
    if (state.orientReady && state.carouselPitchBaseline == null) {
      state.carouselPitchBaseline = pitch;
      state.carouselTiltT = 0;
    }
    state.carouselLookPitch = carouselRelativePitch(
      pitch,
      state.carouselPitchBaseline
    );
    _euler.x = 0;
    _euler.z = 0;
    _targetQuat.setFromEuler(_euler);
  }

  // Fast slerp keeps screens feeling glued in space while softening sensor noise
  const blend = state.hasGyro ? Math.min(1, dt * 28) : Math.min(1, dt * 14);
  camera.quaternion.slerp(_targetQuat, blend);
}

const FOCUS_RENDER_ORDER = 20;

/** Draw the viewfinder clip on top of every other pin. */
function applyFocusLayer(node, front) {
  if (node.group) node.group.renderOrder = front ? FOCUS_RENDER_ORDER : 0;
  const stack = [
    [node.backing, front ? FOCUS_RENDER_ORDER : 0, true],
    [node.frame, front ? FOCUS_RENDER_ORDER + 1 : 0, true],
    [node.screen, front ? FOCUS_RENDER_ORDER + 3 : 1, false],
    [node.label, front ? FOCUS_RENDER_ORDER + 4 : 0, false],
    [node.thumbsBadge, front ? FOCUS_RENDER_ORDER + 4 : 0, false],
  ];
  for (const [mesh, order, keepDepth] of stack) {
    if (!mesh) continue;
    mesh.renderOrder = order;
    const mat = mesh.material;
    if (!mat) continue;
    const depth = !front || keepDepth;
    mat.depthTest = depth;
    mat.depthWrite = depth;
  }
}

/** Shrink close videos so a 4 ft pin does not fill the lens. */
function cameraVideoScale(node) {
  if (!camera || !node?.group) return 1;
  const dx = node.group.position.x - camera.position.x;
  const dz = node.group.position.z - camera.position.z;
  const dist = Math.hypot(dx, dz);
  const h = node.screen?.geometry?.parameters?.height || 1.35;
  const maxH = Math.min(h, Math.max(0.7, dist * 0.7));
  return THREE.MathUtils.clamp(maxH / h, 0.32, 1);
}

function updateNodes(t, dt) {
  const carousel = state.cameraLayout === "carousel";
  for (const node of state.nodes) {
    const hot = state.focused === node;
    node.playGrow = stepPlayGrow(
      node.playGrow,
      playGrowTarget({
        focused: hot,
        kind: node.kind,
      }),
      dt
    );
  }
  if (carousel) layoutCameraCarousel();
  for (const node of state.nodes) {
    if (node.anchorX != null) node.group.position.x = node.anchorX;
    if (node.anchorZ != null) node.group.position.z = node.anchorZ;

    if (carousel) {
      const h = carouselNodeHeight(node);
      node.group.position.y = node.anchorY ?? CAROUSEL_FLOOR_Y + h * 0.5;
      if (node.screen) node.screen.position.y = 0;
      if (node.frame) node.frame.position.y = 0;
      if (node.backing) node.backing.position.y = 0;
      if (node.beacon) node.beacon.visible = false;
    } else if (node.kind === "image") {
      if (node.flying) {
        node.group.position.y =
          node.baseY + Math.sin(t * 1.35 + node.phase) * 0.18;
      } else {
        if (!node.settled) {
          node.velY = (node.velY || 0) - 9.8 * dt;
          node.baseY += node.velY * dt;
          const floorY = node.restY ?? 0.7;
          if (node.baseY <= floorY) {
            node.baseY = floorY;
            if (node.velY < -2.4) node.velY = -node.velY * 0.22;
            else {
              node.velY = 0;
              node.settled = true;
            }
          }
        }
        node.group.position.y = node.baseY;
      }
      if (node.beacon) node.beacon.visible = false;
    } else {
      node.group.position.y = node.baseY + Math.sin(t * 1.2 + node.phase) * 0.08;
      node.beacon.scale.setScalar(1 + Math.sin(t * 3 + node.phase) * 0.25);
    }

    const hot = state.focused === node;
    const grow = playGrowScale(node.playGrow);
    const front = hot || grow > 1.02;
    applyFocusLayer(node, front);
    if (node.kind === "video" && hot && !state.watching) {
      if (node.previewing) {
        if (!paintVideoFrame(node) && node.posterTex) showPosterTexture(node);
      } else {
        ensurePreview(node);
      }
    }
    if (node.backing) node.backing.visible = false;
    if (node.frame && node.kind === "video") node.frame.visible = false;
    const zLift = front ? 0.22 + (node.playGrow || 0) * 0.12 : 0;
    if (node.kind === "image") {
      if (node.frame) node.frame.visible = true;
      // Flipbook + idle sway so creations feel alive
      if (node.animFrames?.length > 1 && node.animCtx) {
        const fps = 7;
        const idx = Math.floor(t * fps) % node.animFrames.length;
        if (idx !== node.animIndex) {
          node.animIndex = idx;
          const img = node.animFrames[idx];
          if (img) {
            node.animCtx.clearRect(0, 0, node.animCanvas.width, node.animCanvas.height);
            node.animCtx.drawImage(img, 0, 0);
            node.texture.needsUpdate = true;
          }
        }
      }
      const swayAmp = node.flying ? 0.055 : 0.028;
      const sway = carousel ? 0 : Math.sin(t * 2.4 + node.phase) * swayAmp;
      const breathe = carousel
        ? carouselScale()
        : 1 + Math.sin(t * 3.1 + node.phase) * (node.flying ? 0.04 : 0.02);
      node.screen.rotation.z = sway;
      node.screen.scale.setScalar(breathe);
      node.screen.position.z = zLift;
      if (node.frame) {
        node.frame.rotation.z = sway;
        node.frame.scale.setScalar(breathe);
        node.frame.position.z = zLift - 0.01;
      }
    } else {
      node.screen.rotation.z = 0;
      const viewScale = (carousel ? carouselScale() : cameraVideoScale(node)) * grow;
      node.screen.scale.set(viewScale, viewScale, 1);
      node.frame.scale.set(viewScale, viewScale, 1);
      if (node.backing) node.backing.scale.set(viewScale, viewScale, 1);
      node.screen.position.z = zLift;
      node.frame.position.z = zLift - 0.01;
      if (node.backing) node.backing.position.z = zLift - 0.02;
      node.beacon.material.color.set(hot ? 0xffffff : 0x9ec4c8);
    }

    // Stand upright on the ground plane and only yaw toward the viewer.
    // Pitch/roll stay 0 so clips stay level when the phone tilts.
    // In carousel they face inward on the ring; in place mode they face you.
    alignNodeToGround(node);
  }
}

function alignNodeToGround(node) {
  if (!camera || !node?.group) return;
  const originX = camera.position.x;
  const originZ = camera.position.z;
  const yaw = yawTowardOrigin(
    node.group.position.x,
    node.group.position.z,
    originX,
    originZ
  );
  _groundEuler.set(0, yaw, 0, "YXZ");
  node.group.quaternion.setFromEuler(_groundEuler);
  if (node.kind === "video") {
    if (node.screen) {
      node.screen.rotation.x = 0;
      node.screen.rotation.z = 0;
    }
    if (node.frame) {
      node.frame.rotation.x = 0;
      node.frame.rotation.z = 0;
    }
    if (node.label) {
      node.label.rotation.x = 0;
      node.label.rotation.z = 0;
    }
  }
}

function isNodeInView(node) {
  if (!node?.group?.visible) return false;
  camera.getWorldDirection(_forward);
  _to.copy(node.group.position).sub(camera.position);
  const dist = _to.length();
  if (dist < 0.35) return false;
  if (state.cameraLayout !== "carousel" && dist > geoRangeM() + 4) return false;
  _to.normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(_forward.dot(_to), -1, 1));
  // Same aim cone as lock-on — only then count as "in view"
  return ang <= 0.48;
}

function radarWorldOffset(node) {
  const useGeo =
    state.cameraLayout === "carousel" &&
    node.geoX != null &&
    node.geoZ != null;
  const x = useGeo ? node.geoX : node.group.position.x;
  const z = useGeo ? node.geoZ : node.group.position.z;
  const originX = camera ? camera.position.x : 0;
  const originZ = camera ? camera.position.z : 0;
  return { dx: x - originX, dz: z - originZ };
}

function updateRadar() {
  const radius = 34;
  const center = 42;
  camera.getWorldDirection(_forward);
  const yaw = Math.atan2(_forward.x, _forward.z);
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);

  for (const node of state.nodes) {
    if (!node.radar || node.radar.style.display === "none") continue;

    const { dx, dz } = radarWorldOffset(node);
    const right = dx * cos - dz * sin;
    const forward = dx * sin + dz * cos;
    const dist = Math.hypot(right, forward) || 1;
    const clamped = Math.min(dist / Math.max(radarSpanM(), 25), 1);
    const x = center - (right / dist) * radius * clamped;
    const y = center - (forward / dist) * radius * clamped;
    node.radar.style.left = `${x}px`;
    node.radar.style.top = `${y}px`;

    // Green only when that video is actually in the camera view
    const inView = isNodeInView(node);
    node.radar.classList.toggle("is-in-view", inView);
    node.radar.classList.remove("is-hot", "is-ahead");
  }
}

function getLookYaw() {
  if (!camera) return state.lastYaw ?? 0;
  camera.getWorldDirection(_forward);
  let x = _forward.x;
  let z = _forward.z;

  // Holding the phone flat to read the map collapses forward's ground
  // projection. Fall back to the phone's top edge (camera up) for heading:
  // looking down, camera-up points where the top of the phone faces.
  if (Math.hypot(x, z) < 0.35) {
    _upHeading.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const sign = _forward.y < 0 ? 1 : -1;
    x = _upHeading.x * sign;
    z = _upHeading.z * sign;
  }

  if (Math.hypot(x, z) < 0.05) return state.lastYaw ?? 0;
  state.lastYaw = Math.atan2(x, -z);
  return state.lastYaw;
}

function nodeGroundOffset(node) {
  const origin = viewOrigin();
  if (origin && node.lat != null && node.lng != null) {
    const enu = enuFromOrigin(origin.lat, origin.lng, node.lat, node.lng);
    return { east: enu.x, north: -enu.z };
  }
  if (camera && node.group) {
    return {
      east: node.group.position.x - camera.position.x,
      north: -(node.group.position.z - camera.position.z),
    };
  }
  return {
    east: node.anchorX ?? 0,
    north: -(node.anchorZ ?? 0),
  };
}

function removeLeafletMarker(_node) {
  // Clusters are rebuilt from live nodes; drop stale markers via sync.
  if (state.leafletMap) syncLeafletMarkers();
}

/** Group videos within ~40 m so one callout can show the count. */
function clusterMapNodes(nodes) {
  const clusters = [];
  const assigned = new Set();
  const maxM = 40;

  for (const node of nodes) {
    if (node.lat == null || node.lng == null || assigned.has(node.id)) continue;
    const group = [node];
    assigned.add(node.id);
    for (const other of nodes) {
      if (other.lat == null || other.lng == null || assigned.has(other.id)) continue;
      const d = haversineMeters(node.lat, node.lng, other.lat, other.lng);
      if (d <= maxM) {
        group.push(other);
        assigned.add(other.id);
      }
    }
    const lat = group.reduce((s, n) => s + n.lat, 0) / group.length;
    const lng = group.reduce((s, n) => s + n.lng, 0) / group.length;
    // Prefer the most recently added node in this cluster as the tap target
    group.sort(
      (a, b) => state.nodes.indexOf(b) - state.nodes.indexOf(a)
    );
    clusters.push({
      id: `c:${group
        .map((n) => n.id)
        .sort()
        .join("|")}`,
      lat,
      lng,
      count: group.length,
      nodes: group,
      primary: group[0],
    });
  }
  return clusters;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function movieCalloutHtml(count, selected = false) {
  const sel = selected ? " is-selected" : "";
  return `
    <div class="map-callout${sel}">
      <div class="map-callout-bubble">
        <span class="map-callout-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="2"/>
            <path d="M8 5V3M16 5V3M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M10 12.2l5 2.8-5 2.8v-5.6z" fill="currentColor"/>
          </svg>
        </span>
        <span class="map-callout-count">${count}</span>
      </div>
      <span class="map-callout-tail" aria-hidden="true"></span>
    </div>
  `.trim();
}

function selectMapCluster(clusterId) {
  state.selectedClusterId =
    state.selectedClusterId === clusterId ? null : clusterId;
  if (state.selectedClusterId) {
    const cluster = clusterMapNodes(allGeoNodes()).find(
      (c) => c.id === state.selectedClusterId
    );
    const town = cluster?.nodes?.map(nodeTown).find(Boolean);
    if (town) state.mapExpandedTown = town;
  }
  syncLeafletMarkers();
  refreshMapList();
}

function clearMapClusterSelection() {
  if (!state.selectedClusterId) return;
  state.selectedClusterId = null;
  syncLeafletMarkers();
  refreshMapList();
}

/** Add/move a callout for each video cluster; drop markers for removed ones. */
function syncLeafletMarkers() {
  if (!state.leafletMap || !window.L) return;
  const L = window.L;
  const geoNodes = allGeoNodes();
  const clusters = clusterMapNodes(geoNodes);
  const liveIds = new Set(clusters.map((c) => c.id));

  if (state.selectedClusterId && !liveIds.has(state.selectedClusterId)) {
    state.selectedClusterId = null;
  }

  for (const cluster of clusters) {
    let marker = state.leafletMarkers.get(cluster.id);
    const selected = state.selectedClusterId === cluster.id;
    const title =
      cluster.count === 1
        ? cluster.primary.title
        : `${cluster.count} videos here`;
    const iconOpts = {
      className: "map-callout-icon-wrap",
      html: movieCalloutHtml(cluster.count, selected),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    };
    const bindClick = (m, c) => {
      m.off("click");
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectMapCluster(c.id);
      });
    };
    if (!marker) {
      marker = L.marker([cluster.lat, cluster.lng], {
        icon: L.divIcon(iconOpts),
        title,
        riseOnHover: true,
        zIndexOffset: selected ? 600 : 400,
      }).addTo(state.leafletMap);
      marker._lumenCount = cluster.count;
      marker._lumenSelected = selected;
      bindClick(marker, cluster);
      state.leafletMarkers.set(cluster.id, marker);
    } else {
      marker.setLatLng([cluster.lat, cluster.lng]);
      if (
        marker._lumenCount !== cluster.count ||
        marker._lumenSelected !== selected
      ) {
        marker._lumenCount = cluster.count;
        marker._lumenSelected = selected;
        marker.setIcon(L.divIcon(iconOpts));
      }
      marker.setZIndexOffset(selected ? 600 : 400);
      marker.options.title = title;
      bindClick(marker, cluster);
    }
  }

  for (const [id, marker] of state.leafletMarkers) {
    if (!liveIds.has(id)) {
      marker.remove();
      state.leafletMarkers.delete(id);
    }
  }
}

/** Zoom/pan to GPS and the closest 20 clips around the view origin. */
function withMapProgrammatic(fn) {
  if (!state.leafletMap) return;
  state.mapProgrammatic = true;
  try {
    fn();
  } finally {
    requestAnimationFrame(() => {
      state.mapProgrammatic = false;
    });
  }
}

function fitMapToPins() {
  if (!state.leafletMap || !window.L) return;
  const L = window.L;
  const you = gpsOrigin();
  const nearby = viewClipNodes();
  const points = [];
  if (you) points.push([you.lat, you.lng]);
  for (const node of nearby) points.push([node.lat, node.lng]);
  if (!points.length) return;
  withMapProgrammatic(() => {
    if (points.length === 1) {
      state.leafletMap.setView(points[0], 16, { animate: false });
      return;
    }
    state.leafletMap.fitBounds(L.latLngBounds(points), {
      padding: [36, 36],
      maxZoom: 16,
      animate: false,
    });
  });
}

function syncLocateButtons() {
  for (const btn of [
    document.getElementById("map-locate"),
    fieldLocate,
  ]) {
    if (!btn) continue;
    btn.classList.toggle("is-following", Boolean(state.viewFollowsUser));
    btn.disabled = !gpsOrigin();
  }
}

function recenterOnUser() {
  const you = gpsOrigin();
  if (!you) {
    setStatus("Enable location to center here", 3200);
    return;
  }
  state.viewFollowsUser = true;
  state.viewGeo = { lat: you.lat, lng: you.lng };
  state.townFollowsUser = true;
  lookupPlace(you.lat, you.lng);
  const here = userTownName();
  if (here) {
    state.selectedTown = here;
    state.mapExpandedTown = here;
    state.mapTownCollapsed = false;
  }
  syncTownDropdown();
  if (state.leafletMap) {
    const zoom = state.leafletMap.getZoom();
    withMapProgrammatic(() => {
      state.leafletMap.setView([you.lat, you.lng], zoom < 11 ? 16 : zoom, {
        animate: false,
      });
    });
    if (state.mapOpen) {
      syncLeafletMarkers();
      refreshMapList();
    }
  }
  updateGeoAnchors();
  syncLocateButtons();
}

function applyMapCenterAsViewOrigin({ force = false } = {}) {
  if (state.mapProgrammatic || !state.leafletMap) return;
  const c = state.leafletMap.getCenter();
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
  const prev = state.viewGeo;
  if (
    !force &&
    prev &&
    !state.viewFollowsUser &&
    distanceMeters(prev.lat, prev.lng, c.lat, c.lng) < 8
  ) {
    return;
  }
  state.viewFollowsUser = false;
  state.viewGeo = { lat: c.lat, lng: c.lng };
  updateGeoAnchors();
  if (state.mapOpen) {
    syncLeafletMarkers();
    refreshMapList();
  }
  syncLocateButtons();
}

let mapOriginTimer = 0;
function onMapUserDrag() {
  if (state.mapProgrammatic) return;
  if (mapOriginTimer) return;
  mapOriginTimer = window.setTimeout(() => {
    mapOriginTimer = 0;
    applyMapCenterAsViewOrigin();
  }, 80);
}

function onMapUserDragEnd() {
  if (mapOriginTimer) {
    window.clearTimeout(mapOriginTimer);
    mapOriginTimer = 0;
  }
  applyMapCenterAsViewOrigin({ force: true });
}

function addMapLocateControl(L, map) {
  const Control = L.Control.extend({
    onAdd() {
      const btn = L.DomUtil.create("button", "map-locate");
      btn.type = "button";
      btn.id = "map-locate";
      btn.setAttribute("aria-label", "Center on current location");
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0-6h2v2.06A8.01 8.01 0 0 1 19.94 10H22v2h-2.06A8.01 8.01 0 0 1 14 19.94V22h-2v-2.06A8.01 8.01 0 0 1 4.06 12H2v-2h2.06A8.01 8.01 0 0 1 10 4.06V2h2zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"
          />
        </svg>
      `;
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.disableScrollPropagation(btn);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        recenterOnUser();
      });
      return btn;
    },
  });
  new Control({ position: "bottomright" }).addTo(map);
  syncLocateButtons();
}

let leafletPromise = null;

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = (async () => {
      await loadStylesheet(
        "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"
      );
      await loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js");
      return window.L;
    })().catch((err) => {
      leafletPromise = null;
      throw err;
    });
  }
  return leafletPromise;
}

/** Build the real map once; safe to call again on every open. */
async function ensureLeafletMap(origin) {
  const L = await loadLeaflet();
  if (!state.leafletMap) {
    const el = document.getElementById("leaflet-map");
    state.leafletMap = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      center: [origin.lat, origin.lng],
      zoom: 16,
      maxZoom: 19,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      subdomains: "abc",
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.leafletMap);

    const youIcon = L.divIcon({
      className: "map-you-icon",
      html: `<span class="map-you-dot" aria-hidden="true"><span class="map-you-pulse"></span></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    state.leafletYou = L.marker([origin.lat, origin.lng], {
      icon: youIcon,
      interactive: false,
      // Stay under callout pins so the blue dot never covers them
      zIndexOffset: -200,
    }).addTo(state.leafletMap);

    addMapLocateControl(L, state.leafletMap);
    state.leafletMap.on("click", () => clearMapClusterSelection());
    state.leafletMap.on("drag", onMapUserDrag);
    state.leafletMap.on("dragend", onMapUserDragEnd);
  }
  // Container was hidden (display:none) while created, so Leaflet needs a nudge
  requestAnimationFrame(() => state.leafletMap?.invalidateSize());
  syncLeafletMarkers();
}

/** Under ¼ mile → feet; over → quarter-mile steps ("5½ miles"). */
function formatMapDistance(meters) {
  const feet = meters * 3.28084;
  if (feet < 1320) return `${Math.max(1, Math.round(feet))} ft`;
  const quarters = Math.round((feet / 5280) * 4) / 4;
  const whole = Math.floor(quarters);
  const frac = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[quarters - whole] || "";
  const num = whole ? `${whole}${frac}` : frac;
  return `${num} ${quarters <= 1 ? "mile" : "miles"}`;
}

// Reverse-geocode cache: pins cluster, so round to ~100m cells
const placeCache = new Map();
const placeRetryAt = new Map();
const placePending = new Set();
const placeQueue = [];
let placeInflight = 0;
const PLACE_CONCURRENCY = 2;
const NODE_TOWN_M = 1600;

function unnamedTownLabel() {
  return gpsOrigin() ? FALLBACK_TOWN : "Locating…";
}

function lookupPlace(lat, lng) {
  const key = placeCacheKey(lat, lng);
  const cached = placeCache.get(key);
  if (cached) return cached;
  if (placePending.has(key)) return null;
  if ((placeRetryAt.get(key) || 0) > Date.now()) return null;
  placePending.add(key);
  placeQueue.push({ lat, lng, key });
  pumpPlaceQueue();
  return null;
}

function pumpPlaceQueue() {
  while (placeInflight < PLACE_CONCURRENCY && placeQueue.length) {
    const job = placeQueue.shift();
    placeInflight += 1;
    fetchTownName(job.lat, job.lng)
      .then((place) => {
        placePending.delete(job.key);
        placeInflight -= 1;
        if (!place) {
          placeRetryAt.set(job.key, Date.now() + 8000);
          pumpPlaceQueue();
          return;
        }
        placeRetryAt.delete(job.key);
        placeCache.set(job.key, place);
        const you = gpsOrigin();
        if (
          state.townFollowsUser &&
          you &&
          distanceMeters(you.lat, you.lng, job.lat, job.lng) <= 450
        ) {
          state.selectedTown = place;
        }
        if (state.mapOpen) refreshMapList();
        syncTownDropdown();
        updateGeoAnchors();
        pumpPlaceQueue();
      })
      .catch(() => {
        placePending.delete(job.key);
        placeInflight -= 1;
        placeRetryAt.set(job.key, Date.now() + 8000);
        pumpPlaceQueue();
      });
  }
}

function nearestCachedPlace(lat, lng, maxM = 450) {
  return nearestPlaceInCache(placeCache, lat, lng, maxM);
}

function nodeTown(node) {
  if (node?.lat == null || node.lng == null) return null;
  return nearestCachedPlace(node.lat, node.lng, NODE_TOWN_M) || FALLBACK_TOWN;
}

function userTownName() {
  const you = gpsOrigin();
  if (!you) return null;
  return nearestCachedPlace(you.lat, you.lng);
}

function ensureTownPlaces() {
  const you = gpsOrigin();
  if (you) lookupPlace(you.lat, you.lng);
  for (const node of state.nodes) {
    if (node.lat == null || node.lng == null) continue;
    if (!nodeInTimeRange(node)) continue;
    lookupPlace(node.lat, node.lng);
  }
  if (state.townFollowsUser) {
    const here = userTownName();
    if (here) state.selectedTown = here;
  }
}

function syncTownDropdown() {
  if (!townSelect) return;
  const selected = formatTownName(state.selectedTown || "");
  if (selected && state.selectedTown !== selected) state.selectedTown = selected;
  const label = selected || unnamedTownLabel();
  if (townSelect.textContent !== label) townSelect.textContent = label;
  townSelect.setAttribute("aria-expanded", String(Boolean(state.mapOpen)));
  townSelect.setAttribute("aria-label", `Open map, ${label}`);
}

function selectTown(name, { fromUser = false } = {}) {
  const next = formatTownName(name);
  if (!next) return;
  if (fromUser) state.townFollowsUser = next === FALLBACK_TOWN;
  const same = state.selectedTown === next;
  if (same && !fromUser) {
    syncTownDropdown();
    return;
  }
  state.selectedTown = next;
  state.mapExpandedTown = next;
  state.mapTownCollapsed = false;
  if (fromUser) centerCarouselInView();
  syncTownDropdown();
  updateGeoAnchors();
  if (state.mapOpen) {
    refreshMapList();
    syncLeafletMarkers();
  }
}

function buildMapListRow(node) {
  const li = document.createElement("li");
  li.className = "map-clip";
  li.innerHTML = `
    <button type="button" class="map-list-play" aria-label="Watch">
      <span class="map-thumb"><span class="map-thumb-ph"></span></span>
      <span class="map-list-body">
        <span class="map-list-title"></span>
        <span class="map-list-meta"></span>
      </span>
    </button>
    <span class="map-list-dir">
      <span class="map-list-arrow">
        <svg viewBox="0 0 24 24"><path d="M12 2 L19 15 L12 11.6 L5 15 Z" /></svg>
      </span>
      <span class="map-list-dist"></span>
    </span>
  `;
  const play = li.querySelector(".map-list-play");
  play.addEventListener("click", () => openFieldOnClip(node));
  return {
    li,
    play,
    thumbWrap: li.querySelector(".map-thumb"),
    title: li.querySelector(".map-list-title"),
    meta: li.querySelector(".map-list-meta"),
    dist: li.querySelector(".map-list-dist"),
    arrow: li.querySelector(".map-list-arrow"),
    thumbSrc: null,
  };
}

function buildMapTownGroup(key) {
  const li = document.createElement("li");
  li.className = "map-town";
  li.innerHTML = `
    <button type="button" class="map-town-toggle" aria-expanded="false">
      <span class="map-town-name"></span>
      <span class="map-town-count"></span>
    </button>
    <ul class="map-town-clips"></ul>
  `;
  const toggle = li.querySelector(".map-town-toggle");
  toggle.addEventListener("click", () => {
    if (state.mapExpandedTown === key) {
      state.mapExpandedTown = "";
      state.mapTownCollapsed = true;
      refreshMapList();
      return;
    }
    selectTown(key, { fromUser: true });
  });
  return {
    key,
    li,
    toggle,
    name: li.querySelector(".map-town-name"),
    count: li.querySelector(".map-town-count"),
    clips: li.querySelector(".map-town-clips"),
  };
}

function defaultExpandedTown(groups) {
  const here = userTownName() || state.selectedTown;
  if (here && groups.some((g) => g.key === here)) return here;
  return groups[0]?.key || null;
}

function collectMapTownGroups(nodes) {
  const grouped = new Map();
  for (const node of nodes) {
    const key = nodeTown(node) || FALLBACK_TOWN;
    let group = grouped.get(key);
    if (!group) {
      group = { key, nodes: [], dist: Infinity };
      grouped.set(key, group);
    }
    group.nodes.push(node);
    const off = nodeGroundOffset(node);
    const dist = Math.hypot(off.east, off.north);
    if (dist < group.dist) group.dist = dist;
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.key === FALLBACK_TOWN) return 1;
    if (b.key === FALLBACK_TOWN) return -1;
    return a.dist - b.dist || a.key.localeCompare(b.key);
  });
}

/** Put the open accordion first so it sits at the top of the list area. */
function pinOpenTownFirst(groups, openKey) {
  if (!openKey) return groups;
  const i = groups.findIndex((g) => g.key === openKey);
  if (i <= 0) return groups;
  const ordered = groups.slice();
  const [open] = ordered.splice(i, 1);
  ordered.unshift(open);
  return ordered;
}

let mapListPinnedTown = "";

function scrollOpenTownToListTop() {
  if (!mapList || !state.mapExpandedTown) {
    mapListPinnedTown = "";
    return;
  }
  if (mapListPinnedTown === state.mapExpandedTown) return;
  mapListPinnedTown = state.mapExpandedTown;
  requestAnimationFrame(() => {
    mapList.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function updateMapClipRow(row, node, dist) {
  if (row.title.textContent !== node.title) row.title.textContent = node.title;
  row.play.setAttribute(
    "aria-label",
    `${node.kind === "image" ? "View" : "Watch"} ${node.title}`
  );
  const taken = formatTakenLabel(node.takenAt);
  const meta = [node.deletable ? "Your pin" : null, taken ? `taken ${taken}` : null]
    .filter(Boolean)
    .join(" · ");
  if (row.meta.textContent !== meta) row.meta.textContent = meta;
  const distLabel = formatMapDistance(dist);
  if (row.dist.textContent !== distLabel) row.dist.textContent = distLabel;
  const thumb =
    node.thumbUrl || (node.storagePath ? thumbUrl(node.storagePath) : null);
  if (thumb && row.thumbSrc !== thumb) {
    row.thumbSrc = thumb;
    row.thumbWrap.innerHTML = `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />`;
  }
}

function refreshMapList() {
  if (!mapList) return;

  const groups = collectMapTownGroups(allGeoNodes());
  if (!groups.length) {
    mapList.innerHTML = `<li class="map-list-empty">No clips</li>`;
    state.mapRowEls = new Map();
    state.mapTownEls = new Map();
    state.mapArrowEls = new Map();
    return;
  }
  mapList.querySelector(".map-list-empty")?.remove();

  if (!state.mapRowEls) state.mapRowEls = new Map();
  if (!state.mapTownEls) state.mapTownEls = new Map();

  if (state.mapTownCollapsed) {
    state.mapExpandedTown = "";
  } else if (
    !state.mapExpandedTown ||
    !groups.some((g) => g.key === state.mapExpandedTown)
  ) {
    state.mapExpandedTown = defaultExpandedTown(groups);
  }

  const liveTowns = new Set();
  const liveIds = new Set();
  const ordered = pinOpenTownFirst(groups, state.mapExpandedTown);

  ordered.forEach((group, index) => {
    liveTowns.add(group.key);
    let townEl = state.mapTownEls.get(group.key);
    if (!townEl) {
      townEl = buildMapTownGroup(group.key);
      state.mapTownEls.set(group.key, townEl);
    }
    const atTown = mapList.children[index];
    if (atTown !== townEl.li) mapList.insertBefore(townEl.li, atTown || null);

    const expanded = group.key === state.mapExpandedTown;
    townEl.li.classList.toggle("is-open", expanded);
    townEl.toggle.setAttribute("aria-expanded", String(expanded));
    if (townEl.name.textContent !== group.key) townEl.name.textContent = group.key;
    const countLabel = `${group.nodes.length}`;
    if (townEl.count.textContent !== countLabel) {
      townEl.count.textContent = countLabel;
    }

    const sorted = group.nodes
      .map((node) => {
        const off = nodeGroundOffset(node);
        return { node, dist: Math.hypot(off.east, off.north) };
      })
      .sort((a, b) => a.dist - b.dist);

    sorted.forEach(({ node, dist }, clipIndex) => {
      liveIds.add(node.id);
      let row = state.mapRowEls.get(node.id);
      if (!row) {
        row = buildMapListRow(node);
        state.mapRowEls.set(node.id, row);
      }
      const atClip = townEl.clips.children[clipIndex];
      if (atClip !== row.li) townEl.clips.insertBefore(row.li, atClip || null);
      updateMapClipRow(row, node, dist);
    });
  });

  for (const [id, row] of state.mapRowEls) {
    if (!liveIds.has(id)) {
      row.li.remove();
      state.mapRowEls.delete(id);
    }
  }
  for (const [key, townEl] of state.mapTownEls) {
    if (!liveTowns.has(key)) {
      townEl.li.remove();
      state.mapTownEls.delete(key);
    }
  }

  state.mapArrowEls = new Map();
  for (const [id, row] of state.mapRowEls) {
    state.mapArrowEls.set(id, row.arrow);
  }
  scrollOpenTownToListTop();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Per-frame while the map is open: move the "you" marker, rotate its heading,
 * and rotate each list row's arrow relative to where you're currently facing. */
function updateMapView() {
  if (!state.mapOpen) return;
  const yaw = getLookYaw();

  const origin = gpsOrigin();
  if (state.leafletMap && state.leafletYou) {
    if (origin) state.leafletYou.setLatLng([origin.lat, origin.lng]);
  }

  for (const node of state.nodes) {
    const arrow = state.mapArrowEls.get(node.id);
    if (!arrow) continue;
    const off = nodeGroundOffset(node);
    const bearing = Math.atan2(off.east, off.north);
    arrow.style.transform = `rotate(${((bearing - yaw) * 180) / Math.PI}deg)`;
  }
}

async function openMapModal() {
  if (!mapModal || state.watching) return;
  closeFilterSheets();
  state.mapOpen = true;
  mapModal.hidden = false;
  state.mapExpandedTown = null;
  state.mapTownCollapsed = false;
  ensureTownPlaces();
  refreshMapList();
  syncTownDropdown();

  const origin = gpsOrigin();

  if (!origin) {
    if (mapViewport) {
      mapViewport.innerHTML = `<p class="map-placeholder">Enable location to see videos on the map.</p>`;
    }
    return;
  }

  if (mapViewport && !mapViewport.querySelector("#leaflet-map")) {
    mapViewport.innerHTML = `<div id="leaflet-map" class="leaflet-map"></div>`;
    state.leafletMap = null;
    state.leafletYou = null;
    state.leafletMarkers = new Map();
  }

  try {
    await ensureLeafletMap(origin);
    if (state.viewFollowsUser) {
      fitMapToPins();
    } else if (state.viewGeo) {
      withMapProgrammatic(() => {
        const zoom = state.leafletMap.getZoom();
        state.leafletMap.setView(
          [state.viewGeo.lat, state.viewGeo.lng],
          zoom,
          { animate: false }
        );
      });
    }
    syncLocateButtons();
  } catch (err) {
    console.warn("Map failed to load", err);
    if (mapViewport) {
      mapViewport.innerHTML = `<p class="map-placeholder">Map couldn’t load — check your connection.</p>`;
    }
  }
}

function closeMapModal() {
  if (!mapModal) return;
  state.mapOpen = false;
  state.selectedClusterId = null;
  mapModal.hidden = true;
  mapListPinnedTown = "";
  syncTownDropdown();
}

/** Yaw to rotate ground-forward (fromX, fromZ) onto (toX, toZ). */
function yawDeltaToTarget(fromX, fromZ, toX, toZ) {
  const fl = Math.hypot(fromX, fromZ);
  const tl = Math.hypot(toX, toZ);
  if (fl < 1e-6 || tl < 1e-6) return 0;
  const fx = fromX / fl;
  const fz = fromZ / fl;
  const tx = toX / tl;
  const tz = toZ / tl;
  const fromYaw = Math.atan2(-fx, -fz);
  const toYaw = Math.atan2(-tx, -tz);
  let delta = toYaw - fromYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function lookAtNode(node) {
  if (!camera || !node) return;
  const x = node.anchorX ?? node.group?.position.x;
  const z = node.anchorZ ?? node.group?.position.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const dx = x - camera.position.x;
  const dz = z - camera.position.z;
  if (Math.hypot(dx, dz) < 0.05) return;
  const forward = getLookForwardFlat();
  state.offsetYaw += yawDeltaToTarget(forward.x, forward.z, dx, dz);
  updateCameraRig(1);
}

/** Close Nearby and face this clip in the town carousel. */
function openFieldOnClip(node) {
  if (!node) return;
  closeMapModal();
  const town = nodeTown(node);
  if (town) selectTown(town, { fromUser: true });
  if (state.cameraLayout !== "carousel") setCameraLayout("carousel");
  else updateGeoAnchors();
  layoutCameraCarousel();
  lookAtNode(node);
  setFocus(node);
}

/** Translucent arrow that points the way to the nearest video. */
function updateGuideArrow() {
  if (!guide || !camera) return;

  if (
    state.watching ||
    state.mapOpen ||
    state.cameraLayout === "carousel"
  ) {
    guide.classList.remove("is-on");
    return;
  }

  let best = null;
  let bestDist = Infinity;
  for (const node of state.nodes) {
    if (!node.group.visible) continue;
    if (node.lat != null && !node.inRange) continue;
    const d = camera.position.distanceTo(node.group.position);
    if (d < 0.35) continue;
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }

  // Nothing to point at, or it's already on screen — fade out
  if (!best || isNodeInView(best)) {
    guide.classList.remove("is-on");
    return;
  }

  _camLocal.copy(best.group.position);
  camera.worldToLocal(_camLocal);

  let rot;
  if (_camLocal.z > 0) {
    // Target is behind — steer a hard turn toward its side
    rot = (_camLocal.x >= 0 ? 1 : -1) * Math.PI * 0.72;
  } else {
    rot = Math.atan2(_camLocal.x, _camLocal.y);
  }

  const radius = 92;
  const ox = Math.sin(rot) * radius;
  const oy = -Math.cos(rot) * radius;
  guide.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
  guideArrow.style.transform = `rotate(${THREE.MathUtils.radToDeg(rot)}deg)`;

  const feet = Math.max(1, Math.round(bestDist * 3.28084));
  guideLabel.textContent = `${best.title} · ${feet} ft`;
  guide.classList.add("is-on");
}

async function ensurePreview(node) {
  if (!node || node.previewing || node.previewLock || state.watching) return;
  if (!node.video || node.kind === "image") return;
  node.previewLock = true;
  showPosterTexture(node);
  try {
    node.video.preload = "auto";
    await node.video.play();
    const gotFrame = await waitForPaintedVideoFrame(node.video);
    if (state.focused !== node || state.watching) return;
    if (!gotFrame) {
      showPosterTexture(node);
      return;
    }
    node.previewing = true;
    showLiveVideoTexture(node);
  } catch {
    showPosterTexture(node);
  } finally {
    node.previewLock = false;
  }
}

function pausePreviews(exceptId) {
  for (const node of state.nodes) {
    if (node.id === exceptId) continue;
    if (node.video) {
      try {
        node.video.pause();
      } catch {
        /* ignore */
      }
    }
    if (node.previewing) showPosterTexture(node);
    node.previewing = false;
  }
}

function pickCenter() {
  // Aim-cone focus: must be in range for geo pins; billboard faces you from any side
  camera.getWorldDirection(_forward);
  const carousel = state.cameraLayout === "carousel";
  let best = null;
  let bestScore = Infinity;
  const maxDist = carousel ? 240 : geoRangeM() + 4;

  for (const node of state.nodes) {
    if (!node.group.visible) continue;
    if (node.lat != null && !node.inRange) continue;
    _to.copy(node.group.position).sub(camera.position);
    const dist = _to.length();
    if (dist < 0.35 || dist > maxDist) continue;
    const ang = carousel
      ? carouselAimAngle(
          camera.position.x,
          camera.position.z,
          node.group.position.x,
          node.group.position.z,
          _forward.x,
          _forward.z
        )
      : Math.acos(THREE.MathUtils.clamp(_forward.dot(_to.normalize()), -1, 1));
    if (ang > 0.48) continue;
    const score = ang * 2.2 + dist * 0.08;
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function setFocus(node) {
  state.focused = node;
  field.classList.toggle("is-locked", Boolean(node));
  if (node) {
    focusLabel.textContent = carouselFocusLabel(
      node.title,
      nodeTakenYear(node),
      node.thumbs || 0
    );
    ensurePreview(node);
    pausePreviews(node.id);
  } else {
    focusLabel.textContent = "Scan the field";
    pausePreviews(null);
  }
  updateDeleteControls();
}

function openTheater(node, opts = {}) {
  if (!node) return;
  const fromMap = Boolean(opts.fromMap) || state.mapOpen;
  closeMapModal();
  closeConfirmModal();
  closeAddModal();
  closeFilterSheets();
  state.watching = true;
  state.watchingNode = node;
  state.theaterFromMap = fromMap;
  pausePreviews(null);
  field.classList.add("is-watching");
  theater.hidden = false;
  const takenTitle = formatTakenLabel(node.takenAt);
  const baseTitle = node.thumbs
    ? `${node.title} 👍${node.thumbs > 1 ? node.thumbs : ""}`
    : node.title;
  theaterTitle.textContent = takenTitle ? `${baseTitle} · ${takenTitle}` : baseTitle;

  const isImage = node.kind === "image";
  theaterScreenWrap?.classList.toggle("is-image", isImage);
  if (theaterImage) theaterImage.hidden = !isImage;
  if (theaterVideo) theaterVideo.hidden = isImage;

  if (isImage) {
    theaterVideo.pause();
    theaterVideo.removeAttribute("src");
    theaterVideo.load();
    stopTheaterImageAnim();
    theaterImage.alt = node.title || "Creation";
    const frames = node.animFrames?.length
      ? node.animFrames
      : null;
    if (frames?.length) {
      let i = 0;
      const paint = () => {
        const img = frames[i % frames.length];
        if (img?.src) theaterImage.src = img.src;
        else if (node.animUrls?.[i % frames.length]) {
          theaterImage.src = node.animUrls[i % frames.length];
        }
        i += 1;
      };
      paint();
      state.theaterAnimId = setInterval(paint, 140);
    } else {
      theaterImage.src = node.src;
    }
    setStatus(`Viewing ${node.title}`);
  } else {
    stopTheaterImageAnim();
    if (theaterImage) {
      theaterImage.removeAttribute("src");
      theaterImage.alt = "";
    }
    const knownW = node.video?.videoWidth || 0;
    const knownH = node.video?.videoHeight || 0;
    theaterVideo.style.aspectRatio =
      knownW > 1 && knownH > 1 ? `${knownW} / ${knownH}` : "9 / 16";
    theaterVideo.loop = true;
    theaterVideo.removeAttribute("controls");
    theaterVideo.setAttribute("playsinline", "");
    theaterVideo.setAttribute("webkit-playsinline", "");
    theaterVideo.poster = videoPosterSrc(node) || "";
    theaterVideo.src = node.src;
    theaterVideo.muted = false;
    theaterVideo.play().catch(() => {
      theaterVideo.muted = true;
      theaterVideo.play().catch(() => setStatus("Tap the video to start"));
    });
    setStatus(`Watching ${node.title}`);
  }
  updateDeleteControls();
}

function closeTheaterMode() {
  const returnToMap = state.theaterFromMap;
  closeConfirmModal();
  stopTheaterImageAnim();
  state.watching = false;
  state.watchingNode = null;
  state.theaterFromMap = false;
  field.classList.remove("is-watching");
  theater.hidden = true;
  theaterScreenWrap?.classList.remove("is-image");
  if (theaterImage) {
    theaterImage.hidden = true;
    theaterImage.removeAttribute("src");
    theaterImage.alt = "";
  }
  if (theaterVideo) {
    theaterVideo.hidden = false;
    theaterVideo.pause();
    theaterVideo.removeAttribute("src");
    theaterVideo.load();
  }
  if (state.focused) ensurePreview(state.focused);
  updateDeleteControls();
  if (returnToMap) openMapModal();
}

function openConfirmModal(message) {
  if (!confirmModal) return;
  if (confirmCopy) confirmCopy.textContent = message;
  confirmModal.hidden = false;
}

function closeConfirmModal() {
  if (!confirmModal) return;
  confirmModal.hidden = true;
}

function requestTheaterDelete() {
  const node = state.watchingNode || state.focused;
  if (!node?.deletable) return;
  openConfirmModal(`Delete “${node.title}”? This can’t be undone.`);
}

function stopTheaterImageAnim() {
  if (state.theaterAnimId) {
    clearInterval(state.theaterAnimId);
    state.theaterAnimId = null;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API unavailable in this browser");
  }

  camEl.setAttribute("playsinline", "");
  camEl.setAttribute("webkit-playsinline", "");
  camEl.muted = true;
  camEl.autoplay = true;
  camEl.playsInline = true;

  // Rear camera only — uploads come from Add / camera roll
  const attempts = [
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];

  let stream = null;
  let lastError = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const waitMs = i === 0 ? 8000 : 2000;
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

  camEl.srcObject = stream;
  // iOS can hang forever on await video.play() — never block the field on it
  try {
    const playPromise = camEl.play();
    if (playPromise && typeof playPromise.then === "function") {
      await Promise.race([
        playPromise,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
  } catch {
    // Autoplay quirks — stream is still attached; frames usually appear anyway
  }
}

async function requestMotionPermission() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

function enableOrientation() {
  const onOrient = (event) => {
    if (state.watching) return;
    if (event.alpha == null || event.beta == null || event.gamma == null) return;
    state.hasGyro = true;
    // iOS exposes a true compass heading; absolute Android events encode it
    // in alpha (0 = facing north → heading = 360 - alpha)
    let compass = null;
    if (typeof event.webkitCompassHeading === "number" && event.webkitCompassHeading >= 0) {
      compass = event.webkitCompassHeading;
    } else if (event.absolute === true) {
      compass = (360 - event.alpha) % 360;
    }
    setDeviceQuaternion(event.alpha, event.beta, event.gamma, compass);
  };

  let listening = false;
  const start = (type) => {
    if (listening) return;
    listening = true;
    window.addEventListener(type, onOrient, true);
  };

  if ("ondeviceorientationabsolute" in window) {
    const absHandler = (event) => {
      window.removeEventListener("deviceorientationabsolute", absHandler, true);
      start("deviceorientationabsolute");
      onOrient(event);
    };
    window.addEventListener("deviceorientationabsolute", absHandler, true);
    // Fallback if absolute never arrives (common on some phones)
    setTimeout(() => {
      if (!listening) start("deviceorientation");
    }, 1200);
  } else {
    start("deviceorientation");
  }
}

function bindLookControls() {
  const pointers = new Map();
  let ptrStart = null;
  let ptrMoved = false;
  let pinching = false;
  let pinchStartDist = 0;
  let pinchStartFov = LOOK_FOV_DEFAULT;

  const pinchDist = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const applyPinchZoom = () => {
    if (!camera || pointers.size < 2 || pinchStartDist < 8) return;
    const d = pinchDist();
    if (d < 8) return;
    state.fovPinched = true;
    camera.fov = THREE.MathUtils.clamp(
      pinchStartFov * (pinchStartDist / d),
      LOOK_FOV_MIN,
      state.cameraLayout === "carousel" ? CAROUSEL_FOV_MAX : LOOK_FOV_MAX
    );
    camera.updateProjectionMatrix();
  };

  const onDown = (id, x, y) => {
    if (state.watching || state.mapOpen || !state.booted) return;
    pointers.set(id, { x, y });
    if (pointers.size === 1) {
      pinching = false;
      state.dragging = true;
      state.lastX = x;
      state.lastY = y;
      ptrStart = { x, y, t: performance.now() };
      ptrMoved = false;
      return;
    }
    if (pointers.size === 2) {
      pinching = true;
      state.dragging = false;
      ptrMoved = true;
      pinchStartDist = pinchDist();
      pinchStartFov = camera?.fov ?? LOOK_FOV_DEFAULT;
    }
  };

  const onMove = (id, x, y) => {
    const prev = pointers.get(id);
    if (!prev) return;
    pointers.set(id, { x, y });
    if (state.watching) return;
    if (pointers.size >= 2 && pinching) {
      applyPinchZoom();
      return;
    }
    if (pointers.size !== 1 || !state.dragging || pinching) return;
    if (ptrStart && Math.hypot(x - ptrStart.x, y - ptrStart.y) > 10) {
      ptrMoved = true;
    }
    // Horizontal only. In carousel, drag turns you inside the ring
    // so the photos follow the finger; in place mode, drag looks around.
    const dx = (x - prev.x) * 0.005;
    if (state.cameraLayout === "carousel") {
      state.offsetYaw += dx;
      state.carouselDragY += carouselDragLiftDelta(y - prev.y) * CAROUSEL_DRAG_LIFT;
      state.carouselDragY = THREE.MathUtils.clamp(
        state.carouselDragY,
        CAROUSEL_DRAG_Y_MIN,
        CAROUSEL_DRAG_Y_MAX
      );
    } else {
      state.offsetYaw -= dx;
    }
  };

  const onUp = (id, x, y) => {
    if (!pointers.has(id)) return;
    pointers.delete(id);
    if (pointers.size >= 2) return;
    if (pointers.size === 1) {
      pinching = false;
      const left = [...pointers.values()][0];
      state.dragging = true;
      state.lastX = left.x;
      state.lastY = left.y;
      return;
    }
    const didPinch = pinching;
    pinching = false;
    state.dragging = false;
    if (state.watching || !ptrStart || didPinch) {
      ptrStart = null;
      return;
    }
    const dt = performance.now() - ptrStart.t;
    const dist = Math.hypot(x - ptrStart.x, y - ptrStart.y);
    const wasTap = !ptrMoved && dist < 14 && dt < 500;
    ptrStart = null;
    if (!wasTap) return;

    const node = pickNodeAt(x, y) || pickCenter() || state.focused;
    if (node) openTheater(node);
    else setStatus("Tap a clip to watch", 3200);
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    onDown(e.pointerId, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    onMove(e.pointerId, e.clientX, e.clientY);
  });
  const onPointerEnd = (e) => {
    if (e.pointerType === "touch") return;
    onUp(e.pointerId, e.clientX, e.clientY);
  };
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (state.watching || state.mapOpen) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        onDown(`t${t.identifier}`, t.clientX, t.clientY);
      }
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        onMove(`t${t.identifier}`, t.clientX, t.clientY);
      }
    },
    { passive: false }
  );
  const onTouchEnd = (e) => {
    for (const t of e.changedTouches) {
      onUp(`t${t.identifier}`, t.clientX, t.clientY);
    }
  };
  canvas.addEventListener("touchend", onTouchEnd);
  canvas.addEventListener("touchcancel", onTouchEnd);
}

/** Prefer a direct hit on a pin screen/label when the user taps. */
function pickNodeAt(clientX, clientY) {
  if (!camera || !renderer || !state.nodes.length) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointerNdc, camera);

  const hitMeshes = [];
  for (const node of state.nodes) {
    if (!node.group?.visible) continue;
    if (node.lat != null && !node.inRange) continue;
    if (node.screen) hitMeshes.push(node.screen);
    if (node.label) hitMeshes.push(node.label);
    if (node.frame?.visible) hitMeshes.push(node.frame);
  }
  if (!hitMeshes.length) return null;

  const hits = _raycaster.intersectObjects(hitMeshes, false);
  if (!hits.length) return null;
  const mesh = hits[0].object;
  return (
    state.nodes.find(
      (n) => n.screen === mesh || n.label === mesh || n.frame === mesh
    ) || null
  );
}

function resolveWatchNode() {
  return state.focused || pickCenter();
}

function onResize() {
  if (!camera || !renderer) return;
  state.carouselViewH = 0;
  camera.aspect = window.innerWidth / window.innerHeight;
  applyLayoutFov();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// —— Hand gestures: thumbs-up reacts on the focused video ——
let handLandmarker = null;
let handLoadPromise = null;
let lastHandVideoTs = -1;
let lastHandCheckAt = 0;
let lastThumbUpAt = 0;
let thumbGestureArmed = true;

async function ensureHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  if (handLoadPromise) return handLoadPromise;
  handLoadPromise = (async () => {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm"
    );
    const vision = await mod.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
    );
    const options = {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    };

    // GPU fails on many iPhones — fall back to CPU
    try {
      options.baseOptions.delegate = "GPU";
      handLandmarker = await mod.HandLandmarker.createFromOptions(vision, options);
    } catch (gpuErr) {
      console.warn("Hand landmarker GPU unavailable, using CPU", gpuErr);
      options.baseOptions.delegate = "CPU";
      handLandmarker = await mod.HandLandmarker.createFromOptions(vision, options);
    }
    return handLandmarker;
  })().catch((err) => {
    console.warn("Hand landmarker unavailable", err);
    handLoadPromise = null;
    return null;
  });
  return handLoadPromise;
}

function landmarkDist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Landmark thumbs-up: thumb up, other fingertips curled. */
function isThumbsUpPose(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const thumbMcp = landmarks[2];
  const indexMcp = landmarks[5];
  const wrist = landmarks[0];

  const thumbLen = landmarkDist2d(thumbMcp, thumbTip);
  if (thumbLen < 0.06) return false;

  // Thumb tip is the highest fingertip (image y grows downward)
  const otherTips = [8, 12, 16, 20].map((i) => landmarks[i]);
  const thumbHighest = otherTips.every((t) => thumbTip.y < t.y - 0.02);
  const thumbExtended = thumbTip.y < thumbIp.y && thumbTip.y < thumbMcp.y;

  // Other fingers curled: tip below its PIP
  const curled = [8, 12, 16, 20].every((tipIdx) => {
    const tip = landmarks[tipIdx];
    const pip = landmarks[tipIdx - 2];
    return tip.y > pip.y - 0.01;
  });

  // Thumb away from the index tip
  const notPinching = landmarkDist2d(thumbTip, landmarks[8]) > 0.12;

  // Palm roughly facing camera (wrist below knuckles)
  const palmUp = wrist.y > indexMcp.y;

  return thumbHighest && thumbExtended && curled && notPinching && palmUp;
}

function updateHandGestures(nowMs) {
  if (!handLandmarker || !camEl) return;
  if (state.watching || state.mapOpen || state.booting || state.naming) return;
  if (camEl.readyState < 2 || !camEl.videoWidth) return;
  if (nowMs - lastHandCheckAt < 66) return; // ~15 fps
  lastHandCheckAt = nowMs;

  let ts = nowMs;
  if (ts <= lastHandVideoTs) ts = lastHandVideoTs + 1;
  lastHandVideoTs = ts;

  let result;
  try {
    result = handLandmarker.detectForVideo(camEl, ts);
  } catch {
    return;
  }

  const landmarks = result?.landmarks?.[0];
  if (!landmarks) {
    thumbGestureArmed = true;
    return;
  }

  if (!state.focused || !state.focused.group?.visible) {
    thumbGestureArmed = true;
    return;
  }

  const isThumb = isThumbsUpPose(landmarks);
  if (!isThumb) {
    thumbGestureArmed = true;
    return;
  }

  if (!thumbGestureArmed || nowMs - lastThumbUpAt < 1600) return;
  thumbGestureArmed = false;
  lastThumbUpAt = nowMs;
  addThumbsUp(state.focused);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, state.clock.getDelta());
  const t = state.clock.elapsedTime;
  updateCameraRig(dt);
  updateNodes(t, dt);
  updateRadar();
  updateGuideArrow();
  updateMapView();
  if (state.mapOpen && t - state.mapListAt > 1.25) {
    state.mapListAt = t;
    refreshMapList();
  }
  // Keep geo pins synced if watch hasn't fired yet
  if (state.userGeo) updateGeoAnchors();

  if (!state.watching) {
    const node = pickCenter();
    if (node !== state.focused) setFocus(node);
  }

  updateHandGestures(performance.now());
  positionDeleteBtn();
  renderer.render(scene, camera);
}

function bootField(message) {
  if (state.booted) {
    setStatus(message);
    return;
  }
  state.booted = true;

  try {
    buildScene();
  } catch (err) {
    console.error(err);
    setStatus("3D view failed — try refreshing");
  }

  bindLookControls();
  enableOrientation();
  state.carouselPitchBaseline = null;
  state.carouselTiltT = 0;
  window.addEventListener("resize", onResize);

  setAddMediaLoading(true);
  gate.hidden = true;
  gate.setAttribute("aria-hidden", "true");
  gate.style.display = "none";
  field.hidden = false;
  field.removeAttribute("hidden");
  field.style.display = "block";

  if (renderer) animate();
  setStatus(message);
  if (camEl.srcObject) {
    camEl.play().catch(() => {});
  }
  // Warm the hand tracker in the background
  ensureHandLandmarker().catch(() => {});

  if (state.pendingUploads.length) {
    state.nameQueue.push(...state.pendingUploads.splice(0));
    updateUploadNote(0);
  }

  (async () => {
    setAddMediaLoading(true);
    try {
      const geo = await readGps();
      state.userGeo = geo;
      state.originGeo = geo;
      if (state.viewFollowsUser) state.viewGeo = { lat: geo.lat, lng: geo.lng };
      startGeoWatch();
      anchorDemoVideosToLaunch();
      lookupPlace(geo.lat, geo.lng);
      updateGeoAnchors();
    } catch (err) {
      console.warn(err);
      setStatus("Enable location to pin videos within 25 ft", 4500);
    }
    setAddMediaLoading(false);
    // Videos come from the phone library — pick on open, or process a prior selection.
    if (state.nameQueue.length) {
      await processNameQueue();
    } else {
      openLibraryPick();
    }
  })();
}

/** Load everyone's shared pins from the cloud into the field. */
async function syncSharedSpots() {
  if (!cloudConfigured() || !scene) {
    setAddMediaLoading(false);
    return;
  }

  setAddMediaLoading(true);
  let rows = [];
  try {
    rows = await loadSpots();
  } catch (err) {
    console.warn(err);
    setAddMediaLoading(false);
    return;
  }

  const origin = state.userGeo || state.originGeo;
  let added = 0;

  for (const row of rows) {
    const nodeId = `spot-${row.id}`;
    if (state.nodes.some((n) => n.id === nodeId)) continue;
    // Skip clips this session already shows as freshly published uploads
    if (state.nodes.some((n) => n.cloudId === row.id)) continue;
    if (row.lat == null || row.lng == null || !row.video_path) continue;

    let position = [0, 1.4, -3.5];
    if (origin) {
      const enu = enuFromOrigin(origin.lat, origin.lng, row.lat, row.lng);
      position = [enu.x, 1.4, enu.z];
    }

    const isOwner = Boolean(row.owner) && row.owner === getDeviceId();
    const node = createNode(
      {
        id: nodeId,
        title: row.title || "Shared clip",
        blurb: isOwner ? "Your pin" : "Shared pin",
        src: videoUrl(row.video_path),
        position,
        // Own pins can be removed locally; cloud wipe needs a delete token
        // (available briefly after upload). Others stay view-only.
        deletable: isOwner,
        lat: row.lat,
        lng: row.lng,
        takenAt: row.takenAt || null,
        inRange: false,
        cloudId: row.id,
        storagePath: row.video_path,
        owner: row.owner || "",
      },
      state.nodes.length
    );
    state.nodes.push(node);
    added += 1;
  }

  if (added) {
    updateGeoAnchors();
    if (state.mapOpen) {
      refreshMapList();
      syncLeafletMarkers();
      if (state.viewFollowsUser) fitMapToPins();
    }
  }
  await Promise.all(viewClipNodes().map((n) => waitForNodePoster(n)));
  setAddMediaLoading(false);
}

function enterField() {
  if (state.booting || state.booted) return;
  state.booting = true;

  // Safari drops the user-gesture if we disable the button or await
  // before getUserMedia / DeviceOrientation.requestPermission.
  const motionP = requestMotionPermission().catch(() => false);
  const cameraP = startCamera()
    .then(() => true)
    .catch((err) => {
      console.error(err);
      if (camEl) {
        camEl.style.background =
          "radial-gradient(circle at 30% 20%, #2a2a2a, #000000 60%)";
      }
      return false;
    });

  if (enterBtn) enterBtn.textContent = "Opening…";

  (async () => {
    try {
      const motionOk = await Promise.race([
        motionP,
        new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
      ]);
      const cameraOk = await cameraP;
      if (!motionOk) {
        setStatus("Allow motion access for world-locked AR", 4200);
      }
      bootField(
        cameraOk
          ? motionOk
            ? ""
            : "Motion blocked — drag to look"
          : "Camera blocked — drag to explore demo videos"
      );
    } catch (err) {
      console.error(err);
      if (!state.booted) {
        bootField("Could not open the lens — try again");
      }
    } finally {
      state.booting = false;
      if (!state.booted && enterBtn) {
        enterBtn.disabled = false;
        enterBtn.textContent = "Open lens";
      }
    }
  })();
}

enterBtn.addEventListener("click", enterField);
enterBtn.addEventListener("pointerup", enterField);
enterBtn.addEventListener("touchend", enterField, { passive: false });
watchBtn?.addEventListener("click", () => {
  const node = resolveWatchNode();
  if (node) openTheater(node);
  else setStatus("Tap a clip to watch", 3200);
});
theaterClose.addEventListener("click", closeTheaterMode);
theaterDone?.addEventListener("click", closeTheaterMode);
theaterVideo.addEventListener("click", () => {
  if (theaterVideo.paused) {
    theaterVideo.play().catch(() => {});
  } else if (theaterVideo.muted) {
    theaterVideo.muted = false;
  }
});
theaterVideo.addEventListener("loadedmetadata", () => {
  const w = theaterVideo.videoWidth;
  const h = theaterVideo.videoHeight;
  if (w > 1 && h > 1) theaterVideo.style.aspectRatio = `${w} / ${h}`;
});
radar?.addEventListener("click", (e) => {
  e.stopPropagation();
  openMapModal();
});
fieldLocate?.addEventListener("click", (e) => {
  e.stopPropagation();
  recenterOnUser();
});
townSlot?.addEventListener("pointerdown", (e) => e.stopPropagation());
townSlot?.addEventListener("touchstart", (e) => e.stopPropagation(), {
  passive: true,
});
townSlot?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  openMapModal();
});
mapClose?.addEventListener("click", closeMapModal);
mapBackdrop?.addEventListener("click", closeMapModal);

function updateUploadNote(count) {
  if (!uploadNote) return;
  if (!count) {
    uploadNote.hidden = true;
    uploadNote.textContent = "";
    return;
  }
  uploadNote.hidden = false;
  uploadNote.textContent =
    count === 1
      ? "1 video selected — Open lens to place it"
      : `${count} videos selected — Open lens to place them`;
}

// —— Content-aware default names (MobileNet, lazy-loaded) ——
let visionModelPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadVisionModel() {
  if (!visionModelPromise) {
    visionModelPromise = (async () => {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
      );
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js"
      );
      return window.mobilenet.load({ version: 2, alpha: 0.5 });
    })().catch((err) => {
      visionModelPromise = null;
      throw err;
    });
  }
  return visionModelPromise;
}

/** Grab a representative frame as a square canvas for classification. */
function grabVideoFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error("Frame grab failed"));
    };
    const timer = setTimeout(() => fail(new Error("Frame grab timed out")), 6000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("error", () => {
      clearTimeout(timer);
      fail(video.error || new Error("Video decode failed"));
    });
    video.addEventListener(
      "loadeddata",
      () => {
        const finish = () => {
          if (settled) return;
          try {
            const size = 224;
            const c = document.createElement("canvas");
            c.width = size;
            c.height = size;
            const ctx = c.getContext("2d");
            const vw = video.videoWidth || size;
            const vh = video.videoHeight || size;
            const s = Math.min(vw, vh);
            ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, size, size);
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(c);
          } catch (err) {
            clearTimeout(timer);
            fail(err);
          }
        };
        const target = Math.min(0.6, (video.duration || 1) * 0.25);
        video.addEventListener("seeked", finish, { once: true });
        try {
          video.currentTime = target;
        } catch {
          finish();
        }
      },
      { once: true }
    );
    video.src = url;
  });
}

function titleCase(text) {
  return text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

async function suggestVideoName(file) {
  const frame = await grabVideoFrame(file);
  const model = await loadVisionModel();
  const preds = await model.classify(frame);
  const label = preds?.[0]?.className?.split(",")[0]?.trim();
  if (!label) throw new Error("No label from classifier");
  return titleCase(label).slice(0, 40);
}

function fallbackName(takenAt) {
  const d = takenAt ? new Date(takenAt) : new Date();
  if (Number.isNaN(d.getTime())) return fallbackName();
  if (takenAt) {
    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `Clip ${date}`;
  }
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Clip ${time}`;
}

function focusNameInput() {
  nameInput.focus();
  nameInput.select();
  try {
    nameInput.setSelectionRange(0, nameInput.value.length);
  } catch {
    /* selection not supported */
  }
}

function openNameModal(file, meta = {}, source = "capture") {
  return new Promise((resolve) => {
    state.naming = true;
    const takenLabel = formatTakenLabel(meta.takenAt);
    nameFile.textContent = takenLabel
      ? `${file.name || "Video"} · ${takenLabel}`
      : file.name || "Video";
    nameInput.value = fallbackName(meta.takenAt);
    const hasGps = Number.isFinite(meta.lat) && Number.isFinite(meta.lng);
    if (nameHint) {
      nameHint.textContent =
        source === "album" && hasGps
          ? "Pinned at the place and date stored on this video."
          : source === "album"
            ? "No location on this video — it will pin where you are now."
            : "Visible when you’re within 25 feet and aim at it from any direction.";
    }
    if (nameSubmit) {
      nameSubmit.textContent =
        source === "album" && hasGps ? "Pin where filmed" : "Pin here";
    }
    nameModal.hidden = false;
    // Focus synchronously — iOS only shows the keyboard inside a user gesture
    focusNameInput();

    let userTyped = false;
    const markTyped = () => {
      userTyped = true;
    };
    nameInput.addEventListener("input", markTyped);

    // Swap in a name from what's actually in the video, unless the user typed
    suggestVideoName(file)
      .then((name) => {
        if (!userTyped && !nameModal.hidden) {
          nameInput.value = name;
          focusNameInput();
        }
      })
      .catch((err) => console.warn("Name suggestion failed", err));

    const cleanup = () => {
      nameForm.removeEventListener("submit", onSubmit);
      nameCancel.removeEventListener("click", onCancel);
      nameInput.removeEventListener("input", markTyped);
      nameModal.hidden = true;
      state.naming = false;
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onSubmit = (e) => {
      e.preventDefault();
      const name = nameInput.value.trim().slice(0, 80);
      if (!name) return;
      cleanup();
      resolve(name);
    };

    nameForm.addEventListener("submit", onSubmit);
    nameCancel.addEventListener("click", onCancel);
  });
}

async function placeNamedVideo(file, name, opts = {}) {
  state.uploadCount += 1;
  const url = URL.createObjectURL(file);
  const takenAt = opts.takenAt || new Date().toISOString();
  const recordedGps =
    Number.isFinite(opts.lat) && Number.isFinite(opts.lng)
      ? { lat: opts.lat, lng: opts.lng }
      : null;

  let geo = state.userGeo || state.originGeo;
  if (!geo) {
    try {
      geo = await readGps();
      state.userGeo = geo;
      state.originGeo = state.originGeo || geo;
      startGeoWatch();
    } catch (err) {
      console.warn(err);
      setStatus("Location permission needed to geo-pin videos", 4200);
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  let position;
  let pinGeo;
  let worldLocked;
  if (recordedGps) {
    // Album clips stay at the filmed GPS as the user walks.
    pinGeo = recordedGps;
    worldLocked = false;
    const enu = enuFromOrigin(geo.lat, geo.lng, pinGeo.lat, pinGeo.lng);
    position = [enu.x, 1.4, enu.z];
  } else {
    // Place in the direction the phone is aimed right now (visual world lock).
    // GPS stores the pin's ground location for range checks and the field map.
    position = placementAlongLook(3.2);
    const aim = aimMetersOnGround(3.2);
    pinGeo = offsetLatLng(geo.lat, geo.lng, aim.east, aim.north);
    worldLocked = true;
  }

  const takenLabel = formatTakenLabel(takenAt);
  const node = createNode(
    {
      id: `upload-${state.uploadCount}`,
      title: name,
      blurb: takenLabel
        ? `Within 25 ft · ${takenLabel}`
        : "Within 25 ft · aim from any side",
      src: url,
      position,
      objectUrl: url,
      deletable: true,
      lat: pinGeo.lat,
      lng: pinGeo.lng,
      takenAt,
      fromAlbum: Boolean(opts.fromAlbum),
      inRange: true,
      worldLocked,
    },
    state.nodes.length
  );
  state.nodes.push(node);
  updateGeoAnchors();
  if (state.mapOpen) {
    refreshMapList();
    syncLeafletMarkers();
  }
  if (recordedGps) {
    setStatus(`“${name}” pinned where it was filmed`);
  } else if (opts.fromAlbum) {
    setStatus(`“${name}” has no location — pinned where you are`);
  } else {
    setStatus(`“${name}” pinned where you’re aiming`);
  }

  // Map-list thumbnail for this fresh pick
  grabVideoFrame(file)
    .then((frame) => {
      node.thumbUrl = frame.toDataURL("image/jpeg", 0.65);
      applyPosterTexture(node, videoPosterSrc(node));
      if (state.mapOpen) refreshMapList();
    })
    .catch(() => {});

  // Optional shared-world publish when Cloudinary is configured in config.js
  if (cloudConfigured()) {
    showUploadOverlay("Uploading", `Sending “${name}”…`);
    try {
      const res = await publishSpot(file, {
        title: name,
        lat: pinGeo.lat,
        lng: pinGeo.lng,
        owner: getDeviceId(),
        takenAt,
      });
      node.cloudId = res.id;
      node.storagePath = res.path;
      node.deleteToken = res.deleteToken;
      applyPosterTexture(node, videoPosterSrc(node));
      setStatus(`“${name}” shared — anyone here can watch it`);
    } catch (err) {
      console.warn(err);
      setStatus("Couldn’t publish — clip stays on this phone", 4200);
    }
  }

  return node;
}

/** Pull a short display title out of a create prompt. */
function titleFromCreatePrompt(prompt) {
  let t = String(prompt || "").trim();
  t = t.replace(/^(please\s+)?(create|make|generate|draw|show|add)\s+(me\s+)?(a|an|the)\s+/i, "");
  t = t.replace(/^(please\s+)?(create|make|generate|draw|show|add)\s+/i, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "Creation";
  return t.charAt(0).toUpperCase() + t.slice(1).slice(0, 47);
}

function buildCreatePrompt(subject) {
  const flying = isFlyingSubject(subject);
  const pose = flying
    ? "photographed in flight, airborne, wings spread, not perched"
    : "standing naturally, full body from head to feet";
  return [
    `photorealistic photograph of ${subject}`,
    pose,
    "ultra realistic, real-world materials and textures, natural color",
    "natural lighting, sharp focus, 85mm lens",
    "full body visible, subject centered",
    "isolated on a pure white background",
    "no shadow, no ground plane, no studio backdrop visible",
    "no text, no watermark, no logo",
    "not illustration, not cartoon, not 3d render, not cgi",
  ].join(", ");
}

function buildCreateImageUrl(subject) {
  const prompt = buildCreatePrompt(subject);
  const seed = Math.floor(Math.random() * 1e9);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?model=flux&width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;
}

async function waitForPuter(ms = 2800) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    if (typeof window.puter?.ai?.txt2img === "function") return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return typeof window.puter?.ai?.txt2img === "function";
}

function srcFromGeneratedImage(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.src === "string" && result.src) return result.src;
  return "";
}

/** GPT Image 2 via Puter — photoreal, no API key in this app. */
async function generateWithGptImage(promptText) {
  const ready = await waitForPuter();
  if (!ready) throw new Error("GPT Image unavailable");
  const result = await withTimeout(
    window.puter.ai.txt2img(promptText, {
      model: "gpt-image-2",
      quality: "high",
    }),
    80000,
    "Create timed out — try again"
  );
  const src = srcFromGeneratedImage(result);
  if (!src) throw new Error("GPT Image returned no picture");
  return src;
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(src).startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

function withTimeout(promise, ms, label = "Timed out") {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      }
    );
  });
}

/**
 * Knock out near-white (and sampled corner) background so the creation
 * floats over the camera feed like a sticker.
 */
async function cutoutTransparentPng(sourceUrl) {
  const img = await loadHtmlImage(sourceUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return { canvas, img };
  }
  const d = imageData.data;

  const sample = (x, y) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const corners = [
    sample(2, 2),
    sample(w - 3, 2),
    sample(2, h - 3),
    sample(w - 3, h - 3),
  ];
  const bg = corners
    .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
    .map((v) => v / corners.length);

  const dist = (r, g, b) => Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  const isBg = (r, g, b) => {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return dist(r, g, b) < 48 || (luma > 235 && dist(r, g, b) < 90);
  };

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (isBg(r, g, b)) {
      d[i + 3] = 0;
      continue;
    }
    const dd = dist(r, g, b);
    if (dd < 78) {
      d[i + 3] = Math.max(0, Math.min(255, Math.round(((dd - 48) / 30) * 255)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, img };
}

/** Local flipbook: warp one cutout into a looping idle animation. */
async function synthesizeAnimFrames(sourceCanvas, frameCount = 6) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const src = sourceCanvas.getContext("2d").getImageData(0, 0, w, h);
  const animFrames = [];
  const animUrls = [];

  for (let f = 0; f < frameCount; f += 1) {
    const phase = (f / frameCount) * Math.PI * 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(w, h);
    const amp = Math.max(4, Math.round(w * 0.028));

    for (let y = 0; y < h; y += 1) {
      const wave =
        Math.sin((y / h) * Math.PI * 3 + phase) * amp +
        Math.sin((y / h) * Math.PI + phase * 1.4) * (amp * 0.35);
      const shift = Math.round(wave);
      for (let x = 0; x < w; x += 1) {
        const sx = Math.min(w - 1, Math.max(0, x - shift));
        const si = (y * w + sx) * 4;
        const di = (y * w + x) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn’t encode frame"))),
        "image/png"
      );
    });
    const url = URL.createObjectURL(blob);
    const img = await loadHtmlImage(url);
    animFrames.push(img);
    animUrls.push(url);
  }

  return { animFrames, animUrls, src: animUrls[0] };
}

function setCreateProgress(pct, message) {
  if (createProgress) createProgress.hidden = false;
  if (createProgressFill) {
    createProgressFill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  }
  if (createStatus) createStatus.textContent = message || "";
}

/** GPT Image 2, with a Pollinations photo fallback. */
async function generateCreationAnim(prompt, onProgress) {
  const subject = titleFromCreatePrompt(prompt);
  const photoPrompt = buildCreatePrompt(subject);
  let rawUrl = "";
  let revoke = false;

  try {
    onProgress?.(8, "Photographing with GPT Image…");
    try {
      rawUrl = await generateWithGptImage(photoPrompt);
    } catch (err) {
      console.warn(err);
      onProgress?.(16, "Trying a backup photo model…");
      const url = buildCreateImageUrl(subject);
      const res = await withTimeout(
        fetch(url, { mode: "cors" }),
        40000,
        "Create timed out — try again"
      );
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      onProgress?.(35, "Downloading…");
      const raw = await withTimeout(res.blob(), 20000, "Download timed out");
      rawUrl = URL.createObjectURL(raw);
      revoke = true;
    }

    onProgress?.(55, "Cutting out the background…");
    const { canvas } = await cutoutTransparentPng(rawUrl);
    onProgress?.(72, "Animating…");
    const anim = await synthesizeAnimFrames(canvas, 6);
    onProgress?.(92, "Pinning…");
    return { title: subject, ...anim };
  } finally {
    if (revoke && rawUrl) URL.revokeObjectURL(rawUrl);
  }
}

async function placeNamedCreation(creation) {
  state.uploadCount += 1;
  const { title: name, animFrames, animUrls, src } = creation;

  let geo = state.userGeo || state.originGeo;
  if (!geo) {
    try {
      geo = await readGps();
      state.userGeo = geo;
      state.originGeo = state.originGeo || geo;
      startGeoWatch();
    } catch (err) {
      console.warn(err);
      setStatus("Location permission needed to geo-pin creations", 4200);
      throw err;
    }
  }

  const flying = isFlyingSubject(name);
  const spawnY = flying ? 2.72 : (camera?.position.y ?? 1.4) + 1.05;
  const position = placementAlongLook(3.2, spawnY);
  const aim = aimMetersOnGround(3.2);
  const pinGeo = offsetLatLng(geo.lat, geo.lng, aim.east, aim.north);

  const node = createNode(
    {
      id: `create-${state.uploadCount}`,
      kind: "image",
      title: name,
      blurb: flying ? "Flying above · aim from any side" : "On the ground · aim from any side",
      src,
      animFrames,
      animUrls,
      position,
      flying,
      settled: flying,
      deletable: true,
      lat: pinGeo.lat,
      lng: pinGeo.lng,
      inRange: true,
      worldLocked: true,
    },
    state.nodes.length
  );
  state.nodes.push(node);
  updateGeoAnchors();
  if (state.mapOpen) {
    refreshMapList();
    syncLeafletMarkers();
  }
  node.thumbUrl = src;
  setFocus(node);
  setStatus(
    flying ? `“${name}” is flying where you’re aiming` : `“${name}” landed where you’re aiming`
  );
  return node;
}

function closeAddModal() {
  if (addModal) addModal.hidden = true;
}

function openLibraryPick() {
  if (!libraryPick) return;
  if (state.watching || state.naming) return;
  closeAddModal();
  closeFilterSheets();
  closeCreateModal(true);
  libraryPick.hidden = false;
  if (addBtn) addBtn.disabled = true;
}

function closeLibraryPick() {
  if (libraryPick) libraryPick.hidden = true;
  if (addBtn && !state.mediaLoading) addBtn.disabled = false;
}

function openAddModal() {
  if (!addModal) return;
  if (state.watching || state.naming) return;
  if (libraryPick && !libraryPick.hidden) return;
  closeFilterSheets();
  closeCreateModal(true);
  closeLibraryPick();
  addModal.hidden = false;
}

function closeCreateModal(silent = false) {
  if (!createModal) return;
  createModal.hidden = true;
  if (createProgress) createProgress.hidden = true;
  if (createProgressFill) createProgressFill.style.width = "8%";
  if (createStatus) createStatus.textContent = "";
  if (createSubmit) {
    createSubmit.disabled = false;
    createSubmit.textContent = "Create here";
  }
  if (createInput) createInput.disabled = false;
  if (createCancel) createCancel.disabled = false;
  if (!silent && createInput) createInput.value = "";
}

function openCreateModal() {
  if (!state.showCreate) return;
  if (!createModal) return;
  closeAddModal();
  if (createProgress) createProgress.hidden = true;
  if (createProgressFill) createProgressFill.style.width = "8%";
  if (createStatus) createStatus.textContent = "";
  if (createSubmit) {
    createSubmit.disabled = false;
    createSubmit.textContent = "Create here";
  }
  if (createInput) {
    createInput.disabled = false;
    createInput.value = createInput.value || "";
  }
  if (createCancel) createCancel.disabled = false;
  createModal.hidden = false;
  // Focus after paint so iOS shows the keyboard
  requestAnimationFrame(() => createInput?.focus());
}

async function processNameQueue() {
  if (state.naming) return;
  const total = state.nameQueue.length;
  let index = 0;
  while (state.nameQueue.length) {
    if (!state.booted || !scene) break;
    const item = state.nameQueue.shift();
    const file = item?.file || item;
    if (!file) continue;
    index += 1;
    const source = item?.source || "album";
    const batch = total > 1 ? ` (${index} of ${total})` : "";
    let meta = item?.meta || { lat: null, lng: null, takenAt: null };
    if (source === "album" && !item?.meta) {
      showUploadOverlay(
        "Reading video",
        `Finding where it was filmed${batch}…`
      );
      meta = await readVideoCaptureMeta(file);
    }
    if (!meta.takenAt) {
      meta.takenAt = file.lastModified
        ? new Date(file.lastModified).toISOString()
        : new Date().toISOString();
    }

    let name;
    if (source === "album") {
      // Album picks go straight into the field — no rename / cloud upload step.
      name = titleFromAlbumFile(file);
      showUploadOverlay("Opening", `Placing “${name}”${batch}…`);
    } else {
      hideUploadOverlay();
      name = await openNameModal(file, meta, source);
      if (!name) continue;
      showUploadOverlay(
        cloudConfigured() ? "Uploading" : "Opening",
        cloudConfigured()
          ? `Sending “${name}”${batch}…`
          : `Placing “${name}”${batch}…`
      );
    }

    try {
      await placeNamedVideo(file, name, {
        lat: meta.lat,
        lng: meta.lng,
        takenAt: meta.takenAt,
        fromAlbum: source === "album",
      });
    } catch (err) {
      console.error(err);
    } finally {
      hideUploadOverlay();
    }
  }
  hideUploadOverlay();
  updateUploadNote(state.nameQueue.length + state.pendingUploads.length);
}

function titleFromAlbumFile(file) {
  const raw = String(file?.name || "Video")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Video";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isVideoFile(file) {
  if (file?.type?.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|qt|webm|mkv)$/i.test(file?.name || "");
}

function addUploadedFiles(fileList, source = "album") {
  const files = [...fileList].filter(isVideoFile);
  if (!files.length) {
    setStatus("Pick video files (mp4, mov, etc.)");
    return 0;
  }

  const items = files.map((file) => ({ file, source }));
  closeLibraryPick();

  // Warm the classifier so capture naming stays snappy when used
  loadVisionModel().catch(() => {});

  if (!state.booted || !scene) {
    state.pendingUploads.push(...items);
    updateUploadNote(state.pendingUploads.length);
    setStatus(
      files.length === 1
        ? "Video selected — Open lens to place it"
        : `${files.length} videos selected — Open lens to place them`
    );
    return files.length;
  }

  showUploadOverlay(
    "Opening",
    files.length === 1
      ? "Opening your video…"
      : `Preparing ${files.length} videos…`
  );
  state.nameQueue.push(...items);
  processNameQueue();
  return files.length;
}

function onPickVideos(event) {
  const input = event.target;
  const source = input === videoInputCapture ? "capture" : "album";
  addUploadedFiles(input.files || [], source);
  input.value = "";
}

videoInputGate?.addEventListener("change", onPickVideos);
videoInputField?.addEventListener("change", onPickVideos);
videoInputCapture?.addEventListener("change", onPickVideos);

state.cameraRangeFt = loadCameraRangeFt();
syncRangeControls();
({ min: state.timeMinYr, max: state.timeMaxYr } = loadTimeRange());
syncTimeControls();
state.cameraLayout = loadCameraLayout();
syncLayoutControls();
state.videoSize = loadVideoSize();
syncVideoSizeControls();
state.showCreate = loadShowCreate();
syncShowCreateControls();

settingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (state.settingsOpen) closeSettingsModal();
  else openSettingsModal();
});
settingsClose?.addEventListener("click", closeSettingsModal);
settingsModal?.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});
rangeSlider?.addEventListener("input", () => {
  setCameraRangeFt(ftFromSliderPos(rangeSlider.value));
});
function onTimeSliderInput(which) {
  const rawMin = clampTimeYr(timeMinSlider?.value);
  const rawMax = clampTimeYr(timeMaxSlider?.value);
  let min = rawMin;
  let max = rawMax;
  if (which === "min" && min > state.timeMaxYr) min = state.timeMaxYr;
  if (which === "max" && max < state.timeMinYr) max = state.timeMinYr;
  if (timeMinSlider && timeMaxSlider) {
    timeMinSlider.classList.toggle("is-top", which === "min");
    timeMaxSlider.classList.toggle("is-top", which === "max");
  }
  setTimeRange(min, max);
}
timeMinSlider?.addEventListener("input", () => onTimeSliderInput("min"));
timeMaxSlider?.addEventListener("input", () => onTimeSliderInput("max"));
layoutPlaceBtn?.addEventListener("click", () => setCameraLayout("place"));
layoutCarouselBtn?.addEventListener("click", () => setCameraLayout("carousel"));
videoSizeLargeBtn?.addEventListener("click", () => setVideoSize("large"));
videoSizeSmallBtn?.addEventListener("click", () => setVideoSize("small"));
createSettingOffBtn?.addEventListener("click", () => setShowCreate(false));
createSettingOnBtn?.addEventListener("click", () => setShowCreate(true));

addBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (state.mediaLoading) return;
  openAddModal();
});
addClose?.addEventListener("click", closeAddModal);
addModal?.addEventListener("click", (e) => {
  if (e.target === addModal) closeAddModal();
});
libraryPickBtn?.addEventListener("click", () => {
  videoInputField?.click();
});
libraryPickSkip?.addEventListener("click", closeLibraryPick);
libraryPick?.addEventListener("click", (e) => {
  if (e.target === libraryPick) closeLibraryPick();
});
addCreate?.addEventListener("click", () => {
  openCreateModal();
});
addCapture?.addEventListener("click", () => {
  closeAddModal();
  videoInputCapture?.click();
});
addAlbum?.addEventListener("click", () => {
  closeAddModal();
  videoInputField?.click();
});
createCancel?.addEventListener("click", () => closeCreateModal());
createModal?.addEventListener("click", (e) => {
  if (e.target === createModal) closeCreateModal();
});
createForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = createInput?.value?.trim();
  if (!prompt) {
    createInput?.focus();
    return;
  }
  if (!state.booted || !scene) {
    setStatus("Open the lens first, then create");
    return;
  }
  if (createSubmit) {
    createSubmit.disabled = true;
    createSubmit.textContent = "Creating…";
  }
  if (createInput) createInput.disabled = true;
  if (createCancel) createCancel.disabled = true;
  setCreateProgress(6, "Starting…");
  setStatus("Creating…", 20000);
  try {
    const creation = await generateCreationAnim(prompt, (pct, msg) => {
      setCreateProgress(pct, msg);
      if (msg) setStatus(msg, 20000);
    });
    setCreateProgress(96, "Pinning…");
    await placeNamedCreation(creation);
    setCreateProgress(100, "Done");
    closeCreateModal();
  } catch (err) {
    console.warn(err);
    setCreateProgress(100, err?.message || "Couldn’t create — try again");
    setStatus(err?.message || "Couldn’t create that — try again", 4200);
    if (createSubmit) {
      createSubmit.disabled = false;
      createSubmit.textContent = "Create here";
    }
    if (createInput) createInput.disabled = false;
    if (createCancel) createCancel.disabled = false;
  }
});

// Desktop keyboard nudge
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.settingsOpen) {
      closeSettingsModal();
      return;
    }
    if (uploadOverlay && !uploadOverlay.hidden) return;
    if (confirmModal && !confirmModal.hidden) {
      closeConfirmModal();
      return;
    }
    if (createModal && !createModal.hidden) {
      closeCreateModal();
      return;
    }
    if (addModal && !addModal.hidden) {
      closeAddModal();
      return;
    }
    if (state.watching) {
      closeTheaterMode();
      return;
    }
    if (state.mapOpen) {
      closeMapModal();
      return;
    }
  }
  if (state.watching) return;
  const step = 0.08;
  if (e.key === "ArrowLeft") state.offsetYaw += step;
  if (e.key === "ArrowRight") state.offsetYaw -= step;
  if (state.cameraLayout === "carousel") {
    if (e.key === "ArrowUp") {
      state.carouselDragY += carouselDragLiftDelta(-48) * CAROUSEL_DRAG_LIFT;
    }
    if (e.key === "ArrowDown") {
      state.carouselDragY += carouselDragLiftDelta(48) * CAROUSEL_DRAG_LIFT;
    }
    state.carouselDragY = THREE.MathUtils.clamp(
      state.carouselDragY,
      CAROUSEL_DRAG_Y_MIN,
      CAROUSEL_DRAG_Y_MAX
    );
  } else {
    if (e.key === "ArrowUp") state.offsetPitch += step * 0.7;
    if (e.key === "ArrowDown") state.offsetPitch -= step * 0.7;
    state.offsetPitch = THREE.MathUtils.clamp(state.offsetPitch, -1.2, 1.2);
  }
  if (e.key === "Enter") {
    const node = resolveWatchNode();
    if (node) openTheater(node);
  }
});
