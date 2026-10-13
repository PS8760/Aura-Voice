import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

import { googleAuthEnabled } from "@/lib/server/authEnv";
import {
  authorizeDemoCredentials,
  isDemoAuthEnabled,
} from "@/lib/server/demoAuth";

const providers: Provider[] = [];

if (googleAuthEnabled()) {
  providers.push(
    Google({ allowDangerousEmailAccountLinking: true }),
  );
}

if (isDemoAuthEnabled()) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Email (demo)",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        name: { label: "Name", type: "text" },
      },
      authorize: async (credentials) => authorizeDemoCredentials(credentials),
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? "aura-voice-cx-insecure-dev-secret",
});

export { googleAuthEnabled, isDemoAuthEnabled };
