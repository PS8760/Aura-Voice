import type { Collection, Db } from "mongodb";

import { DEFAULT_LOCALE, type Locale } from "@/lib/domain/locale";
import type { CallOutcome } from "@/lib/domain/outcome";
import type { Intent } from "@/lib/domain/types";

import { getMongoDb, isMongoConfigured } from "./client";
import type {
  Address,
  AgentSessionMetrics,
  KnowledgeEntry,
  SessionStats,
  StoredSession,
  UserProfile,
} from "./types";

/**
 * Repository layer.
 *
 * Every method is async and every backend implements the same interfaces, so the
 * rest of the app never branches on where data lives. MongoDB Atlas is used when
 * `MONGODB_URI` is set; otherwise an in-memory store keeps the workspace fully
 * functional with zero infrastructure.
 */

export type BackendKind = "mongo" | "memory";

export interface ProfileRepository {
  get(userId: string): Promise<UserProfile | null>;
  upsert(
    userId: string,
    patch: Partial<Omit<UserProfile, "userId" | "createdAt" | "updatedAt">>,
  ): Promise<UserProfile>;
  listAddresses(userId: string): Promise<Address[]>;
  addAddress(userId: string, address: Omit<Address, "id">): Promise<Address>;
  updateAddress(
    userId: string,
    addressId: string,
    patch: Partial<Omit<Address, "id">>,
  ): Promise<Address | null>;
  removeAddress(userId: string, addressId: string): Promise<boolean>;
}

export interface SessionRepository {
  save(
    session: Omit<StoredSession, "id" | "createdAt"> & { createdAt?: string },
  ): Promise<StoredSession>;
  listByUser(userId: string, limit?: number): Promise<StoredSession[]>;
  listAll(limit?: number): Promise<StoredSession[]>;
  stats(): Promise<SessionStats>;
}

export interface KnowledgeRepository {
  list(options?: { approvedOnly?: boolean }): Promise<KnowledgeEntry[]>;
  create(
    entry: Omit<KnowledgeEntry, "id" | "usageCount" | "createdAt" | "updatedAt">,
  ): Promise<KnowledgeEntry>;
  update(
    id: string,
    patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>,
  ): Promise<KnowledgeEntry | null>;
  approve(id: string, approved: boolean): Promise<KnowledgeEntry | null>;
  remove(id: string): Promise<boolean>;
  /** Approved entries relevant to a customer utterance, best match first. */
  search(
    text: string,
    options?: KnowledgeSearchOptions | number,
  ): Promise<KnowledgeEntry[]>;
  incrementUsage(id: string): Promise<void>;
}

export interface Repositories {
  backend: BackendKind;
  profiles: ProfileRepository;
  sessions: SessionRepository;
  knowledge: KnowledgeRepository;
}

/* ------------------------------------------------------------------ helpers */

