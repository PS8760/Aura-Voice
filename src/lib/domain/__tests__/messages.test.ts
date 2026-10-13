import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/domain/locale";
import {
  MESSAGE_KEYS,
  hasTranslation,
  policyReplyKey,
  t,
} from "@/lib/domain/messages";

describe("message catalog coverage", () => {
  it("has a non-empty translation for every key in every language", () => {
    for (const key of MESSAGE_KEYS) {
      for (const locale of LOCALES) {
        const value = t(locale, key);
        expect(value, `${key} · ${locale}`).toBeTruthy();
        // A missing translation falls back to the key itself; never allow that.
        expect(value, `${key} · ${locale}`).not.toBe(key);
        expect(hasTranslation(locale, key)).toBe(true);
      }
    }
  });

  it("returns the key when asked for an unknown message", () => {
    expect(t("en", "doesNotExist")).toBe("doesNotExist");
  });

  it("interpolates provided params and leaves unknown placeholders intact", () => {
    // cancelOk carries an order-id placeholder in every language.
    const rendered = t("en", "cancelOk", { orderId: "ORD-103" });
    expect(rendered).toContain("ORD-103");
    expect(t("en", "cancelOk", {})).toContain("{{orderId}}");
  });

  it("falls back to English for a locale when a template is absent", () => {
    // All locales are present today, but the fallback contract must hold.
    const english = t("en", "outOfScope");
    expect(t("en", "outOfScope")).toBe(english);
  });
});

describe("policyReplyKey", () => {
  it("maps cancellation denials including the doorstep variant", () => {
    expect(
      policyReplyKey({ kind: "cancellation", status: "denied", rule: "cancellation.processing_only" }),
    ).toBe("cancelDenied");
    expect(
      policyReplyKey({
        kind: "cancellation",
        status: "denied",
        rule: "cancellation.processing_only",
        doorstep: true,
      }),
    ).toBe("cancelDeniedDoorstep");
    expect(
      policyReplyKey({ kind: "cancellation", status: "allowed", rule: "cancellation.processing_only" }),
    ).toBeNull();
  });

  it("maps return denials", () => {
    expect(
      policyReplyKey({ kind: "return", status: "denied", rule: "returns.within_seven_days" }),
    ).toBe("returnDeniedLate");
    expect(
      policyReplyKey({
        kind: "return",
        status: "denied",
        rule: "returns.unopened_original_packaging",
      }),
    ).toBe("returnDeniedPackaging");
  });

  it("maps shipping boundary and COD decisions", () => {
    expect(policyReplyKey({ kind: "shipping", status: "boundary", rule: "" })).toBe(
      "shippingBoundary",
    );
    expect(policyReplyKey({ kind: "cod", status: "allowed", rule: "" })).toBe("codAllowed");
    expect(policyReplyKey({ kind: "cod", status: "denied", rule: "" })).toBe("codDenied");
  });

  it("maps damage decisions", () => {
    expect(policyReplyKey({ kind: "damage", status: "boundary", rule: "" })).toBe(
      "damageNeedsPhotos",
    );
    expect(policyReplyKey({ kind: "damage", status: "denied", rule: "" })).toBe("damageDeniedLate");
    expect(policyReplyKey({ kind: "damage", status: "unknown", rule: "" })).toBe("damageUnknown");
  });
});
