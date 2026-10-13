/**
 * Admin allowlist.
 *
 * The admin portal is gated by an explicit allowlist of email addresses in
 * `ADMIN_EMAILS` (comma-separated). If the variable is unset the portal is
 * closed to everyone, which is the safe default: admin access is opt-in.
 */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export function adminConfigured(): boolean {
  return adminEmails().length > 0;
}
