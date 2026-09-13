// Public Cloudinary web config (safe to ship — unsigned presets are meant
// for browser uploads; no API secret ever ships to the client).
// Dashboard: cloud name + Settings → Upload → Upload presets (Unsigned).
export const CLOUDINARY_CLOUD_NAME = "ejvisrc9";
export const CLOUDINARY_UPLOAD_PRESET = "ml_default";

export function isCloudConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);
}
