"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { AlertCircle, ArrowRight, Leaf, Loader2 } from "lucide-react";

import { cn } from "@/lib/client/cn";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="17" height="17" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AuthPanel({
  mode,
  googleEnabled,
  demoEnabled,
}: {
  mode: "signin" | "signup";
  googleEnabled: boolean;
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"google" | "demo" | null>(null);

  function describeAuthError(code?: string): string {
    switch (code) {
      case "CredentialsSignin":
        return "Those demo credentials were not accepted. Use a valid email and a password of at least six characters.";
      case "AccessDenied":
        return "Access was denied. The Google account may not be permitted for this app.";
      default:
        return "We could not complete sign-in. Please try again.";
    }
  }

  async function handleGoogle() {
    setError(null);
    setPending("google");
    await signIn("google", { callbackUrl: "/" });
  }

  async function handleDemo(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Your password must be at least six characters.");
      return;
    }
    setPending("demo");
    const result = await signIn("demo", {
      email: email.trim(),
      password,
      name: name.trim(),
      redirect: false,
      callbackUrl: "/",
    });
    if (!result || result.error) {
      setPending(null);
      setError(describeAuthError(result?.error));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen bg-ivory lg:grid-cols-[1.05fr_1fr]">
      {/* Brand column */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-canvas px-10 py-12 lg:flex">
        <div className="paper-grid pointer-events-none absolute inset-0 opacity-70" />
        <Link href="/login" className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-forest/20 bg-forest text-canvas">
            <Leaf size={18} strokeWidth={1.75} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
            Aura Voice CX
          </span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="font-display text-[34px] leading-[1.1] tracking-[-0.02em] text-ink">
            Thoughtful support, naturally.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            A zero-cost voice support workspace for Aura Skincare. Sign in to run
            live voice calls, guided scenarios, and inspect every order tool and
            policy decision Aria makes.
          </p>
          <ul className="mt-8 space-y-3 text-[13.5px] text-muted">
            {[
              "Deterministic tools read real mock order data",
              "Every policy decision is enforced in code",
              "Optional local AI for understanding — never for policy",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] text-faint">
          Demo build for an internship assessment. Orders are fictional fixtures,
          not live logistics data.
        </p>
      </aside>

      {/* Form column */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-forest text-canvas">
              <Leaf size={16} strokeWidth={1.75} />
            </span>
            <span className="text-[16px] font-semibold text-ink">
              Aura Voice CX
            </span>
          </div>

          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
            {isSignup ? "Create your workspace" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-muted">
            {isSignup
              ? "Start testing Aria with a Google account or an email demo account."
              : "Sign in to continue to the support workspace."}
          </p>

          {googleEnabled ? (
            <button
              type="button"
              onClick={handleGoogle}
              disabled={pending !== null}
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-[11px] border border-line-strong bg-panel px-4 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-parchment disabled:opacity-60"
            >
              {pending === "google" ? (
                <Loader2 size={17} className="animate-spin text-muted" />
              ) : (
                <GoogleGlyph />
              )}
              Continue with Google
            </button>
          ) : (
            <p className="mt-7 rounded-[11px] border border-dashed border-line-strong bg-parchment px-4 py-3 text-[12.5px] leading-relaxed text-muted">
              Google sign-in is not configured in this environment. Set
              <code className="mx-1 rounded bg-canvas px-1 py-0.5 text-[11px]">
                AUTH_GOOGLE_ID
              </code>
              and
              <code className="mx-1 rounded bg-canvas px-1 py-0.5 text-[11px]">
                AUTH_GOOGLE_SECRET
              </code>
              to enable it. The demo account below works now.
            </p>
          )}

          {googleEnabled && demoEnabled ? (
            <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wide text-faint">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : (
            <div className="my-6" />
          )}

          {demoEnabled ? (
            <form onSubmit={handleDemo} className="space-y-3.5">
              {isSignup ? (
                <Field
                  label="Name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={setName}
                  placeholder="Priya Sharma"
                />
              ) : null}
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
              />
              <Field
                label="Password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={setPassword}
                placeholder="At least six characters"
              />

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-[9px] border border-rust/25 bg-rust-soft px-3 py-2 text-[12.5px] text-rust"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending !== null}
                className="flex w-full items-center justify-center gap-2 rounded-[11px] bg-forest px-4 py-3 text-[14px] font-medium text-canvas transition-colors hover:bg-forest-deep disabled:opacity-60"
              >
                {pending === "demo" ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <>
                    {isSignup ? "Create demo account" : "Sign in with email"}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail("aria.demo@example.com");
                  setPassword("aura-demo");
                  setError(null);
                }}
                className="w-full text-center text-[12.5px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                Use the prefilled demo account
              </button>
            </form>
          ) : null}

          <p className="mt-7 text-center text-[13px] text-muted">
            {isSignup ? "Already have an account?" : "New to Aura Voice CX?"}{" "}
            <Link
              href={isSignup ? "/login" : "/signup"}
              className={cn("font-medium text-forest hover:text-forest-deep")}
            >
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </p>

          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-faint">
            {demoEnabled
              ? "The email option is a demo sign-in for testing. No password is stored."
              : "Google is the only sign-in method configured."}
          </p>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[10px] border border-line-strong bg-panel px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-forest/50 focus:ring-2 focus:ring-forest/15"
      />
    </label>
  );
}
