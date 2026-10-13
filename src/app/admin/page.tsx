import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Brain, Gauge, Lightbulb, ListChecks, Sparkles } from "lucide-react";

import { LOCALES, LOCALE_META } from "@/lib/domain/locale";
import { INTENTS } from "@/lib/domain/outcome";
import { SCENARIOS } from "@/lib/client/scenarios";
import { getRepositories } from "@/lib/server/db/repositories";
import { analyzeSessions } from "@/lib/server/analytics";
import { getAppUser } from "@/lib/server/userContext";
import { adminConfigured } from "@/lib/server/adminEnv";
import { Badge, Card, SectionHeader } from "@/components/ui";
import { EvaluationPanel } from "@/components/EvaluationPanel";
import { DatasetExportPanel } from "@/components/DatasetExportPanel";

import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  setKnowledgeApprovalAction,
  updateKnowledgeAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin portal · Aura Voice CX",
  description: "Assess the voice agent and curate the knowledge base.",
};

const inputClass =
  "w-full rounded-[9px] border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-forest/50";
const labelClass = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-faint";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[11px] border border-line bg-canvas px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

export default async function AdminPage() {
  const user = await getAppUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto max-w-[1040px] px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition-colors hover:text-forest"
        >
          <ArrowLeft size={14} aria-hidden /> Back to workspace
        </Link>
        <Badge tone={user.isAdmin ? "sage" : "rust"}>
          {user.isAdmin ? "Admin session" : "Viewer"}
        </Badge>
      </div>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Admin portal</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
        Assess how the voice agent performed and curate the answers it is allowed to
        reuse. Only approved knowledge is ever injected into a live reply.
      </p>

      {!user.isAdmin ? (
        <Card className="mt-6">
          <div className="px-4 py-5 text-[13.5px] text-muted sm:px-5">
            {adminConfigured() ? (
              <p>
                Your account is not on the admin allowlist. Add{" "}
                <span className="font-medium text-ink">{user.email}</span> to the{" "}
                <code className="rounded bg-parchment px-1 py-0.5 text-[12px]">ADMIN_EMAILS</code>{" "}
                environment variable to grant access.
              </p>
            ) : (
              <p>
                No admin allowlist is configured. Set{" "}
                <code className="rounded bg-parchment px-1 py-0.5 text-[12px]">ADMIN_EMAILS</code>{" "}
                (comma-separated) to enable the admin portal.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <AdminContent />
      )}
    </main>
  );
}

async function AdminContent() {
  const repo = await getRepositories();
  const stats = await repo.sessions.stats();
  const allSessions = await repo.sessions.listAll(500);
  const sessions = allSessions.slice(0, 50);
  const knowledge = await repo.knowledge.list();
  const pending = knowledge.filter((k) => !k.approved);
  const approved = knowledge.filter((k) => k.approved);
  const analytics = analyzeSessions(allSessions, knowledge);
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <>
      <Card className="mt-6">
        <SectionHeader
          title="Agent performance"
          hint={`${stats.total} stored session${stats.total === 1 ? "" : "s"} · ${repo.backend === "mongo" ? "MongoDB Atlas" : "In-memory store"}`}
          icon={<Gauge size={16} aria-hidden />}
        />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
          <Stat label="Sessions" value={String(stats.total)} />
          <Stat label="Resolved" value={String(stats.resolved)} tone="text-forest" />
          <Stat label="Unresolved" value={String(stats.unresolved)} tone="text-rust" />
          <Stat label="Escalated" value={String(stats.escalated)} tone="text-amber" />
          <Stat label="Out of scope" value={String(stats.outOfScope)} />
          <Stat label="Resolution rate" value={`${Math.round(stats.resolutionRate * 100)}%`} />
        </div>
      </Card>

      <Card className="mt-6">
        <SectionHeader
          title="Insights"
          hint="Where the agent struggles, and which topics still need a written answer."
          icon={<Lightbulb size={16} aria-hidden />}
        />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-4">
          <Stat label="Escalation rate" value={pct(analytics.escalationRate)} tone="text-amber" />
          <Stat label="Unresolved rate" value={pct(analytics.unresolvedRate)} tone="text-rust" />
          <Stat
            label="Model-assisted turns"
            value={analytics.agent.turns === 0 ? "—" : pct(analytics.agent.aiAssistRate)}
          />
          <Stat
            label="Draft accept rate"
            value={
              analytics.agent.acceptedDrafts + analytics.agent.rejectedDrafts === 0
                ? "—"
                : pct(analytics.agent.draftAcceptRate)
            }
          />
        </div>

        <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2 sm:px-5">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              Top unresolved topics
            </p>
            {analytics.topUnresolvedTopics.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing unresolved yet.</p>
            ) : (
              <ul className="space-y-2">
                {analytics.topUnresolvedTopics.map((topic) => (
                  <li key={topic.label} className="rounded-[10px] border border-line bg-canvas p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{topic.label}</span>
                      <Badge tone="rust">{topic.count}</Badge>
                    </div>
                    {topic.examples[0] ? (
                      <p className="mt-1 text-[12px] text-faint">{topic.examples[0]}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              Coverage gaps
            </p>
            {analytics.coverageGaps.length === 0 ? (
              <p className="text-[13px] text-muted">
                Every intent customers raised has at least one approved answer.
              </p>
            ) : (
              <ul className="space-y-2">
                {analytics.coverageGaps.map((gap) => (
                  <li
                    key={gap.intent}
                    className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-canvas p-2.5"
                  >
                    <span className="text-[12.5px] font-medium text-ink">{gap.intent}</span>
                    <span className="text-[11.5px] text-faint">
                      {gap.sessions} session{gap.sessions === 1 ? "" : "s"} · no approved answer
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11.5px] text-faint">
              Drafts accepted {analytics.agent.acceptedDrafts} · rejected{" "}
              {analytics.agent.rejectedDrafts} (guardrail judgements).
            </p>
          </div>
        </div>
      </Card>

      <EvaluationPanel scenarios={SCENARIOS.length} />

      <DatasetExportPanel />

      <Card className="mt-6">
        <SectionHeader
          title="Recent sessions"
          hint="What customers asked, and how Aria resolved it."
          icon={<ListChecks size={16} aria-hidden />}
        />
        <div className="overflow-x-auto px-4 py-2 sm:px-5">
          {sessions.length === 0 ? (
            <p className="py-4 text-[13px] text-muted">No sessions recorded yet.</p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Resolution</th>
                  <th className="py-2 pr-3 font-medium">Language</th>
                  <th className="py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-line/60 align-top">
                    <td className="py-2.5 pr-3 text-[12px] text-faint whitespace-nowrap">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] text-muted">{session.userEmail}</td>
                    <td className="py-2.5 pr-3 text-[12px] text-ink">{session.intent ?? "—"}</td>
                    <td className="py-2.5 pr-3">
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
                    </td>
                    <td className="py-2.5 pr-3 text-[12px] text-muted">
                      {LOCALE_META[session.locale]?.label ?? session.locale}
                    </td>
                    <td className="py-2.5 text-[12.5px] text-muted">{session.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <SectionHeader
          title="Knowledge base"
          hint={`${approved.length} approved · ${pending.length} pending review`}
          icon={<Brain size={16} aria-hidden />}
        />
        <div className="space-y-3 px-4 py-4 sm:px-5">
          {knowledge.length === 0 ? (
            <p className="text-[13px] text-muted">
              No knowledge entries yet. Add one, or finish an unresolved session and a
              suggestion will appear here.
            </p>
          ) : (
            knowledge.map((entry) => (
              <div key={entry.id} className="rounded-[11px] border border-line bg-canvas p-3.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={entry.approved ? "sage" : "amber"}>
                      {entry.approved ? "Approved" : "Pending"}
                    </Badge>
                    <Badge tone="outline">{entry.source}</Badge>
                    {entry.intent ? <Badge tone="neutral">{entry.intent}</Badge> : null}
                    <span className="text-[11.5px] text-faint">
                      used {entry.usageCount}× · {LOCALE_META[entry.locale]?.label ?? entry.locale}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={setKnowledgeApprovalAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      <input type="hidden" name="approved" value={entry.approved ? "false" : "true"} />
                      <button
                        type="submit"
                        className="rounded-[8px] border border-forest/30 bg-forest-tint px-2.5 py-1 text-[11.5px] font-medium text-forest-deep transition-colors hover:bg-forest/15"
                      >
                        {entry.approved ? "Unapprove" : "Approve"}
                      </button>
                    </form>
                    <form action={deleteKnowledgeAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      <button
                        type="submit"
                        className="rounded-[8px] px-2.5 py-1 text-[11.5px] font-medium text-rust transition-colors hover:bg-rust-soft"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
                <form action={updateKnowledgeAction} className="grid gap-2.5 sm:grid-cols-2">
                  <input type="hidden" name="id" value={entry.id} />
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Question / topic</label>
                    <input name="question" defaultValue={entry.question} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Answer</label>
                    <textarea
                      name="answer"
                      defaultValue={entry.answer}
                      rows={2}
                      placeholder="Write the answer Aria may reuse…"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Intent</label>
                    <select name="intent" defaultValue={entry.intent ?? ""} className={inputClass}>
                      <option value="">—</option>
                      {INTENTS.map((intent) => (
                        <option key={intent} value={intent}>
                          {intent}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Language</label>
                    <select name="locale" defaultValue={entry.locale} className={inputClass}>
                      {LOCALES.map((code) => (
                        <option key={code} value={code}>
                          {LOCALE_META[code].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      className="rounded-[9px] border border-line bg-panel px-3.5 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:border-forest/40"
                    >
                      Save changes
                    </button>
                  </div>
                </form>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <SectionHeader
          title="Add knowledge"
          hint="Teach Aria a reusable, verified answer."
          icon={<Sparkles size={16} aria-hidden />}
        />
        <form action={createKnowledgeAction} className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <div className="sm:col-span-2">
            <label className={labelClass}>Question / topic</label>
            <input name="question" required className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Answer</label>
            <textarea name="answer" required rows={3} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Intent</label>
            <select name="intent" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {INTENTS.map((intent) => (
                <option key={intent} value={intent}>
                  {intent}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Language</label>
            <select name="locale" defaultValue="en" className={inputClass}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_META[code].label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-[9px] border border-forest/30 bg-forest px-4 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-forest-deep"
            >
              Add knowledge
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
