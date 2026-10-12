"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  initialSessionState,
  type ActivityEvent,
  type SessionState,
} from "@/lib/domain/orchestrator";
import type { CallOutcome } from "@/lib/domain/outcome";
import {
  appendTurn,
  createTurnId,
  type TranscriptTurn,
} from "@/lib/domain/transcript";
import type { Intent } from "@/lib/domain/types";
import type { VoiceAdapter, VoiceError } from "@/lib/voice/adapter";
import {
  isMicrophoneSupported,
  startMicMeter,
  type MicLevelMeter,
} from "@/lib/voice/mic";
import { createBrowserVoiceAdapter } from "@/lib/voice/web-speech";

import {
  agentGreeting,
  requestHealth,
  requestOutcome,
  requestTurn,
  resetLocalEngine,
  type HealthPayload,
  type InteractionMode,
} from "./engineClient";
import { SCENARIOS, type Scenario } from "./scenarios";

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "ended";

export type MicPermission = "unknown" | "granted" | "denied" | "unavailable";
export type ServerStatus = "checking" | "online" | "offline";

export interface VoiceCapabilities {
  recognition: boolean;
  synthesis: boolean;
}

export interface CallSessionApi {
  mounted: boolean;
  status: CallStatus;
  statusMessage: string;
  errorMessage: string | null;
  errorRecoverable: boolean;
  partialText: string;
  transcript: TranscriptTurn[];
  activity: ActivityEvent[];
  outcome: CallOutcome | null;
  history: CallOutcome[];
  capabilities: VoiceCapabilities;
  micPermission: MicPermission;
  micSupported: boolean;
  speakEnabled: boolean;
  serverStatus: ServerStatus;
  localAIAvailable: boolean;
  localAINote: string;
  aiUsed: boolean;
  interactionMode: InteractionMode;
  scenarioRunning: boolean;
  activeScenario: Scenario | null;
  elapsedSeconds: number;
  getMicLevel: () => number;
  startCall: () => void;
  endCall: () => void;
  resumeListening: () => void;
  submitText: (text: string) => void;
  runScenario: (scenario: Scenario) => void;
  setSpeakEnabled: (value: boolean) => void;
  clearHistory: () => void;
  dismissOutcome: () => void;
}

const HISTORY_KEY = "aura-voice-cx-outcomes-v1";
const HISTORY_LIMIT = 12;
const SCENARIO_STEP_DELAY_MS = 850;

function loadHistory(): CallOutcome[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CallOutcome[]).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function persistHistory(list: CallOutcome[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
  } catch {
    /* storage may be unavailable; history is a convenience only */
  }
}

