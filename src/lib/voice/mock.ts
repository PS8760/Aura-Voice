import type {
  RecognizerHandlers,
  SpeakOptions,
  SpeechRecognizer,
  SpeechSynthesizer,
  VoiceError,
} from "./adapter";

/** Deterministic fake recognizer for tests and scripted scenarios. */
export class MockRecognizer implements SpeechRecognizer {
  readonly id = "mock-recognizer";
  readonly label = "Mock recognizer";
  supported = true;
  started = 0;
  stopped = 0;
  private handlers: RecognizerHandlers = {};

  isSupported(): boolean {
    return this.supported;
  }

  start(handlers: RecognizerHandlers): void {
    if (!this.supported) {
      handlers.onError?.({
        code: "unsupported",
        message: "unsupported",
        recoverable: false,
      });
      return;
    }
    this.handlers = handlers;
    this.started += 1;
    handlers.onStart?.();
  }

  stop(): void {
    this.stopped += 1;
    this.handlers.onEnd?.();
  }

  abort(): void {
    this.stopped += 1;
  }

  emitPartial(text: string): void {
    this.handlers.onPartial?.(text);
  }

  emitFinal(text: string, confidence = 0.9): void {
    this.handlers.onFinal?.(text, confidence);
  }

  emitError(error: VoiceError): void {
    this.handlers.onError?.(error);
  }
}

/** Deterministic fake synthesizer for tests. */
export class MockSynthesizer implements SpeechSynthesizer {
  readonly id = "mock-synthesizer";
  readonly label = "Mock synthesizer";
  supported = true;
  spoken: string[] = [];
  cancelled = 0;

  isSupported(): boolean {
    return this.supported;
  }

  speak(text: string, options: SpeakOptions = {}): void {
    if (!this.supported) {
      options.onEnd?.();
      return;
    }
    this.spoken.push(text);
    options.onStart?.();
    options.onBoundary?.();
    options.onEnd?.();
  }

  cancel(): void {
    this.cancelled += 1;
  }
}
