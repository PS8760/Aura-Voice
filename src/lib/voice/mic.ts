import type { VoiceError } from "./adapter";

export interface MicLevelMeter {
  /** Latest RMS amplitude, 0..1. Safe to call from a render loop. */
  getLevel(): number;
  stop(): void;
  readonly stream: MediaStream;
}

export function isMicrophoneSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Opens the microphone once and exposes the live input amplitude. Used to
 * drive the listening rings from real audio, and to surface honest permission
 * and device errors.
 */
export async function startMicMeter(): Promise<MicLevelMeter> {
  if (!isMicrophoneSupported()) {
    const error: VoiceError = {
      code: "unsupported",
      message: "This browser does not expose microphone access.",
      recoverable: true,
    };
    throw error;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const AudioCtor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtor) {
    stream.getTracks().forEach((t) => t.stop());
    const error: VoiceError = {
      code: "unsupported",
      message:
        "Web Audio is unavailable, so microphone levels cannot be measured. Voice input still works.",
      recoverable: true,
    };
    throw error;
  }

  const context = new AudioCtor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let frame = 0;
  let level = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buffer.length);
    // Smooth and normalise into a pleasant 0..1 range.
    level = level * 0.6 + Math.min(1, rms * 3.2) * 0.4;
    frame = requestAnimationFrame(tick);
  };
  tick();

  return {
    getLevel: () => level,
    stream,
    stop: () => {
      cancelAnimationFrame(frame);
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
      void context.close().catch(() => undefined);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
