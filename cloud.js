// Shared-world sync via Cloudinary unsigned uploads.
// Videos are tagged, pin metadata (title/GPS/owner/place) rides in the context
// field. When Cloudinary "Resource list" is disabled (common on free plans),
// we also maintain a public raw JSON index + a localStorage cache so clips
// survive refresh without the restricted /list/ API.
import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  isCloudConfigured,
} from "./config.js";

const TAG = "lumen-spot";
const INDEX_ID = "lumen-spots-index";
const OVERRIDE_KEY = "lumen-admin-spot-overrides";
const LOCAL_SPOTS_KEY = "lumen-spots-cache";
const ADMIN_CREDS_KEY = "lumen-admin-cloud-creds";

export function cloudConfigured() {
  return isCloudConfigured();
}

export function getAdminCredentials() {
  if (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    return { key: CLOUDINARY_API_KEY, secret: CLOUDINARY_API_SECRET };
  }
  try {
    const raw = sessionStorage.getItem(ADMIN_CREDS_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data?.key && data?.secret) return { key: data.key, secret: data.secret };
  } catch {
    /* ignore */
  }
  return null;
}

export function setSessionAdminCredentials(key, secret) {
  const k = String(key || "").trim();
  const s = String(secret || "").trim();
  if (!k || !s) return false;
  try {
    sessionStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ key: k, secret: s }));
  } catch {
    /* ignore */
  }
  return true;
}

export function adminApiConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && getAdminCredentials());
}

export function deliveryVideoPath(path) {
  return String(path || "").replace(/\.\w+$/, ".mp4");
}

export function videoUrl(path) {
  const mp4Path = deliveryVideoPath(path);
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/${mp4Path}`;
}

/** Small poster frame Cloudinary renders from the video's first second. */
export function thumbUrl(path) {
  const jpg = String(path || "").replace(/\.\w+$/, ".jpg");
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_0,w_120,h_120,c_fill/${jpg}`;
}

/** Field-size still so clips are visible before a video frame decodes. */
export function posterUrl(path) {
  const jpg = String(path || "").replace(/\.\w+$/, ".jpg");
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_0,w_900,c_limit,q_auto/${jpg}`;
}

function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeOverrides(map) {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map || {}));
  } catch {
    /* ignore quota */
  }
}

export function saveSpotOverride(id, patch) {
  const key = String(id || "");
  if (!key) return;
  const all = readOverrides();
  all[key] = { ...(all[key] || {}), ...patch, id: key };
  writeOverrides(all);
}

export function clearSpotOverride(id) {
  const key = String(id || "");
  if (!key) return;
  const all = readOverrides();
  if (!all[key]) return;
  delete all[key];
  writeOverrides(all);
}

function readLocalSpotCache() {
  try {
    const raw = localStorage.getItem(LOCAL_SPOTS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeLocalSpotCache(map) {
  try {
    localStorage.setItem(LOCAL_SPOTS_KEY, JSON.stringify(map || {}));
  } catch {
    /* ignore */
  }
}

export function cacheSpotLocally(spot) {
  if (!spot?.id) return;
  const all = readLocalSpotCache();
  all[spot.id] = {
    id: spot.id,
    title: spot.title || "Shared clip",
    lat: spot.lat,
    lng: spot.lng,
    place: spot.place || "",
    owner: spot.owner || "",
    takenAt: spot.takenAt || null,
    thumbs: Math.max(0, Number(spot.thumbs) || 0),
    video_path: spot.video_path || spot.path || "",
  };
  writeLocalSpotCache(all);
}

export function removeCachedSpot(id) {
  const key = String(id || "");
  if (!key) return;
  const all = readLocalSpotCache();
  if (!all[key]) return;
  delete all[key];
  writeLocalSpotCache(all);
}

function applyOverride(spot) {
  const o = readOverrides()[spot.id];
  if (!o) return spot;
  const thumbs = Math.max(
    Number(spot.thumbs) || 0,
    Number.isFinite(o.thumbs) ? Number(o.thumbs) : 0
  );
  return {
    ...spot,
    title: o.title != null ? o.title : spot.title,
    lat: Number.isFinite(o.lat) ? o.lat : spot.lat,
    lng: Number.isFinite(o.lng) ? o.lng : spot.lng,
    place: o.place != null ? o.place : spot.place,
    thumbs,
  };
}

function normalizeSpot(spot) {
  if (!spot?.id) return null;
  const out = applyOverride({
    id: String(spot.id),
    title: spot.title || "Shared clip",
    lat: Number.parseFloat(spot.lat),
    lng: Number.parseFloat(spot.lng),
    place: spot.place || "",
    owner: spot.owner || "",
    takenAt: parseTakenAt(spot.takenAt),
    thumbs: Math.max(0, Number.parseInt(spot.thumbs, 10) || 0),
    video_path: spot.video_path || spot.path || "",
  });
  if (!Number.isFinite(out.lat) || !Number.isFinite(out.lng) || !out.video_path) {
    return null;
  }
  return out;
}

function mergeSpotLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const raw of list || []) {
      const spot = normalizeSpot(raw);
      if (!spot) continue;
      const prev = map.get(spot.id);
      map.set(spot.id, prev ? { ...prev, ...spot } : spot);
    }
  }
  return [...map.values()];
}

async function loadSpotsFromTagList() {
  const res = await fetch(
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/list/${TAG}.json?t=${Math.floor(
      Date.now() / 30000
    )}`
  );
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`Loading shared pins failed (${res.status})`);
  }
  const data = await res.json();
  return (data.resources || []).map((r) => {
    const ctx = r.context?.custom || {};
    return {
      id: r.public_id,
      title: ctx.title || "Shared clip",
      lat: Number.parseFloat(ctx.lat),
      lng: Number.parseFloat(ctx.lng),
      place: ctx.place || "",
      owner: ctx.owner || "",
      takenAt: parseTakenAt(ctx.taken),
      thumbs: Math.max(0, Number.parseInt(ctx.thumbs, 10) || 0),
      video_path: `v${r.version}/${r.public_id}.${r.format || "mp4"}`,
    };
  });
}

