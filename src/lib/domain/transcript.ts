import type { Intent } from "./types";

export type Speaker = "customer" | "agent" | "system";

export interface TranscriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  /** ISO timestamp captured when the turn was produced. */
  at: string;
  intent?: Intent;
  /** Set for scripted scenario playback so it is never confused with live voice. */
  source?: "voice" | "text" | "scenario" | "system";
}

export interface TranscriptFilter {
  speaker?: Speaker | "all";
  query?: string;
}

let turnCounter = 0;
export function createTurnId(): string {
  turnCounter += 1;
  return `turn_${turnCounter.toString(36)}_${Date.now().toString(36)}`;
}

export function appendTurn(
  transcript: TranscriptTurn[],
  turn: Omit<TranscriptTurn, "id"> & { id?: string },
): TranscriptTurn[] {
  return [...transcript, { ...turn, id: turn.id ?? createTurnId() }];
}

/** Returns a copy sorted oldest-first. Ties preserve insertion order. */
export function sortChronologically(
  transcript: TranscriptTurn[],
): TranscriptTurn[] {
  return transcript
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => {
      const diff = Date.parse(a.turn.at) - Date.parse(b.turn.at);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ turn }) => turn);
}

export function filterTranscript(
  transcript: TranscriptTurn[],
  filter: TranscriptFilter,
): TranscriptTurn[] {
  const speaker = filter.speaker ?? "all";
  const query = (filter.query ?? "").trim().toLowerCase();
  return transcript.filter((turn) => {
    if (speaker !== "all" && turn.speaker !== speaker) return false;
    if (query && !turn.text.toLowerCase().includes(query)) return false;
    return true;
  });
}

/**
 * Build a plain-text transcript. If the transcript is empty we return an
 * explicit notice rather than fabricating conversation turns.
 */
export function formatTranscriptText(
  transcript: TranscriptTurn[],
  meta?: { sessionId?: string; startedAt?: string },
): string {
  if (transcript.length === 0) {
    return [
      "Aura Voice CX transcript",
      "========================",
      "No conversation turns were captured for this session.",
      "The transcript cannot be reconstructed because no interaction occurred.",
    ].join("\n");
  }

  const ordered = sortChronologically(transcript);
  const lines = ordered.map((turn) => {
    const time = new Date(turn.at).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const label =
      turn.speaker === "customer"
        ? "Customer"
        : turn.speaker === "agent"
          ? "Aria (Aura Voice CX)"
          : "System";
    const suffix = turn.source === "scenario" ? " [scripted scenario]" : "";
    return `[${time}] ${label}${suffix}: ${turn.text}`;
  });

  const header = [
    "Aura Voice CX transcript",
    "========================",
    meta?.sessionId ? `Session: ${meta.sessionId}` : null,
    meta?.startedAt ? `Started: ${meta.startedAt}` : null,
    `Turns: ${ordered.length}`,
    "",
  ].filter((line): line is string => line !== null);

  return [...header, ...lines].join("\n");
}

export interface TranscriptIntegrity {
  ok: boolean;
  missing: string[];
}

/**
 * Honest transcript validation. Rather than invent content, we report what is
 * missing so the post-call panel can show a limitation.
 */
export function validateTranscriptIntegrity(
  transcript: TranscriptTurn[],
): TranscriptIntegrity {
  const missing: string[] = [];
  if (transcript.length === 0) {
    missing.push("No conversation turns were captured.");
    return { ok: false, missing };
  }
  if (!transcript.some((t) => t.speaker === "customer")) {
    missing.push("No customer turns were captured.");
  }
  if (!transcript.some((t) => t.speaker === "agent")) {
    missing.push("No agent responses were captured.");
  }
  return { ok: missing.length === 0, missing };
}
