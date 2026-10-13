"use client";

import { useCallSession } from "@/lib/client/useCallSession";
import type { SessionUser } from "@/lib/client/user";
import type { Locale } from "@/lib/domain/locale";
import { Header } from "./Header";
import { VoiceWorkspace } from "./VoiceWorkspace";
import { ScenarioLauncher } from "./ScenarioLauncher";
import { TestOrdersPanel } from "./TestOrdersPanel";
import { ConversationPanel } from "./ConversationPanel";
import { ActivityTimeline } from "./ActivityTimeline";
import { PostCallPanel } from "./PostCallPanel";
import { HistoryPanel } from "./HistoryPanel";

export function Workspace({
  user,
  initialLocale,
}: {
  user: SessionUser | null;
  initialLocale?: Locale;
}) {
  const session = useCallSession({ initialLocale });

  return (
    <div className="min-h-screen bg-ivory">
      <Header
        user={user}
        mounted={session.mounted}
        interactionMode={session.interactionMode}
        serverStatus={session.serverStatus}
        localAIAvailable={session.localAIAvailable}
        locale={session.locale}
        onLocaleChange={session.setLocale}
      />

      <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
        <div className="grid items-start gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-5">
            <VoiceWorkspace session={session} />
            <ScenarioLauncher session={session} />
            <TestOrdersPanel />
            <HistoryPanel
              history={session.history}
              onClear={session.clearHistory}
            />
          </div>

          <div className="flex flex-col gap-5 lg:col-span-7 lg:min-h-[720px]">
            <ConversationPanel session={session} />
            <ActivityTimeline activity={session.activity} />
          </div>
        </div>

        {session.outcome ? (
          <div className="mt-5">
            <PostCallPanel
              outcome={session.outcome}
              transcript={session.transcript}
            />
          </div>
        ) : null}

        <footer className="mt-8 border-t border-line pt-5 text-[11.5px] leading-relaxed text-faint">
          <p className="max-w-3xl">
            Aura Voice CX is a demonstration for an internship assessment. It
            runs on a zero-cost stack: browser speech recognition and synthesis,
            a deterministic server-side policy engine, and three mock orders.
            No paid AI APIs, no paid hosting and no private credentials are
            required. Order data is fictional and must not be treated as live
            logistics information.
          </p>
          {session.localAINote ? (
            <p className="mt-2 text-faint">
              Local AI: {session.localAINote}
            </p>
          ) : null}
        </footer>
      </main>
    </div>
  );
}
