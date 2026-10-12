import {
  mapRecognitionError,
  type RecognizerHandlers,
  type SpeakOptions,
  type SpeechRecognizer,
  type SpeechSynthesizer,
  type VoiceAdapter,
  type VoiceCapabilities,
} from "./adapter";

/* Minimal ambient typings for the non-standard Web Speech API. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechRecognizer implements SpeechRecognizer {
  readonly id = "browser-web-speech";
  readonly label = "Browser Web Speech API";
  private recognition: SpeechRecognitionLike | null = null;
  private handlers: RecognizerHandlers = {};
  private listening = false;

  isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  start(handlers: RecognizerHandlers): void {
    this.handlers = handlers;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handlers.onError?.({
        code: "unsupported",
        message:
          "This browser does not support live speech recognition. Use the text input below.",
        recoverable: false,
      });
      return;
    }

    // Reuse a single instance to avoid duplicate sessions from repeated clicks.
    if (this.recognition && this.listening) return;

    const recognition = this.recognition ?? new Ctor();
    this.recognition = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.listening = true;
      this.handlers.onStart?.();
    };

    recognition.onresult = (event) => {
      if (!event.results) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result[0];
        if (!alternative) continue;
        const transcript = alternative.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) {
          this.handlers.onFinal?.(transcript, alternative.confidence ?? 0);
        } else {
          this.handlers.onPartial?.(transcript);
        }
      }
    };

    recognition.onerror = (event) => {
      // "aborted" is expected during intentional stop/cleanup.
      if (event.error === "aborted") return;
      this.handlers.onError?.(mapRecognitionError(event.error));
    };

    recognition.onend = () => {
      this.listening = false;
      this.handlers.onEnd?.();
    };

    try {
      recognition.start();
    } catch {
      // start() throws if called twice quickly; treat as already listening.
      this.listening = true;
    }
  }

  stop(): void {
    try {
      this.recognition?.stop();
    } catch {
      /* ignore */
    }
    this.listening = false;
  }

  abort(): void {
    try {
      this.recognition?.abort();
    } catch {
      /* ignore */
    }
    this.listening = false;
  }
}

export class BrowserSpeechSynthesizer implements SpeechSynthesizer {
  readonly id = "browser-speech-synthesis";
  readonly label = "Browser SpeechSynthesis API";

  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    if (!this.isSupported()) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return (
      voices.find((v) => v.lang === "en-IN") ??
      voices.find((v) => v.lang?.startsWith("en-GB")) ??
      voices.find((v) => v.lang?.startsWith("en")) ??
      voices[0]
    );
  }

  speak(text: string, options: SpeakOptions = {}): void {
    if (!this.isSupported()) {
      options.onEnd?.();
      return;
    }
    // Always cancel anything queued so responses do not stack up.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = options.lang ?? voice?.lang ?? "en-IN";
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      options.onEnd?.();
    };

    utterance.onstart = () => options.onStart?.();
    utterance.onboundary = () => options.onBoundary?.();
    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (!this.isSupported()) return;
    window.speechSynthesis.cancel();
  }
}

export function createBrowserVoiceAdapter(): VoiceAdapter {
  const recognizer = new BrowserSpeechRecognizer();
  const synthesizer = new BrowserSpeechSynthesizer();
  return {
    recognizer,
    synthesizer,
    capabilities(): VoiceCapabilities {
      const recognition = recognizer.isSupported();
      const synthesis = synthesizer.isSupported();
      return { recognition, synthesis, liveVoice: recognition };
    },
  };
}
