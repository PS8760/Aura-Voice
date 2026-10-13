"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LayoutDashboard, LogOut, UserRound } from "lucide-react";

import { userInitial, type SessionUser } from "@/lib/client/user";

export function AccountMenu({ user }: { user: SessionUser | null }) {
  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-full border border-forest/30 bg-forest px-3 py-1.5 text-[12px] font-medium text-canvas transition-colors hover:bg-forest-deep"
      >
        <UserRound size={13} aria-hidden /> Sign in
      </Link>
    );
  }

  const label = user.name || user.email || "Signed in";

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line bg-panel py-1 pl-1 pr-1.5">
      <Link
        href="/profile"
        className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:bg-parchment"
        title="Your profile"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-sage-soft text-[11px] font-semibold text-sage-ink"
        >
          {userInitial(user)}
        </span>
        <span className="hidden max-w-[130px] truncate text-[12px] font-medium text-ink sm:inline">
          {label}
        </span>
      </Link>
      {user.isAdmin ? (
        <Link
          href="/admin"
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] text-sage-ink transition-colors hover:bg-sage-soft"
          title="Admin portal"
        >
          <LayoutDashboard size={13} aria-hidden />
          <span className="hidden sm:inline">Admin</span>
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: "/login" })}
        title="Sign out"
        aria-label="Sign out"
        className="ml-0.5 flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] text-muted transition-colors hover:bg-parchment hover:text-rust"
      >
        <LogOut size={13} aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
