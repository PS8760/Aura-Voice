import { redirect } from "next/navigation";

import { auth, googleAuthEnabled, isDemoAuthEnabled } from "@/auth";
import { AuthPanel } from "@/components/AuthPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in · Aura Voice CX",
  description: "Sign in to the Aura Voice CX support workspace.",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <AuthPanel
      mode="signin"
      googleEnabled={googleAuthEnabled()}
      demoEnabled={isDemoAuthEnabled()}
    />
  );
}
