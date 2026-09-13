// Shared-world sync via Cloudinary unsigned uploads.
// Videos are tagged, pin metadata (title/GPS/owner/place) rides in the context
// field, and visitors load everything through the public list-by-tag JSON.
import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  isCloudConfigured,
} from "./config.js";

const TAG = "lumen-spot";
const OVERRIDE_KEY = "lumen-admin-spot-overrides";

export function cloudConfigured() {
  return isCloudConfigured();
}

export function adminApiConfigured() {
  return Boolean(
    CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
  );
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

export async function loadSpots() {
  // Cache-buster: the list JSON is CDN-cached, keep pins reasonably fresh
  const res = await fetch(
    `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/list/${TAG}.json?t=${Math.floor(
      Date.now() / 30000
    )}`
  );
  if (res.status === 404) return []; // no shared clips yet
  if (!res.ok) throw new Error(`Loading shared pins failed (${res.status})`);
  const data = await res.json();

  return (data.resources || [])
    .map((r) => {
      const ctx = r.context?.custom || {};
      const spot = {
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
      return applyOverride(spot);
    })
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
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
  return {
    id: data.public_id,
    path: `v${data.version}/${data.public_id}.${data.format || "mp4"}`,
    url: data.secure_url,
    // Only present when the preset enables "Return delete token" —
    // allows undoing an upload for ~10 minutes without any API secret
    deleteToken: data.delete_token || null,
  };
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

  if (!adminApiConfigured()) {
    return { ...patch, id: publicId, persisted: "local" };
  }

  const auth = btoa(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`);
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
  saveSpotOverride(publicId, {
    thumbs: Math.max(0, Number.parseInt(thumbs, 10) || 0),
  });
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
}