function indexDeliveryUrls() {
  const bust = `t=${Math.floor(Date.now() / 15000)}`;
  return [
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload/${INDEX_ID}.json?${bust}`,
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload/${INDEX_ID}?${bust}`,
  ];
}

async function loadSpotsFromIndexFile() {
  for (const url of indexDeliveryUrls()) {
    try {
      const res = await fetch(url);
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const data = await res.json();
      const spots = Array.isArray(data) ? data : data?.spots;
      if (Array.isArray(spots)) return spots;
    } catch {
      /* try next url */
    }
  }
  return [];
}

async function uploadSpotsIndex(spots) {
  if (!isCloudConfigured()) return false;
  const payload = JSON.stringify({
    updatedAt: new Date().toISOString(),
    spots: (spots || []).map((s) => ({
      id: s.id,
      title: s.title,
      lat: s.lat,
      lng: s.lng,
      place: s.place || "",
      owner: s.owner || "",
      takenAt: s.takenAt || null,
      thumbs: Math.max(0, Number(s.thumbs) || 0),
      video_path: s.video_path,
    })),
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob([payload], { type: "application/json" }),
    `${INDEX_ID}.json`
  );
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("public_id", INDEX_ID);
  // Best-effort; unsigned presets may ignore overwrite unless enabled.
  form.append("overwrite", "true");
  form.append("invalidate", "true");

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    console.warn(
      "spot index upload failed",
      detail?.error?.message || res.status
    );
    return false;
  }
  return true;
}

export async function upsertSpotIndexEntry(entry) {
  const spot = normalizeSpot(entry);
  if (!spot) return;
  cacheSpotLocally(spot);
  let spots = [];
  try {
    spots = await loadSpotsFromIndexFile();
  } catch {
    spots = [];
  }
  const local = Object.values(readLocalSpotCache());
  spots = mergeSpotLists(spots, local, [spot]);
  writeLocalSpotCache(
    Object.fromEntries(spots.map((s) => [s.id, s]))
  );
  await uploadSpotsIndex(spots).catch((err) => console.warn(err));
}

export async function removeSpotIndexEntry(id) {
  const key = String(id || "");
  if (!key) return;
  removeCachedSpot(key);
  clearSpotOverride(key);
  let spots = [];
  try {
    spots = await loadSpotsFromIndexFile();
  } catch {
    spots = [];
  }
  const local = Object.values(readLocalSpotCache());
  spots = mergeSpotLists(spots, local).filter((s) => s.id !== key);
  writeLocalSpotCache(
    Object.fromEntries(spots.map((s) => [s.id, s]))
  );
  await uploadSpotsIndex(spots).catch((err) => console.warn(err));
}

