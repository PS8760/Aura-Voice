"use client";

import { useEffect, useRef } from "react";
import { Check, Leaf, Waves } from "lucide-react";

import type { CallStatus } from "@/lib/client/useCallSession";
import { cn } from "@/lib/client/cn";

const BAR_COUNT = 27;

const CORE_STYLES: Record<CallStatus, string> = {
  idle: "from-forest to-forest-deep",
  connecting: "from-sage to-forest",
  listening: "from-sage to-forest",
  thinking: "from-forest to-forest-deep",
  speaking: "from-forest to-forest-deep",
  error: "from-rust to-rust",
  ended: "from-sage to-sage-ink",
};

export function VoiceOrb({
  status,
  getLevel,
  reducedMotion,
}: {
  status: CallStatus;
  getLevel: () => number;
  reducedMotion: boolean;
}) {
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const ringRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const active = status === "listening" || status === "speaking";
    const bars = barRefs.current;
    const rings = ringRefs.current;

    const reset = () => {
      bars.forEach((bar, i) => {
        if (bar) bar.style.transform = `scaleY(${0.16 + (i % 2) * 0.05})`;
      });
      rings.forEach((ring, idx) => {
        if (!ring) return;
        ring.style.transform = "scale(1)";
        ring.style.opacity = idx === 0 ? "0.35" : "0.16";
      });
    };

    if (!active || reducedMotion) {
      reset();
      return;
    }

    let raf = 0;
    let t = 0;
    const middle = (BAR_COUNT - 1) / 2;

    const loop = () => {
      t += 0.07;
      const level = status === "listening" ? getLevel() : 0;

      bars.forEach((bar, i) => {
        if (!bar) return;
        const center = 1 - Math.abs(i - middle) / middle;
        const wave = 0.5 + 0.5 * Math.sin(t * 2 + i * 0.55);
        const energy =
          status === "listening"
            ? level * (0.35 + 0.65 * wave)
            : (0.5 + 0.5 * Math.sin(t * 3 + i * 0.7)) * 0.32;
        const height = 0.1 + energy * (0.45 + 0.55 * center);
        bar.style.transform = `scaleY(${Math.min(1, Math.max(0.08, height))})`;
      });

      rings.forEach((ring, idx) => {
        if (!ring) return;
        const drive =
          status === "listening"
            ? level
            : 0.22 + 0.16 * Math.sin(t * 2 - idx * 0.9);
        const scale = 1 + Math.max(0, drive) * (0.28 + idx * 0.2);
        ring.style.transform = `scale(${scale})`;
        ring.style.opacity = String(
          Math.max(0.04, 0.4 - idx * 0.12 - (status === "listening" ? level * 0.12 : 0)),
        );
      });

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status, getLevel, reducedMotion]);

  return (
    <div className="relative flex h-[236px] w-[236px] items-center justify-center">
      {/* Expanding rings driven by real microphone level / speaking state. */}
      {[0, 1, 2].map((idx) => (
        <div
          key={idx}
          ref={(node) => {
            ringRefs.current[idx] = node;
          }}
          aria-hidden
          className={cn(
            "absolute rounded-full border transition-opacity",
            status === "error"
              ? "border-rust/40"
              : status === "listening"
                ? "border-sage/70"
                : "border-forest/30",
          )}
          style={{
            width: 132 + idx * 34,
            height: 132 + idx * 34,
            opacity: 0.2,
          }}
        />
      ))}

      {/* Thinking progress arc. */}
      {status === "thinking" ? (
        <div
          aria-hidden
          className={cn(
            "absolute h-[150px] w-[150px] rounded-full border-2 border-transparent border-t-forest/70 border-r-forest/25",
            !reducedMotion && "animate-spin [animation-duration:2.4s]",
          )}
        />
      ) : null}

      {/* Core. */}
      <div
        aria-hidden
        className={cn(
          "relative z-10 flex h-[112px] w-[112px] items-center justify-center rounded-full bg-gradient-to-br text-canvas shadow-[0_18px_40px_-18px_rgba(33,56,44,0.55)] transition-transform duration-500",
          CORE_STYLES[status],
          status === "connecting" && !reducedMotion && "animate-pulse",
          status === "ended" && "opacity-90",
        )}
      >
        {status === "ended" ? (
          <Check size={30} strokeWidth={1.75} />
        ) : status === "error" ? (
          <span className="text-2xl font-medium">!</span>
        ) : status === "idle" ? (
          <Leaf size={26} strokeWidth={1.6} />
        ) : (
          <Waves size={26} strokeWidth={1.6} />
        )}

        {/* Waveform sits inside the core, subtle and legible. */}
        <div className="absolute bottom-4 flex h-6 items-end gap-[2px]" aria-hidden>
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <span
              key={i}
              ref={(node) => {
                barRefs.current[i] = node;
              }}
              className="w-[2px] origin-bottom rounded-full bg-canvas/80"
              style={{ height: 22, transform: "scaleY(0.16)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
