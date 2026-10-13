import { auth } from "@/auth";
import { isAdminEmail } from "./adminEnv";

/**
 * Resolve the signed-in user into the stable identity the workspace persists
 * against. The email is the natural key: it is stable across providers and is
 * already verified by the identity provider.
 */
export interface AppUser {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  isAdmin: boolean;
}

export async function getAppUser(): Promise<AppUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const normalized = email.toLowerCase();
  return {
    userId: normalized,
    email,
    name: session?.user?.name ?? "",
    image: session?.user?.image ?? null,
    isAdmin: isAdminEmail(email),
  };
}