export async function loadSpots() {
  let fromList = [];
  let listError = null;
  try {
    fromList = await loadSpotsFromTagList();
  } catch (err) {
    listError = err;
    console.warn(err);
  }

  let fromIndex = [];
  try {
    fromIndex = await loadSpotsFromIndexFile();
  } catch (err) {
    console.warn(err);
  }

  const fromLocal = Object.values(readLocalSpotCache());
  const merged = mergeSpotLists(fromLocal, fromIndex, fromList);

  // Keep local cache warm for the next refresh even if cloud list stays blocked.
  if (merged.length) {
    writeLocalSpotCache(Object.fromEntries(merged.map((s) => [s.id, s])));
  }

  if (!merged.length && listError) throw listError;
  return merged;
}

function parseTakenAt(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1995 || y > 2100) return null;
  return d.toISOString();
}

function safeTakenContext(value) {
  const iso = parseTakenAt(value);
  if (!iso) return "";
  return iso.replace(/[|=]/g, "");
}

function safeContextValue(value) {
  return String(value ?? "").replace(/[|=]/g, " ").trim();
}

function buildContext({ title, lat, lng, owner, takenAt, place, thumbs }) {
  const safeTitle = safeContextValue(title);
  const taken = safeTakenContext(takenAt);
  const safePlace = safeContextValue(place);
  const thumbCount = Math.max(0, Number.parseInt(thumbs, 10) || 0);
  const parts = [
    `title=${safeTitle}`,
    `lat=${lat}`,
    `lng=${lng}`,
    `owner=${safeContextValue(owner)}`,
  ];
  if (taken) parts.push(`taken=${taken}`);
  if (safePlace) parts.push(`place=${safePlace}`);
  if (thumbCount > 0) parts.push(`thumbs=${thumbCount}`);
  return parts.join("|");
}

export async function publishSpot(file, { title, lat, lng, owner, takenAt, place }) {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("tags", TAG);
  form.append(
    "context",
    buildContext({ title, lat, lng, owner, takenAt, place })
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      detail?.error?.message || `Video upload failed (${res.status})`
    );
  }
  const data = await res.json();
  const published = {
    id: data.public_id,
    path: `v${data.version}/${data.public_id}.${data.format || "mp4"}`,
    url: data.secure_url,
    // Only present when the preset enables "Return delete token" —
    // allows undoing an upload for ~10 minutes without any API secret
    deleteToken: data.delete_token || null,
  };

  // Persist for refresh even when /video/list is restricted on this cloud.
  await upsertSpotIndexEntry({
    id: published.id,
    title,
    lat,
    lng,
    place: place || "",
    owner: owner || "",
    takenAt: takenAt || null,
    thumbs: 0,
    video_path: published.path,
  });

  return published;
}

/**
 * Persist title / GPS / place for an existing upload.
 * Prefers Cloudinary Admin API when key+secret are configured; always
 * writes a local override so this device stays consistent.
 */
export async function updateSpotMeta(
  id,
  { title, lat, lng, place, owner, takenAt, thumbs }
) {
  const publicId = String(id || "");
  if (!publicId) throw new Error("Missing video id");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Place needs a valid location");
  }

  const patch = {
    title: safeContextValue(title) || "Shared clip",
    lat,
    lng,
    place: safeContextValue(place),
  };
  if (thumbs != null) patch.thumbs = Math.max(0, Number.parseInt(thumbs, 10) || 0);
  saveSpotOverride(publicId, patch);

  const cached = readLocalSpotCache()[publicId] || {};
  await upsertSpotIndexEntry({
    ...cached,
    id: publicId,
    title: patch.title,
    lat: patch.lat,
    lng: patch.lng,
    place: patch.place,
    owner: owner || cached.owner || "",
    takenAt: takenAt || cached.takenAt || null,
    thumbs: patch.thumbs != null ? patch.thumbs : cached.thumbs || 0,
    video_path: cached.video_path || "",
  });

  if (!adminApiConfigured()) {
    return { ...patch, id: publicId, persisted: "local" };
  }

  const creds = getAdminCredentials();
  const auth = btoa(`${creds.key}:${creds.secret}`);
  const body = new URLSearchParams();
  body.set("type", "upload");
  body.set(
    "context",
    buildContext({
      title: patch.title,
      lat: patch.lat,
      lng: patch.lng,
      place: patch.place,
      owner: owner || "",
      takenAt: takenAt || "",
      thumbs: patch.thumbs,
    })
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/video/upload/${encodeURIComponent(
      publicId
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      detail?.error?.message || `Cloud update failed (${res.status})`
    );
  }
  return { ...patch, id: publicId, persisted: "cloud" };
}

