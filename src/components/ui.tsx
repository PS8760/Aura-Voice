import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside" | "article";
}) {
  return (
    <Tag
      className={cn(
        "rounded-[14px] border border-line bg-panel shadow-[0_1px_2px_rgba(43,40,35,0.04),0_8px_24px_-16px_rgba(43,40,35,0.18)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2.5">
        {icon ? <span className="text-forest">{icon}</span> : null}
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-xs text-muted">{hint}</p>
          ) : null}
        </div>
      </div>
      {action}
    </header>
  );
}

type Tone = "neutral" | "sage" | "forest" | "amber" | "rust" | "outline";

const TONES: Record<Tone, string> = {
  neutral: "bg-parchment text-muted border-line",
  sage: "bg-sage-soft text-sage-ink border-sage/40",
  forest: "bg-forest-tint text-forest-deep border-forest/25",
  amber: "bg-amber-soft text-amber border-amber/30",
  rust: "bg-rust-soft text-rust border-rust/25",
  outline: "bg-transparent text-muted border-line-strong",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone,
  pulse = false,
}: {
  tone: "green" | "amber" | "rust" | "neutral";
  pulse?: boolean;
}) {
  const color =
    tone === "green"
      ? "bg-forest"
      : tone === "amber"
        ? "bg-amber"
        : tone === "rust"
          ? "bg-rust"
          : "bg-faint";
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse ? (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            color,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}
