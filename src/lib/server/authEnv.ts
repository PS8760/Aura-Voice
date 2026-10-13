/**
 * Google sign-in is available only when both credentials are configured. We
 * never construct the Google provider with missing secrets, so the app builds
 * and runs (using the demo provider) without a Google Cloud project.
 */
export function googleAuthEnabled(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
