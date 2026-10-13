export interface DemoUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * The demo credential provider exists so the assessment can be tested without a
 * Google Cloud project. It is clearly labelled as a demo in the UI and can be
 * turned off in any real deployment.
 */
export function isDemoAuthEnabled(): boolean {
  return process.env.AURA_DISABLE_DEMO_AUTH !== "true";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDisplayName(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * Pure credential check. Any valid-looking email with a password of at least six
 * characters signs in — there is no user database by design (keeps the stack
 * zero-cost). Never returns a user for a malformed email or short password.
 */
export function authorizeDemoCredentials(
  raw: Partial<Record<string, unknown>> | undefined,
): DemoUser | null {
  const email = String(raw?.email ?? "").trim().toLowerCase();
  const password = String(raw?.password ?? "");
  const nameRaw = String(raw?.name ?? "").trim();

  if (!EMAIL_RE.test(email)) return null;
  if (password.length < 6) return null;

  return {
    id: `demo:${email}`,
    name: nameRaw || toDisplayName(email),
    email,
    image: null,
  };
}
