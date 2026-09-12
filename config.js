// Public Cloudinary web config (safe to ship — unsigned presets are meant
// for browser uploads; no API secret ever ships to the client).
// Leave empty to use the phone photo library as the video source (no shared cloud).
// To reconnect Cloudinary later, fill these from the Dashboard:
//   cloud name — shown on the dashboard home
//   preset — Settings → Upload → Upload presets → Add (Signing mode: Unsigned)
export const CLOUDINARY_CLOUD_NAME = "";
export const CLOUDINARY_UPLOAD_PRESET = "";

export function isCloudConfigured() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);
}
