import type { Intent } from "@/lib/domain/types";

import type { KnowledgeEntry, StoredSession } from "./db/types";

/**
 * Admin analytics.
 *
 * Pure functions over stored sessions and knowledge entries. Nothing here talks
 * to a database or the network, so the numbers are easy to test and can never
 * drift from what the admin portal displays.
 *
 * These are deliberately descriptive: an escalation rate, the topics that most
 * often stay unresolved, and the intents that customers raise but that have no
 * approved answer yet ("coverage gaps"). No score is invented, and no metric is
 * shown as a target.
 */

export interface UnresolvedTopic {
  /** Intent label, or "UNKNOWN" when the session had no clear intent. */
  label: string;
  count: number;
  /** A few real summaries, trimmed for display. */
  examples: string[];
}

export interface CoverageGap {
  intent: Intent;
  sessions: number;
  approvedEntries: number;
}

export interface AgentBehaviourSummary {
  turns: number;
  aiTurns: number;
  acceptedDrafts: number;
  rejectedDrafts: number;
  /** Share of turns answered by the optional local-model agent. */
  aiAssistRate: number;
  /** Accepted drafts as a share of drafts the guardrail actually judged. */
  draftAcceptRate: number;
}

export interface AdminAnalytics {
  escalationRate: number;
  unresolvedRate: number;
  agent: AgentBehaviourSummary;
  topUnresolvedTopics: UnresolvedTopic[];
  coverageGaps: CoverageGap[];
}

const MAX_TOPICS = 5;
const MAX_EXAMPLES = 3;

function trim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}

export function analyzeSessions(
  sessions: StoredSession[],
  knowledge: KnowledgeEntry[],
): AdminAnalytics {
  const total = sessions.length;

  let escalated = 0;
  let unresolved = 0;
  const unresolvedByIntent = new Map<string, { count: number; examples: string[] }>();
  const sessionsByIntent = new Map<Intent, number>();

  let turns = 0;
  let aiTurns = 0;
  let acceptedDrafts = 0;
  let rejectedDrafts = 0;

  for (const session of sessions) {
    if (session.resolution === "ESCALATION_REQUIRED") escalated += 1;
    else if (session.resolution === "UNRESOLVED") unresolved += 1;

    if (session.resolution !== "RESOLVED") {
      const label = session.intent ?? "UNKNOWN";
      const bucket = unresolvedByIntent.get(label) ?? { count: 0, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < MAX_EXAMPLES && session.summary.trim()) {
        bucket.examples.push(trim(session.summary));
      }
      unresolvedByIntent.set(label, bucket);
    }

    if (session.intent) {
      sessionsByIntent.set(session.intent, (sessionsByIntent.get(session.intent) ?? 0) + 1);
    }

    const metrics = session.agentMetrics;
    if (metrics) {
      turns += metrics.turns;
      aiTurns += metrics.aiTurns;
      acceptedDrafts += metrics.acceptedDrafts;
      rejectedDrafts += metrics.rejectedDrafts;
    }
  }

  const topUnresolvedTopics: UnresolvedTopic[] = [...unresolvedByIntent.entries()]
    .map(([label, bucket]) => ({ label, count: bucket.count, examples: bucket.examples }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_TOPICS);

  const approvedByIntent = new Map<string, number>();
  for (const entry of knowledge) {
    if (!entry.approved || !entry.intent) continue;
    approvedByIntent.set(entry.intent, (approvedByIntent.get(entry.intent) ?? 0) + 1);
  }

  const coverageGaps: CoverageGap[] = [...sessionsByIntent.entries()]
    .map(([intent, count]) => ({
      intent,
      sessions: count,
      approvedEntries: approvedByIntent.get(intent) ?? 0,
    }))
    .filter((gap) => gap.approvedEntries === 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, MAX_TOPICS);

  const judgedDrafts = acceptedDrafts + rejectedDrafts;

  return {
    escalationRate: total === 0 ? 0 : escalated / total,
    unresolvedRate: total === 0 ? 0 : unresolved / total,
    agent: {
      turns,
      aiTurns,
      acceptedDrafts,
      rejectedDrafts,
      aiAssistRate: turns === 0 ? 0 : aiTurns / turns,
      draftAcceptRate: judgedDrafts === 0 ? 0 : acceptedDrafts / judgedDrafts,
    },
    topUnresolvedTopics,
    coverageGaps,
  };
}