/** 1×1 transparent GIF used as an unsigned “like receipt” upload. */
const PIXEL_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0)
);

function thumbPublicId(videoId, owner) {
  const vid = safeContextValue(videoId).replace(/[^\w.-]+/g, "_").slice(0, 120);
  const who = safeContextValue(owner).replace(/[^\w.-]+/g, "_").slice(0, 40) || "anon";
  return `thumbs/${vid}/${who}`;
}

/** One like per device, stored as a tiny image tagged lumen-thumb (unsigned). */
export async function publishThumb(videoId, owner) {
  if (!isCloudConfigured()) {
    throw new Error("Cloudinary is not configured");
  }
  const form = new FormData();
  form.append("file", new Blob([PIXEL_GIF], { type: "image/gif" }), "thumb.gif");
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("tags", "lumen-thumb");
  form.append("public_id", thumbPublicId(videoId, owner));
  form.append(
    "context",
    `video=${safeContextValue(videoId)}|owner=${safeContextValue(owner)}`
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      detail?.error?.message || `Thumb upload failed (${res.status})`
    );
  }
  return res.json();
}

/** Count shared thumbs from unsigned like-receipt uploads. */
export async function loadThumbCounts() {
  if (!CLOUDINARY_CLOUD_NAME) return {};
  const res = await fetch(
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/list/lumen-thumb.json?t=${Math.floor(
      Date.now() / 30000
    )}`
  );
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Loading thumbs failed (${res.status})`);
  const data = await res.json();
  const counts = {};
  for (const r of data.resources || []) {
    const vid = r.context?.custom?.video || "";
    if (!vid) continue;
    counts[vid] = (counts[vid] || 0) + 1;
  }
  return counts;
}

/**
 * Persist a new thumbs total for a spot (local override always;
 * Cloudinary context when Admin API is configured).
 */
export function persistThumbCount(id, thumbs) {
  const publicId = String(id || "");
  if (!publicId) return;
  const next = Math.max(0, Number.parseInt(thumbs, 10) || 0);
  saveSpotOverride(publicId, { thumbs: next });
  const cached = readLocalSpotCache()[publicId];
  if (cached) {
    cacheSpotLocally({ ...cached, thumbs: next });
  }
}

/** Remove a video from the app index; also destroy in Cloudinary when Admin API is set. */
export async function adminDeleteSpot(id) {
  const publicId = String(id || "");
  if (!publicId) throw new Error("Missing video id");

  const creds = getAdminCredentials();
  if (CLOUDINARY_CLOUD_NAME && creds) {
    const auth = btoa(`${creds.key}:${creds.secret}`);
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/video/upload`
    );
    url.searchParams.append("public_ids[]", publicId);
    url.searchParams.set("invalidate", "true");

    const res = await fetch(url.toString(), {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(
        detail?.error?.message || `Cloud delete failed (${res.status})`
      );
    }
    const data = await res.json().catch(() => ({}));
    const deleted = data?.deleted?.[publicId];
    if (deleted && deleted !== "deleted" && deleted !== "not_found") {
      throw new Error(`Cloud delete status: ${deleted}`);
    }
    await removeSpotIndexEntry(publicId);
    return { ...data, persisted: "cloud" };
  }

  // No Admin API in config — drop from the shared index / local cache so it
  // no longer appears in the app after refresh.
  await removeSpotIndexEntry(publicId);
  return { id: publicId, persisted: "index" };
}

export async function deleteSpot(id, path, deleteToken) {
  if (!deleteToken) {
    throw new Error("No delete token — clip can only be removed right after upload");
  }
  const form = new FormData();
  form.append("token", deleteToken);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/delete_by_token`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(`Cloud delete failed (${res.status})`);
  await removeSpotIndexEntry(id);
}
