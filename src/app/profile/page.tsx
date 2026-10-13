import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Home, MapPin, ShieldCheck, UserRound } from "lucide-react";

import { getRepositories } from "@/lib/server/db/repositories";
import { getAppUser } from "@/lib/server/userContext";
import { LOCALES, LOCALE_META } from "@/lib/domain/locale";
import { Badge, Card, SectionHeader } from "@/components/ui";

import {
  addAddressAction,
  deleteAddressAction,
  updateAddressAction,
  updateProfileAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your profile · Aura Voice CX",
  description: "Manage your Aura Voice CX profile and delivery addresses.",
};

const inputClass =
  "w-full rounded-[9px] border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none transition-colors focus:border-forest/50";
const labelClass = "mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-faint";

export default async function ProfilePage() {
  const user = await getAppUser();
  if (!user) redirect("/login");

  const repo = await getRepositories();
  const profile =
    (await repo.profiles.get(user.userId)) ??
    (await repo.profiles.upsert(user.userId, { email: user.email, name: user.name || "Customer" }));
  const sessions = await repo.sessions.listByUser(user.userId, 10);

  return (
    <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-forest"
        >
          <ArrowLeft size={14} aria-hidden /> Back to workspace
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone="forest">
            <ShieldCheck size={12} aria-hidden /> {repo.backend === "mongo" ? "MongoDB Atlas" : "In-memory store"}
          </Badge>
          {user.isAdmin ? (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-full border border-forest/30 bg-forest px-3 py-1.5 text-[12px] font-medium text-canvas transition-colors hover:bg-forest-deep"
            >
              Admin portal
            </Link>
          ) : null}
        </div>
      </div>

      <Card className="mb-6">
        <SectionHeader
          title="Your profile"
          hint="Details Aria can use to personalise and confirm your support."
          icon={<UserRound size={16} aria-hidden />}
        />
        <div className="px-4 py-4 sm:px-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] text-faint">Signed in as</span>
            <span className="text-[12.5px] font-medium text-ink">{profile.email}</span>
          </div>
          <form action={updateProfileAction} className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="name">
                Full name
              </label>
              <input id="name" name="name" defaultValue={profile.name} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                defaultValue={profile.phone}
                placeholder="+91 …"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="preferredLocale">
                Preferred language
              </label>
              <select
                id="preferredLocale"
                name="preferredLocale"
                defaultValue={profile.preferredLocale}
                className={inputClass}
              >
                {LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_META[code].label} · {LOCALE_META[code].native}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-forest/30 bg-forest px-4 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-forest-deep"
              >
                Save profile
              </button>
            </div>
          </form>
        </div>
      </Card>

      <Card className="mb-6">
        <SectionHeader
          title="Delivery addresses"
          hint={`${profile.addresses.length} saved address${profile.addresses.length === 1 ? "" : "es"}`}
          icon={<MapPin size={16} aria-hidden />}
        />
        <div className="space-y-4 px-4 py-4 sm:px-5">
          {profile.addresses.length === 0 ? (
            <p className="text-[13px] text-muted">
              No addresses yet. Add one below so Aria can confirm delivery details.
            </p>
          ) : (
            profile.addresses.map((address) => (
              <div key={address.id} className="rounded-[11px] border border-line bg-canvas p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Home size={13} className="text-forest" aria-hidden />
                    <span className="text-[13px] font-semibold text-ink">{address.label}</span>
                    {address.isDefault ? <Badge tone="sage">Default</Badge> : null}
                  </div>
                  <form action={deleteAddressAction}>
                    <input type="hidden" name="addressId" value={address.id} />
                    <button
                      type="submit"
                      className="text-[11.5px] font-medium text-rust transition-colors hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </div>
                <form action={updateAddressAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="addressId" value={address.id} />
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Address line 1</label>
                    <input name="line1" defaultValue={address.line1} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Address line 2 (optional)</label>
                    <input name="line2" defaultValue={address.line2} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>City</label>
                    <input name="city" defaultValue={address.city} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>State</label>
                    <input name="state" defaultValue={address.state} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Pincode</label>
                    <input name="pincode" defaultValue={address.pincode} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Label</label>
                    <input name="label" defaultValue={address.label} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Phone</label>
                    <input name="phone" defaultValue={address.phone} className={inputClass} />
                  </div>
                  <div className="flex items-center gap-4 sm:col-span-2">
                    <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                      <input type="checkbox" name="isDefault" defaultChecked={address.isDefault} />
                      Make default
                    </label>
                    <button
                      type="submit"
                      className="rounded-[9px] border border-line bg-panel px-3.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-forest/40"
                    >
                      Save address
                    </button>
                  </div>
                </form>
              </div>
            ))
          )}

          <details className="rounded-[11px] border border-dashed border-line-strong bg-parchment/40 p-3.5">
            <summary className="cursor-pointer text-[13px] font-medium text-forest">
              + Add a new address
            </summary>
            <form action={addAddressAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass}>Address line 1</label>
                <input name="line1" required className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Address line 2 (optional)</label>
                <input name="line2" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>City</label>
                <input name="city" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>State</label>
                <input name="state" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Pincode</label>
                <input name="pincode" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Label</label>
                <input name="label" placeholder="Home, Work…" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Phone</label>
                <input name="phone" className={inputClass} />
              </div>
              <div className="flex items-center gap-4 sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                  <input type="checkbox" name="isDefault" /> Make default
                </label>
                <button
                  type="submit"
                  className="rounded-[9px] border border-forest/30 bg-forest px-3.5 py-1.5 text-[12.5px] font-medium text-canvas transition-colors hover:bg-forest-deep"
                >
                  Add address
                </button>
              </div>
            </form>
          </details>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Recent sessions"
          hint="Your last support conversations, stored for continuity."
          icon={<ShieldCheck size={16} aria-hidden />}
        />
        <div className="px-4 py-4 sm:px-5">
          {sessions.length === 0 ? (
            <p className="text-[13px] text-muted">
              No sessions yet. Start a call in the workspace and it will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{session.summary}</p>
                    <p className="mt-0.5 text-[11.5px] text-faint">
                      {new Date(session.createdAt).toLocaleString()} · {session.mode} ·{" "}
                      {LOCALE_META[session.locale]?.label ?? session.locale}
                    </p>
                  </div>
                  <Badge
                    tone={
                      session.resolution === "RESOLVED"
                        ? "sage"
                        : session.resolution === "ESCALATION_REQUIRED"
                          ? "amber"
                          : session.resolution === "OUT_OF_SCOPE"
                            ? "neutral"
                            : "rust"
                    }
                  >
                    {session.resolution ?? "UNKNOWN"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </main>
  );
}