function newId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${uuid}`;
}

export function createEmptyProfile(
  userId: string,
  email: string,
  name?: string,
): UserProfile {
  const now = new Date().toISOString();
  const fallbackName = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return {
    userId,
    email,
    name: name?.trim() || fallbackName || "Customer",
    phone: "",
    preferredLocale: DEFAULT_LOCALE,
    addresses: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function statsFromSessions(sessions: StoredSession[]): SessionStats {
  const byIntent: Record<string, number> = {};
  const byLocale: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let resolved = 0;
  let unresolved = 0;
  let escalated = 0;
  let outOfScope = 0;

  for (const s of sessions) {
    if (s.intent) byIntent[s.intent] = (byIntent[s.intent] ?? 0) + 1;
    byLocale[s.locale] = (byLocale[s.locale] ?? 0) + 1;
    byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
    if (s.resolution === "RESOLVED") resolved += 1;
    else if (s.resolution === "ESCALATION_REQUIRED") escalated += 1;
    else if (s.resolution === "OUT_OF_SCOPE") outOfScope += 1;
    else unresolved += 1;
  }

  const total = sessions.length;
  return {
    total,
    resolved,
    unresolved,
    escalated,
    outOfScope,
    resolutionRate: total === 0 ? 0 : resolved / total,
    byIntent,
    byLocale,
    byMode,
  };
}

/** Map a finished call outcome onto a persistable session record. */
export function sessionFromOutcome(
  outcome: CallOutcome,
  meta: {
    userId: string;
    userEmail: string;
    locale: Locale;
    turnCount: number;
    lastReply?: string | null;
    agentMetrics?: AgentSessionMetrics | null;
  },
): Omit<StoredSession, "id" | "createdAt"> {
  return {
    userId: meta.userId,
    userEmail: meta.userEmail,
    locale: meta.locale,
    mode: outcome.mode,
    intent: outcome.customer_intent,
    resolution: outcome.resolution_status,
    summary: outcome.call_summary,
    turnCount: meta.turnCount,
    unresolved: outcome.unresolved_issues,
    escalated: outcome.resolution_status === "ESCALATION_REQUIRED",
    lastReply: meta.lastReply?.trim() || null,
    agentMetrics: meta.agentMetrics ?? null,
  };
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "is", "are", "was", "were",
  "my", "your", "you", "i", "it", "this", "that", "with", "on", "in", "do",
  "does", "did", "can", "could", "would", "will", "be", "have", "has", "how",
  "what", "when", "where", "why", "please", "about", "me", "we",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u0DFF\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Levenshtein distance, early-exiting once it exceeds `max`. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length] <= max;
}

/**
 * How well one query token matches a document's token frequencies.
 * Exact hits score 1; a shared prefix or a single-character typo scores less,
 * so fuzzy matches never outrank a real, exact match.
 */
function matchStrength(termFreq: Map<string, number>, token: string): number {
  if (termFreq.has(token)) return 1;
  for (const candidate of termFreq.keys()) {
    if (token.length >= 4 && candidate.length >= 4 && (candidate.startsWith(token) || token.startsWith(candidate))) {
      return 0.7;
    }
  }
  if (token.length >= 5) {
    for (const candidate of termFreq.keys()) {
      if (candidate.length >= 5 && withinEditDistance(candidate, token, 1)) return 0.5;
    }
  }
  return 0;
}

export interface KnowledgeSearchOptions {
  intent?: Intent | null;
  locale?: Locale;
  limit?: number;
}

/**
 * Rank approved knowledge for a customer utterance.
 *
 * A small BM25-inspired scorer: rare query terms (high IDF) matter more, exact
 * matches beat fuzzy ones, and entries whose intent/locale match the current
 * turn are boosted. Deterministic and dependency-free.
 */
export function rankKnowledge(
  entries: KnowledgeEntry[],
  query: string,
  options: KnowledgeSearchOptions = {},
): KnowledgeEntry[] {
  const limit = options.limit ?? 3;
  const queryTokens = [...new Set(tokens(query))];
  if (queryTokens.length === 0 || entries.length === 0) return [];

  const docs = entries.map((entry) => {
    const docTokens = tokens(`${entry.question} ${entry.answer}`);
    const termFreq = new Map<string, number>();
    for (const token of docTokens) termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    return { entry, termFreq, length: docTokens.length };
  });

  const n = docs.length;
  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / n || 1;

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const doc of docs) if (matchStrength(doc.termFreq, token) > 0) count += 1;
    documentFrequency.set(token, count);
  }

  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((doc) => {
    let score = 0;
    for (const token of queryTokens) {
      const strength = matchStrength(doc.termFreq, token);
      if (strength <= 0) continue;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const tf = doc.termFreq.get(token) ?? 1;
      const denom = tf + k1 * (1 - b + (b * doc.length) / avgdl);
      score += idf * ((strength * tf * (k1 + 1)) / (denom || 1));
    }
    if (options.intent && doc.entry.intent === options.intent) score *= 1.35;
    if (options.locale && doc.entry.locale === options.locale) score *= 1.15;
    return { entry: doc.entry, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort(
      (a, b2) =>
        b2.score - a.score ||
        b2.entry.usageCount - a.entry.usageCount ||
        b2.entry.updatedAt.localeCompare(a.entry.updatedAt),
    )
    .slice(0, limit)
    .map((item) => item.entry);
}

/* --------------------------------------------------------------- memory impl */

interface MemoryStore {
  profiles: Map<string, UserProfile>;
  sessions: StoredSession[];
  knowledge: KnowledgeEntry[];
}

const globalForStore = globalThis as typeof globalThis & {
  __auraStore?: MemoryStore;
};

function memoryStore(): MemoryStore {
  if (!globalForStore.__auraStore) {
    globalForStore.__auraStore = {
      profiles: new Map(),
      sessions: [],
      knowledge: [],
    };
  }
  return globalForStore.__auraStore;
}

/** Clears the in-memory backend. Used by tests and dev helpers. */
export function resetMemoryStore(): void {
  globalForStore.__auraStore = {
    profiles: new Map(),
    sessions: [],
    knowledge: [],
  };
}

function cloneProfile(profile: UserProfile): UserProfile {
  return { ...profile, addresses: profile.addresses.map((a) => ({ ...a })) };
}

class MemoryProfileRepository implements ProfileRepository {
  async get(userId: string): Promise<UserProfile | null> {
    const found = memoryStore().profiles.get(userId);
    return found ? cloneProfile(found) : null;
  }

  async upsert(
    userId: string,
    patch: Partial<Omit<UserProfile, "userId" | "createdAt" | "updatedAt">>,
  ): Promise<UserProfile> {
    const existing =
      memoryStore().profiles.get(userId) ?? createEmptyProfile(userId, patch.email ?? userId);
    const updated: UserProfile = {
      ...existing,
      ...patch,
      userId,
      email: existing.email || patch.email || userId,
      addresses: patch.addresses ? patch.addresses.map((a) => ({ ...a })) : existing.addresses,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    memoryStore().profiles.set(userId, updated);
    return cloneProfile(updated);
  }

  async listAddresses(userId: string): Promise<Address[]> {
    return (await this.get(userId))?.addresses ?? [];
  }

  async addAddress(userId: string, address: Omit<Address, "id">): Promise<Address> {
    const profile = await this.upsert(userId, {});
    const created: Address = { ...address, id: newId("addr") };
    if (created.isDefault) {
      profile.addresses = profile.addresses.map((a) => ({ ...a, isDefault: false }));
    }
    if (profile.addresses.length === 0) created.isDefault = true;
    profile.addresses.push(created);
    await this.upsert(userId, { addresses: profile.addresses });
    return created;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    patch: Partial<Omit<Address, "id">>,
  ): Promise<Address | null> {
    const profile = await this.get(userId);
    if (!profile) return null;
    let updated: Address | null = null;
    const addresses = profile.addresses.map((addr) => {
      if (addr.id !== addressId) {
        return patch.isDefault ? { ...addr, isDefault: false } : addr;
      }
      updated = { ...addr, ...patch, id: addr.id };
      return updated;
    });
    if (!updated) return null;
    await this.upsert(userId, { addresses });
    return updated;
  }

  async removeAddress(userId: string, addressId: string): Promise<boolean> {
    const profile = await this.get(userId);
    if (!profile) return false;
    const filtered = profile.addresses.filter((a) => a.id !== addressId);
    if (filtered.length === profile.addresses.length) return false;
    if (filtered.length > 0 && !filtered.some((a) => a.isDefault)) {
      filtered[0] = { ...filtered[0], isDefault: true };
    }
    await this.upsert(userId, { addresses: filtered });
    return true;
  }
}

class MemorySessionRepository implements SessionRepository {
  async save(
    session: Omit<StoredSession, "id" | "createdAt"> & { createdAt?: string },
  ): Promise<StoredSession> {
    const stored: StoredSession = {
      ...session,
      id: newId("sess"),
      createdAt: session.createdAt ?? new Date().toISOString(),
    };
    const sessions = memoryStore().sessions;
    sessions.unshift(stored);
    if (sessions.length > 2_000) sessions.length = 2_000;
    return stored;
  }

  async listByUser(userId: string, limit = 50): Promise<StoredSession[]> {
    return memoryStore()
      .sessions.filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }

  async listAll(limit = 100): Promise<StoredSession[]> {
    return memoryStore()
      .sessions.slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }

  async stats(): Promise<SessionStats> {
    return statsFromSessions(memoryStore().sessions);
  }
}

class MemoryKnowledgeRepository implements KnowledgeRepository {
  async list(options?: { approvedOnly?: boolean }): Promise<KnowledgeEntry[]> {
    const items = memoryStore().knowledge.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const filtered = options?.approvedOnly ? items.filter((k) => k.approved) : items;
    return filtered.map((k) => ({ ...k }));
  }

  async create(
    entry: Omit<KnowledgeEntry, "id" | "usageCount" | "createdAt" | "updatedAt">,
  ): Promise<KnowledgeEntry> {
    const now = new Date().toISOString();
    const created: KnowledgeEntry = { ...entry, id: newId("know"), usageCount: 0, createdAt: now, updatedAt: now };
    memoryStore().knowledge.unshift(created);
    return { ...created };
  }

  async update(
    id: string,
    patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>,
  ): Promise<KnowledgeEntry | null> {
    const list = memoryStore().knowledge;
    const index = list.findIndex((k) => k.id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...patch, id, updatedAt: new Date().toISOString() };
    return { ...list[index] };
  }

  async approve(id: string, approved: boolean): Promise<KnowledgeEntry | null> {
    return this.update(id, { approved });
  }

  async remove(id: string): Promise<boolean> {
    const list = memoryStore().knowledge;
    const index = list.findIndex((k) => k.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }

  async search(text: string, options: KnowledgeSearchOptions | number = {}): Promise<KnowledgeEntry[]> {
    const opts = typeof options === "number" ? { limit: options } : options;
    const approved = memoryStore().knowledge.filter((k) => k.approved);
    return rankKnowledge(approved, text, opts).map((entry) => ({ ...entry }));
  }

  async incrementUsage(id: string): Promise<void> {
    const entry = memoryStore().knowledge.find((k) => k.id === id);
    if (entry) entry.usageCount += 1;
  }
}

export function memoryRepositories(): Repositories {
  return {
    backend: "memory",
    profiles: new MemoryProfileRepository(),
    sessions: new MemorySessionRepository(),
    knowledge: new MemoryKnowledgeRepository(),
  };
}

/* ----------------------------------------------------------------- mongo impl */

/**
 * Every index the repository methods rely on. Created once per process so
 * queries stay indexed on Atlas without a separate migration step.
 */
const MONGO_INDEXES: Array<{ collection: "profiles" | "sessions" | "knowledge"; spec: Record<string, 1 | -1>; options?: { unique?: boolean } }> = [
  { collection: "profiles", spec: { userId: 1 }, options: { unique: true } },
  { collection: "sessions", spec: { userId: 1, createdAt: -1 } },
  { collection: "sessions", spec: { createdAt: -1 } },
  { collection: "knowledge", spec: { id: 1 }, options: { unique: true } },
  { collection: "knowledge", spec: { approved: 1, updatedAt: -1 } },
];

const globalForIndexes = globalThis as typeof globalThis & {
  __auraMongoIndexes?: Promise<void>;
};

export function ensureMongoIndexes(db: Db): Promise<void> {
  if (globalForIndexes.__auraMongoIndexes) return globalForIndexes.__auraMongoIndexes;
  const work = Promise.all(
    MONGO_INDEXES.map(({ collection, spec, options }) =>
      db.collection(collection).createIndex(spec, options),
    ),
  ).then(() => undefined);
  // A failed bootstrap must never take the app down; queries still work, they
  // are just slower until the next process restart retries it.
  globalForIndexes.__auraMongoIndexes = work.catch(() => undefined);
  return globalForIndexes.__auraMongoIndexes;
}

function mongoRepositories(db: Db): Repositories {
  const profiles: Collection<UserProfile> = db.collection<UserProfile>("profiles");
  const sessions: Collection<StoredSession> = db.collection<StoredSession>("sessions");
  const knowledge: Collection<KnowledgeEntry> = db.collection<KnowledgeEntry>("knowledge");

  const profilesRepo: ProfileRepository = {
    async get(userId) {
      return profiles.findOne({ userId });
    },
    async upsert(userId, patch) {
      const existing = await profiles.findOne({ userId });
      const base = existing ?? createEmptyProfile(userId, patch.email ?? userId);
      const updated: UserProfile = {
        ...base,
        ...patch,
        userId,
        email: base.email || patch.email || userId,
        addresses: patch.addresses ?? existing?.addresses ?? [],
        createdAt: base.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await profiles.updateOne({ userId }, { $set: updated }, { upsert: true });
      return updated;
    },
    async listAddresses(userId) {
      const found = await profiles.findOne({ userId });
      return found?.addresses ?? [];
    },
    async addAddress(userId, address) {
      const profile = (await profiles.findOne({ userId })) ?? (await profilesRepo.upsert(userId, {}));
      const created: Address = { ...address, id: newId("addr") };
      let addresses = profile.addresses;
      if (created.isDefault) addresses = addresses.map((a) => ({ ...a, isDefault: false }));
      if (addresses.length === 0) created.isDefault = true;
      addresses = [...addresses, created];
      await profiles.updateOne({ userId }, { $set: { addresses, updatedAt: new Date().toISOString() } });
      return created;
    },
    async updateAddress(userId, addressId, patch) {
      const profile = await profiles.findOne({ userId });
      if (!profile) return null;
      let updated: Address | null = null;
      const addresses = profile.addresses.map((addr) => {
        if (addr.id !== addressId) return patch.isDefault ? { ...addr, isDefault: false } : addr;
        updated = { ...addr, ...patch, id: addr.id };
        return updated;
      });
      if (!updated) return null;
      await profiles.updateOne({ userId }, { $set: { addresses, updatedAt: new Date().toISOString() } });
      return updated;
    },
    async removeAddress(userId, addressId) {
      const profile = await profiles.findOne({ userId });
      if (!profile) return false;
      const filtered = profile.addresses.filter((a) => a.id !== addressId);
      if (filtered.length === profile.addresses.length) return false;
      if (filtered.length > 0 && !filtered.some((a) => a.isDefault)) {
        filtered[0] = { ...filtered[0], isDefault: true };
      }
      await profiles.updateOne({ userId }, { $set: { addresses: filtered, updatedAt: new Date().toISOString() } });
      return true;
    },
  };

  const sessionsRepo: SessionRepository = {
    async save(session) {
      const stored: StoredSession = {
        ...session,
        id: newId("sess"),
        createdAt: session.createdAt ?? new Date().toISOString(),
      };
      await sessions.insertOne(stored);
      return stored;
    },
    async listByUser(userId, limit = 50) {
      return sessions.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    },
    async listAll(limit = 100) {
      return sessions.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    },
    async stats() {
      const all = await sessions.find({}).limit(5_000).toArray();
      return statsFromSessions(all);
    },
  };

  const knowledgeRepo: KnowledgeRepository = {
    async list(options) {
      const filter = options?.approvedOnly ? { approved: true } : {};
      return knowledge.find(filter).sort({ updatedAt: -1 }).limit(500).toArray();
    },
    async create(entry) {
      const now = new Date().toISOString();
      const created: KnowledgeEntry = { ...entry, id: newId("know"), usageCount: 0, createdAt: now, updatedAt: now };
      await knowledge.insertOne(created);
      return created;
    },
    async update(id, patch) {
      const result = await knowledge.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: new Date().toISOString() } },
        { returnDocument: "after" },
      );
      return result ?? null;
    },
    async approve(id, approved) {
      return knowledgeRepo.update(id, { approved });
    },
    async remove(id) {
      const result = await knowledge.deleteOne({ id });
      return result.deletedCount === 1;
    },
    async search(text, options = {}) {
      const opts = typeof options === "number" ? { limit: options } : options;
      const approved = await knowledge.find({ approved: true }).limit(500).toArray();
      return rankKnowledge(approved, text, opts);
    },
    async incrementUsage(id) {
      await knowledge.updateOne({ id }, { $inc: { usageCount: 1 } });
    },
  };

  return { backend: "mongo", profiles: profilesRepo, sessions: sessionsRepo, knowledge: knowledgeRepo };
}

/* -------------------------------------------------------------- entry point */

export async function getRepositories(): Promise<Repositories> {
  if (isMongoConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        const repositories = mongoRepositories(db);
        // Ensure the collections are indexed before serving reads, but never
        // block or fail a request on it.
        void ensureMongoIndexes(db);
        return repositories;
      }
    } catch {
      // A misconfigured or unreachable database must never take the workspace
      // down; fall back to the in-memory store and keep serving.
    }
  }
  return memoryRepositories();
}
