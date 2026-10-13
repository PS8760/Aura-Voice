import type { Locale } from "@/lib/domain/locale";
import type { CallMode } from "@/lib/domain/outcome";
import type { Intent, ResolutionStatus } from "@/lib/domain/types";

/**
 * Persistence records for the Aura Voice CX workspace.
 *
 * These are deliberately plain data shapes so they can be stored either in
 * MongoDB Atlas (when `MONGODB_URI` is set) or in an in-memory store used for
 * local development and tests. The repositories that own them are the only
 * place that knows which backend is active.
 */

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  isDefault: boolean;
}

/** A customer profile, keyed by the authenticated user's stable id (email). */
export interface UserProfile {
  userId: string;
  email: string;
  name: string;
  phone: string;
  preferredLocale: Locale;
  addresses: Address[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A completed support session. Stored after each call so the workspace can
 * show history, the admin portal can assess the agent, and the learning loop
 * can learn from what actually happened.
 */
export interface AgentSessionMetrics {
  turns: number;
  /** Turns answered by the optional local-model agent rather than pure rules. */
  aiTurns: number;
  acceptedDrafts: number;
  rejectedDrafts: number;
}

export interface StoredSession {
  id: string;
  userId: string;
  userEmail: string;
  locale: Locale;
  mode: CallMode;
  intent: Intent | null;
  resolution: ResolutionStatus | null;
  summary: string;
  turnCount: number;
  unresolved: string[];
  escalated: boolean;
  /** Aria's final spoken reply, captured to seed knowledge suggestions. */
  lastReply: string | null;
  /** How the agent actually behaved across the session. */
  agentMetrics: AgentSessionMetrics | null;
  createdAt: string;
}

export interface SessionStats {
  total: number;
  resolved: number;
  unresolved: number;
  escalated: number;
  outOfScope: number;
  resolutionRate: number;
  byIntent: Record<string, number>;
  byLocale: Record<string, number>;
  byMode: Record<string, number>;
}

/**
 * A reusable answer the agent may draw on.
 *
 * `source: "admin"` entries are written by a human in the admin portal.
 * `source: "session"` entries are auto-suggested from resolved sessions and
 * stay unapproved until a human approves them. Only approved entries are ever
 * injected into the agent prompt.
 */
export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  intent: Intent | null;
  locale: Locale;
  source: "admin" | "session";
  approved: boolean;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
