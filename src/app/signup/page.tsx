import { redirect } from "next/navigation";

import { auth, googleAuthEnabled, isDemoAuthEnabled } from "@/auth";
import { AuthPanel } from "@/components/AuthPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create account · Aura Voice CX",
  description: "Create an Aura Voice CX account to test the support workspace.",
};

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <AuthPanel
      mode="signup"
      googleEnabled={googleAuthEnabled()}
      demoEnabled={isDemoAuthEnabled()}
    />
  );
}
