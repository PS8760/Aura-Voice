import { INTENTS } from "@/lib/domain/outcome";
import type { Intent } from "@/lib/domain/types";

/**
 * Optional local-AI adapter (Ollama).
 *
 * This is strictly optional. The deterministic engine fully handles the
 * assessed flows without it. When Ollama is reachable, it is used only to
 * *propose* an intent for utterances the deterministic classifier could not
 * classify. Every policy decision remains enforced in application code.
 */

const DEFAULT_BASE_URL =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const PROBE_TIMEOUT_MS = 900;

export interface LocalAiStatus {
  enabled: boolean;
  available: boolean;
  endpoint: string;
  model: string;
  models: string[];
  note: string;
}

export function localAiEnabled(): boolean {
  return process.env.AURA_ENABLE_LOCAL_AI !== "false";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOllama(
  fetchImpl: typeof fetch = fetch,
): Promise<LocalAiStatus> {
  const base: LocalAiStatus = {
    enabled: localAiEnabled(),
    available: false,
    endpoint: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    models: [],
    note: "Local AI is optional and disabled by default in the public demo.",
  };

  if (!base.enabled) {
    return { ...base, note: "Local AI disabled via AURA_ENABLE_LOCAL_AI=false." };
  }

  try {
    const res = await fetchWithTimeout(
      `${DEFAULT_BASE_URL}/api/tags`,
      { method: "GET", headers: { Accept: "application/json" } },
      PROBE_TIMEOUT_MS,
      fetchImpl,
    );
    if (!res.ok) {
      return {
        ...base,
        note: `Ollama responded with status ${res.status}; treating local AI as unavailable.`,
      };
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => Boolean(n));
    return {
      ...base,
      available: true,
      models,
      note: models.length
        ? `Ollama reachable with ${models.length} model(s).`
        : "Ollama reachable but no models are installed.",
    };
  } catch {
    return {
      ...base,
      note: "Ollama is not reachable on this host. Running in deterministic-only mode.",
    };
  }
}

const SYSTEM_PROMPT = [
  "You classify customer support messages for an Indian skincare brand.",
  "Return ONLY compact JSON: {\"intent\": \"<INTENT>\"}.",
  "Allowed intents are:",
  INTENTS.join(", "),
  "If unsure, return {\"intent\":\"UNKNOWN\"}.",
  "Do not add explanations.",
].join(" ");

/**
 * Ask the local model to propose an intent. Returns null on any failure so the
 * caller always falls back to the deterministic classifier.
 */
export async function classifyWithOllama(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Intent | null> {
  if (!localAiEnabled()) return null;
  try {
    const res = await fetchWithTimeout(
      `${DEFAULT_BASE_URL}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          prompt: `${SYSTEM_PROMPT}\n\nMessage: ${text}`,
          stream: false,
          format: "json",
          options: { temperature: 0 },
        }),
      },
      2500,
      fetchImpl,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    const parsed = JSON.parse(data.response) as { intent?: string };
    const intent = parsed.intent?.trim().toUpperCase();
    if (intent && (INTENTS as readonly string[]).includes(intent)) {
      return intent as Intent;
    }
    return null;
  } catch {
    return null;
  }
}
