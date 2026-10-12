"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the user's reduced-motion preference. Animation that merely decorates
 * is disabled; state that is conveyed by motion is also conveyed in text so no
 * essential interaction depends on it.
 */
export function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}
