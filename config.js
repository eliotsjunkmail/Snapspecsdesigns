// Public Cloudinary web config (safe to ship — unsigned presets are meant
// for browser uploads; no API secret ever ships required for normal use).
// Dashboard: cloud name + Settings → Upload → Upload presets (Unsigned).
// Optional Admin API key/secret enable cross-device admin edits of title/place.
export const CLOUDINARY_CLOUD_NAME = "ejvisrc9";
export const CLOUDINARY_UPLOAD_PRESET = "ml_default";
export const CLOUDINARY_API_KEY = "";
export const CLOUDINARY_API_SECRET = "";

export function isCloudConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);
}
