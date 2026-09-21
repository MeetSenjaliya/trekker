// Client-safe (only reads a NEXT_PUBLIC_ var) — site.ts is server-only.
// The objects are the legacy `trek-profile` uploads, copied to R2 as-is.
const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/$/, '')

export const DEFAULT_TREK_IMAGE = `${base}/trek-profile/defaulttrek.jpeg`
export const DEFAULT_HERO_IMAGE = `${base}/trek-profile/River%20Valley%20Trek.jpeg`
export const DEFAULT_AVATAR_IMAGE = `${base}/avatars/image.jpg`
