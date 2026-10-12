/**
 * Voice adapter abstraction.
 *
 * The UI depends only on these interfaces. The browser Web Speech
 * implementation ships today; a local Vosk recognizer or Piper synthesizer
 * could be added by implementing the same contract without touching the UI or
 * the orchestration layer.
 */

export type VoiceErrorCode =
  | "unsupported"
  | "not-allowed"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "unknown";

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
  recoverable: boolean;
}

export interface RecognizerHandlers {
  onPartial?: (text: string) => void;
  onFinal?: (text: string, confidence: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: VoiceError) => void;
}

export interface SpeechRecognizer {
  readonly id: string;
  readonly label: string;
  isSupported(): boolean;
  start(handlers: RecognizerHandlers): void;
  stop(): void;
  abort(): void;
}

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: () => void;
  rate?: number;
  pitch?: number;
  lang?: string;
}

export interface SpeechSynthesizer {
  readonly id: string;
  readonly label: string;
  isSupported(): boolean;
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
}

export interface VoiceCapabilities {
  recognition: boolean;
  synthesis: boolean;
  /** True when live speech input is genuinely available in this browser. */
  liveVoice: boolean;
}

export interface VoiceAdapter {
  readonly recognizer: SpeechRecognizer;
  readonly synthesizer: SpeechSynthesizer;
  capabilities(): VoiceCapabilities;
}

export function mapRecognitionError(code: string): VoiceError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: "not-allowed",
        message:
          "Microphone access was blocked. Enable it in your browser settings, or type your message below.",
        recoverable: true,
      };
    case "audio-capture":
      return {
        code: "audio-capture",
        message:
          "No microphone was found. Connect a microphone or use the text input below.",
        recoverable: true,
      };
    case "no-speech":
      return {
        code: "no-speech",
        message: "I did not hear anything. Please try again.",
        recoverable: true,
      };
    case "network":
      return {
        code: "network",
        message:
          "Speech recognition lost its connection. You can retry or type your message below.",
        recoverable: true,
      };
    case "aborted":
      return { code: "aborted", message: "Listening stopped.", recoverable: true };
    default:
      return {
        code: "unknown",
        message:
          "Speech recognition hit an unexpected error. You can retry or type your message below.",
        recoverable: true,
      };
  }
}