export function useCallSession(): CallSessionApi {
  const adapterRef = useRef<VoiceAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = createBrowserVoiceAdapter();
  const adapter = adapterRef.current;

  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Press Start Call to speak with Aria, or type a message below.",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorRecoverable, setErrorRecoverable] = useState(false);
  const [partialText, setPartialText] = useState("");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>(initialSessionState);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [history, setHistory] = useState<CallOutcome[]>([]);
  const [capabilities, setCapabilities] = useState<VoiceCapabilities>({
    recognition: false,
    synthesis: false,
  });
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const [micSupported, setMicSupported] = useState(false);
  const [speakEnabled, setSpeakEnabledState] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [localAIAvailable, setLocalAIAvailable] = useState(false);
  const [localAINote, setLocalAINote] = useState("");
  const [aiUsed, setAiUsed] = useState(false);
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);

  const statusRef = useRef<CallStatus>("idle");
  const sessionRef = useRef<SessionState>(sessionState);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const startingRef = useRef(false);
  const scenarioRunningRef = useRef(false);
  const speakEnabledRef = useRef(true);
  const aiUsedRef = useRef(false);
  const modeRef = useRef<InteractionMode>("text-fallback");
  const meterRef = useRef<MicLevelMeter | null>(null);
  const beginListeningRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  // Incremented whenever a session starts or ends so in-flight turns and
  // speech callbacks from a previous session are discarded instead of
  // overwriting the current call state.
  const sessionTokenRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    speakEnabledRef.current = speakEnabled;
  }, [speakEnabled]);

  const interactionMode: InteractionMode = capabilities.recognition
    ? "browser-voice"
    : "text-fallback";

  useEffect(() => {
    const effective: InteractionMode = scenarioRunning
      ? "scenario"
      : aiUsed
        ? "local-ai"
        : interactionMode;
    modeRef.current = effective;
  }, [interactionMode, aiUsed, scenarioRunning]);

  /* ------------------------------------------------------------------ setup */

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    const caps = adapter.capabilities();
    setCapabilities({ recognition: caps.recognition, synthesis: caps.synthesis });
    setMicSupported(isMicrophoneSupported());
    setSpeakEnabledState(caps.synthesis);
    setHistory(loadHistory());

    let cancelled = false;
    void requestHealth().then((health: HealthPayload | null) => {
      if (cancelled) return;
      if (!health) {
        setServerStatus("offline");
        setLocalAINote("Server health could not be verified.");
        return;
      }
      setServerStatus(health.ok ? "online" : "offline");
      setLocalAIAvailable(Boolean(health.localAI?.available));
      setLocalAINote(health.localAI?.note ?? "");
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      activeRef.current = false;
      adapter.recognizer.abort();
      adapter.synthesizer.cancel();
      meterRef.current?.stop();
      meterRef.current = null;
    };
  }, [adapter]);

  /* --------------------------------------------------------------- duration */

  useEffect(() => {
    if (callStartedAt === null) {
      setElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      if (!activeRef.current) return;
      setElapsedSeconds(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callStartedAt]);

  /* ------------------------------------------------------------- lifecycle */

  const cleanupAudio = useCallback(() => {
    adapter.recognizer.abort();
    adapter.synthesizer.cancel();
    meterRef.current?.stop();
    meterRef.current = null;
  }, [adapter]);

  const resetSession = useCallback(() => {
    const fresh = initialSessionState();
    sessionRef.current = fresh;
    setSessionState(fresh);
    transcriptRef.current = [];
    setTranscript([]);
    setActivity([]);
    setPartialText("");
    setAiUsed(false);
    aiUsedRef.current = false;
    setErrorMessage(null);
    setErrorRecoverable(false);
  }, []);

  const appendCustomerTurn = useCallback(
    (text: string, source: TranscriptTurn["source"]) => {
      const turn: TranscriptTurn = {
        id: createTurnId(),
        speaker: "customer",
        text,
        at: new Date().toISOString(),
        source,
      };
      transcriptRef.current = appendTurn(transcriptRef.current, turn);
      setTranscript(transcriptRef.current);
      return turn;
    },
    [],
  );

  const appendAgentTurn = useCallback(
    (text: string, intent: Intent | null, source: TranscriptTurn["source"]) => {
      const turn: TranscriptTurn = {
        id: createTurnId(),
        speaker: "agent",
        text,
        at: new Date().toISOString(),
        source,
        intent: intent ?? undefined,
      };
      transcriptRef.current = appendTurn(transcriptRef.current, turn);
      setTranscript(transcriptRef.current);
      return turn;
    },
    [],
  );

  const finalizeOutcome = useCallback(async () => {
    const response = await requestOutcome(sessionRef.current, modeRef.current);
    if (!mountedRef.current) return;
    if (response.ok && response.outcome) {
      setOutcome(response.outcome);
      setHistory((prev) => {
        const next = [response.outcome as CallOutcome, ...prev].slice(0, HISTORY_LIMIT);
        persistHistory(next);
        return next;
      });
    } else {
      setOutcome(null);
      setErrorMessage(response.message ?? "The call outcome could not be generated.");
    }
  }, []);

  const resumeAfterAgent = useCallback(() => {
    if (scenarioRunningRef.current) {
      setStatus("thinking");
      return;
    }
    if (activeRef.current) {
      beginListeningRef.current();
    } else {
      setStatus("idle");
    }
  }, []);

  const processUtterance = useCallback(
    async (
      rawText: string,
      source: TranscriptTurn["source"],
      options: { speak: boolean } = { speak: true },
    ) => {
      const text = rawText.trim();
      if (!text) {
        setPartialText("");
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;

      // Stop capturing while we think so Aria's own voice is never transcribed.
      adapter.recognizer.abort();
      setPartialText("");
      appendCustomerTurn(text, source);
      setStatus("thinking");
      setStatusMessage("Checking that for you…");

      let response;
      try {
        response = await requestTurn(text, sessionRef.current, modeRef.current);
      } catch (error) {
        busyRef.current = false;
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "The support engine failed.",
        );
        setErrorRecoverable(true);
        return;
      }

      if (!mountedRef.current) {
        busyRef.current = false;
        return;
      }

      if (!response.ok || !response.result) {
        busyRef.current = false;
        setStatus("error");
        setErrorMessage(
          response.message ??
            "The support engine could not process that. Please try again or type a shorter message.",
        );
        setErrorRecoverable(true);
        return;
      }

      const result = response.result;
      aiUsedRef.current = aiUsedRef.current || response.aiUsed;
      setAiUsed(aiUsedRef.current);
      sessionRef.current = result.state;
      setSessionState(result.state);
      setActivity((prev) => [...prev, ...result.events]);
      appendAgentTurn(result.reply, result.intent, source);
      setStatusMessage(result.reply);

      if (options.speak && speakEnabledRef.current && adapter.synthesizer.isSupported()) {
        setStatus("speaking");
        adapter.synthesizer.speak(result.reply, {
          onEnd: () => {
            busyRef.current = false;
            if (mountedRef.current) resumeAfterAgent();
          },
        });
      } else {
        busyRef.current = false;
        resumeAfterAgent();
      }
    },
    [adapter, appendAgentTurn, appendCustomerTurn, resumeAfterAgent],
  );

  const handleVoiceError = useCallback(
    (error: VoiceError) => {
      if (error.code === "aborted") return;
      if (error.code === "no-speech") {
        setStatusMessage("I did not catch that — listening again.");
        return;
      }
      if (
        error.code === "not-allowed" ||
        error.code === "audio-capture" ||
        error.code === "unsupported"
      ) {
        activeRef.current = false;
        cleanupAudio();
        setMicPermission(
          error.code === "not-allowed" ? "denied" : "unavailable",
        );
        setStatus("error");
        setErrorMessage(error.message);
        setErrorRecoverable(false);
        return;
      }
      setStatus("error");
      setErrorMessage(error.message);
      setErrorRecoverable(error.recoverable);
    },
    [cleanupAudio],
  );

  const beginListening = useCallback(() => {
    if (!activeRef.current) return;
    const recognizer = adapter.recognizer;
    if (!recognizer.isSupported()) {
      setStatus("error");
      setErrorMessage(
        "Live speech recognition is unavailable in this browser. Please type your message below.",
      );
      setErrorRecoverable(false);
      return;
    }
    setStatus("listening");
    setStatusMessage("Listening… speak naturally.");
    recognizer.start({
      onPartial: (text) => setPartialText(text),
      onFinal: (text) => {
        setPartialText("");
        void processUtterance(text, "voice");
      },
      onError: (error: VoiceError) => handleVoiceError(error),
      onEnd: () => {
        // Chrome ends continuous recognition on silence; restart if we are
        // still in an active, idle listening state.
        if (
          activeRef.current &&
          !busyRef.current &&
          statusRef.current === "listening"
        ) {
          window.setTimeout(() => {
            if (
              activeRef.current &&
              !busyRef.current &&
              statusRef.current === "listening"
            ) {
              beginListeningRef.current();
            }
          }, 250);
        }
      },
    });
  }, [adapter, processUtterance, handleVoiceError]);

  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  const startCall = useCallback(async () => {
    if (startingRef.current) return;
    if (
      statusRef.current === "connecting" ||
      statusRef.current === "listening" ||
      statusRef.current === "thinking" ||
      statusRef.current === "speaking"
    ) {
      return;
    }
    if (!adapter.recognizer.isSupported()) return;

    startingRef.current = true;
    scenarioRunningRef.current = false;
    setScenarioRunning(false);
    setActiveScenario(null);
    resetLocalEngine();
    resetSession();
    setOutcome(null);
    activeRef.current = true;
    setStatus("connecting");
    setStatusMessage("Connecting to Aria…");
    setCallStartedAt(Date.now());
    setElapsedSeconds(0);

    try {
      const meter = await startMicMeter();
      if (!mountedRef.current || !activeRef.current) {
        meter.stop();
        startingRef.current = false;
        return;
      }
      meterRef.current = meter;
      setMicPermission("granted");
    } catch (error) {
      const voiceError = error as VoiceError;
      activeRef.current = false;
      setMicPermission(
        voiceError.code === "not-allowed" ? "denied" : "unavailable",
      );
      setStatus("error");
      setErrorMessage(
        voiceError.message ??
          "The microphone could not be started. You can type your message below.",
      );
      setErrorRecoverable(false);
      startingRef.current = false;
      return;
    }

    const greeting = agentGreeting();
    appendAgentTurn(greeting, null, "voice");
    setStatusMessage(greeting);

    if (speakEnabledRef.current && adapter.synthesizer.isSupported()) {
      setStatus("speaking");
      adapter.synthesizer.speak(greeting, {
        onEnd: () => {
          startingRef.current = false;
          if (mountedRef.current && activeRef.current) beginListeningRef.current();
        },
      });
    } else {
      startingRef.current = false;
      beginListeningRef.current();
    }
  }, [adapter, appendAgentTurn, resetSession]);

  const endCall = useCallback(() => {
    activeRef.current = false;
    startingRef.current = false;
    busyRef.current = false;
    scenarioRunningRef.current = false;
    cleanupAudio();
    setPartialText("");
    setStatus("ended");
    setStatusMessage("Call ended. Your transcript and summary are ready below.");
    setCallStartedAt(null);
    void finalizeOutcome();
  }, [cleanupAudio, finalizeOutcome]);

  const resumeListening = useCallback(() => {
    if (!activeRef.current) {
      setErrorMessage(null);
      setErrorRecoverable(false);
      void startCall();
      return;
    }
    setErrorMessage(null);
    setErrorRecoverable(false);
    beginListeningRef.current();
  }, [startCall]);

  const submitText = useCallback(
    (text: string) => {
      if (scenarioRunningRef.current) return;
      void processUtterance(text, "text");
    },
    [processUtterance],
  );

  const runScenario = useCallback(
    async (scenario: Scenario) => {
      if (activeRef.current || scenarioRunningRef.current) return;
      scenarioRunningRef.current = true;
      setScenarioRunning(true);
      setActiveScenario(scenario);
      resetLocalEngine();
      resetSession();
      setOutcome(null);
      setCallStartedAt(Date.now());
      setElapsedSeconds(0);
      setStatus("thinking");
      setStatusMessage(`Running scripted scenario: ${scenario.label}…`);

      // Seed the scenario as a clearly-labelled system turn.
      const seed: TranscriptTurn = {
        id: createTurnId(),
        speaker: "system",
        text: `Scripted scenario started: ${scenario.label} (${scenario.description}). This is a scripted playback through the real engine, not live microphone input.`,
        at: new Date().toISOString(),
        source: "scenario",
      };
      transcriptRef.current = appendTurn(transcriptRef.current, seed);
      setTranscript(transcriptRef.current);

      for (const utterance of scenario.utterances) {
        setStatus("thinking");
        setStatusMessage(`Scripted scenario: customer says “${utterance}”`);
        await new Promise((resolve) =>
          window.setTimeout(resolve, SCENARIO_STEP_DELAY_MS),
        );
        // Route through the real engine without speaking, and without touching
        // the microphone. `busyRef` is managed inside processUtterance.
        await processUtterance(utterance, "scenario", { speak: false });
        // processUtterance returns after the reply is appended (no speech).
        if (!mountedRef.current) return;
      }

      const response = await requestOutcome(sessionRef.current, "scenario");
      if (!mountedRef.current) return;
      if (response.ok && response.outcome) {
        setOutcome(response.outcome);
        setHistory((prev) => {
          const next = [response.outcome as CallOutcome, ...prev].slice(
            0,
            HISTORY_LIMIT,
          );
          persistHistory(next);
          return next;
        });
      }
      scenarioRunningRef.current = false;
      setScenarioRunning(false);
      setStatus("ended");
      setStatusMessage(
        `Scenario complete: ${scenario.label}. Inspect the outcome below.`,
      );
      setCallStartedAt(null);
    },
    [processUtterance, resetSession],
  );

  const setSpeakEnabled = useCallback((value: boolean) => {
    setSpeakEnabledState(value);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(HISTORY_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const dismissOutcome = useCallback(() => {
    setOutcome(null);
  }, []);

  const getMicLevel = useCallback((): number => {
    return meterRef.current?.getLevel() ?? 0;
  }, []);

  return useMemo<CallSessionApi>(
    () => ({
      mounted,
      status,
      statusMessage,
      errorMessage,
      errorRecoverable,
      partialText,
      transcript,
      activity,
      outcome,
      history,
      capabilities,
      micPermission,
      micSupported,
      speakEnabled,
      serverStatus,
      localAIAvailable,
      localAINote,
      aiUsed,
      interactionMode,
      scenarioRunning,
      activeScenario,
      elapsedSeconds,
      getMicLevel,
      startCall: () => void startCall(),
      endCall,
      resumeListening,
      submitText,
      runScenario: (scenario: Scenario) => void runScenario(scenario),
      setSpeakEnabled,
      clearHistory,
      dismissOutcome,
    }),
    [
      mounted,
      status,
      statusMessage,
      errorMessage,
      errorRecoverable,
      partialText,
      transcript,
      activity,
      outcome,
      history,
      capabilities,
      micPermission,
      micSupported,
      speakEnabled,
      serverStatus,
      localAIAvailable,
      localAINote,
      aiUsed,
      interactionMode,
      scenarioRunning,
      activeScenario,
      elapsedSeconds,
      getMicLevel,
      startCall,
      endCall,
      resumeListening,
      submitText,
      runScenario,
      setSpeakEnabled,
      clearHistory,
      dismissOutcome,
    ],
  );
}

export { SCENARIOS };
