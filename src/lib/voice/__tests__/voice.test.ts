import { describe, expect, it, vi } from "vitest";
import { mapRecognitionError } from "../adapter";
import { isMicrophoneSupported } from "../mic";
import { MockRecognizer, MockSynthesizer } from "../mock";
import { BrowserSpeechRecognizer, BrowserSpeechSynthesizer } from "../web-speech";

describe("error mapping", () => {
  it("maps permission denial to a recoverable, actionable message", () => {
    const result = mapRecognitionError("not-allowed");
    expect(result.code).toBe("not-allowed");
    expect(result.recoverable).toBe(true);
    expect(result.message.toLowerCase()).toContain("microphone");
  });
  it("maps audio-capture to missing device guidance", () => {
    expect(mapRecognitionError("audio-capture").code).toBe("audio-capture");
  });
  it("maps no-speech", () => {
    expect(mapRecognitionError("no-speech").code).toBe("no-speech");
  });
  it("defaults unknown errors", () => {
    expect(mapRecognitionError("weird").code).toBe("unknown");
  });
});

describe("browser adapters without a real speech API", () => {
  it("reports unsupported recognition and synthesis in a bare node environment", () => {
    const recognizer = new BrowserSpeechRecognizer();
    const synthesizer = new BrowserSpeechSynthesizer();
    expect(recognizer.isSupported()).toBe(false);
    expect(synthesizer.isSupported()).toBe(false);
  });

  it("emits an unsupported error instead of pretending to listen", () => {
    const recognizer = new BrowserSpeechRecognizer();
    const onError = vi.fn();
    recognizer.start({ onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].code).toBe("unsupported");
  });

  it("calls onEnd immediately when synthesis is unsupported", () => {
    const synthesizer = new BrowserSpeechSynthesizer();
    const onEnd = vi.fn();
    synthesizer.speak("hello", { onEnd });
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("does not expose microphone support in a bare node environment", () => {
    expect(isMicrophoneSupported()).toBe(false);
  });
});

describe("mock voice adapter", () => {
  it("delivers partial and final transcripts to handlers", () => {
    const recognizer = new MockRecognizer();
    const onPartial = vi.fn();
    const onFinal = vi.fn();
    recognizer.start({ onPartial, onFinal });
    recognizer.emitPartial("track");
    recognizer.emitFinal("track ORD-101");
    expect(onPartial).toHaveBeenCalledWith("track");
    expect(onFinal).toHaveBeenCalledWith("track ORD-101", 0.9);
  });

  it("tracks start/stop calls to prevent duplicate sessions", () => {
    const recognizer = new MockRecognizer();
    recognizer.start({});
    recognizer.start({});
    expect(recognizer.started).toBe(2);
    recognizer.stop();
    expect(recognizer.stopped).toBe(1);
  });

  it("records synthesized utterances", () => {
    const synthesizer = new MockSynthesizer();
    synthesizer.speak("Hello from Aria");
    expect(synthesizer.spoken).toEqual(["Hello from Aria"]);
  });

  it("reports unsupported recognizers honestly", () => {
    const recognizer = new MockRecognizer();
    recognizer.supported = false;
    const onError = vi.fn();
    recognizer.start({ onError });
    expect(onError.mock.calls[0][0].code).toBe("unsupported");
  });
});
