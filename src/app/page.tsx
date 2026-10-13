import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DEFAULT_LOCALE, type Locale } from "@/lib/domain/locale";
import { isAdminEmail } from "@/lib/server/adminEnv";
import { getRepositories } from "@/lib/server/db/repositories";
import { Workspace } from "@/components/Workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const email = (session.user.email ?? "").toLowerCase();

  // Seed the conversation language from the customer's saved preference so the
  // workspace adapts to returning users without them re-selecting a language.
  let initialLocale: Locale = DEFAULT_LOCALE;
  try {
    const repo = await getRepositories();
    const profile = await repo.profiles.get(email);
    if (profile) initialLocale = profile.preferredLocale;
  } catch {
    initialLocale = DEFAULT_LOCALE;
  }

  return (
    <Workspace
      initialLocale={initialLocale}
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        isAdmin: isAdminEmail(session.user.email),
      }}
    />
  );
}
