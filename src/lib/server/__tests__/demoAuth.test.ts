import { describe, expect, it } from "vitest";

import { authorizeDemoCredentials } from "../demoAuth";

describe("demo credentials", () => {
  it("accepts a valid email with a long-enough password", () => {
    const user = authorizeDemoCredentials({
      email: "priya.sharma@example.com",
      password: "supersecret",
    });
    expect(user).not.toBeNull();
    expect(user?.email).toBe("priya.sharma@example.com");
    expect(user?.name).toBe("Priya Sharma");
  });

  it("uses the supplied name when present", () => {
    const user = authorizeDemoCredentials({
      email: "a@b.com",
      password: "123456",
      name: "Ananya Patel",
    });
    expect(user?.name).toBe("Ananya Patel");
  });

  it("normalises the email to lowercase and trims", () => {
    const user = authorizeDemoCredentials({
      email: "  ARIA.DEMO@Example.COM ",
      password: "aura-demo",
    });
    expect(user?.email).toBe("aria.demo@example.com");
  });

  it("rejects a malformed email", () => {
    expect(authorizeDemoCredentials({ email: "nope", password: "123456" })).toBeNull();
  });

  it("rejects a short password", () => {
    expect(authorizeDemoCredentials({ email: "a@b.com", password: "123" })).toBeNull();
  });

  it("rejects missing input", () => {
    expect(authorizeDemoCredentials(undefined)).toBeNull();
  });
});
