export interface SessionUser {
  name: string | null;
  email: string | null;
  image: string | null;
  isAdmin?: boolean;
}

export function userInitial(user: SessionUser): string {
  const source = user.name?.trim() || user.email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}
