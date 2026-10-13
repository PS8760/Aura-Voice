import { afterEach, describe, expect, it } from "vitest";

import { createInMemoryOrderRepository } from "@/lib/domain/orders";
import { initialSessionState } from "@/lib/domain/orchestrator";

import { runSupportAgent } from "../agent";
import { parseUnderstanding } from "../agentTools";

const FIXED_NOW = () => new Date("2026-01-01T10:00:00.000Z");

interface ScriptedMessage {
  content?: string;
  tool_calls?: unknown;
}

function scriptedFetch(messages: ScriptedMessage[]): typeof fetch {
  let index = 0;
  const fn = async () => {
    const message = messages[Math.min(index, messages.length - 1)] ?? { content: "" };
    index += 1;
    return {
      ok: true,
      json: async () => ({ message }),
    } as unknown as Response;
  };
  return fn as unknown as typeof fetch;
}

function submit(args: Record<string, unknown>): ScriptedMessage {
  return { content: "", tool_calls: [{ function: { name: "submit_understanding", arguments: args } }] };
}

function callTool(name: string, args: Record<string, unknown>): ScriptedMessage {
  return { content: "", tool_calls: [{ function: { name, arguments: args } }] };
}

const ORIGINAL_FLAG = process.env.AURA_ENABLE_LOCAL_AI;
afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.AURA_ENABLE_LOCAL_AI;
  else process.env.AURA_ENABLE_LOCAL_AI = ORIGINAL_FLAG;
});

describe("runSupportAgent", () => {
  it("returns null when local AI is disabled", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "false";
    const outcome = await runSupportAgent({
      text: "where is ORD-101",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([submit({ intent: "ORDER_TRACKING", order_id: "ORD-101" })]),
    });
    expect(outcome).toBeNull();
  });

  it("returns null when the model is unreachable", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const throwingFetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const outcome = await runSupportAgent({
      text: "hello",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: throwingFetch,
    });
    expect(outcome).toBeNull();
  });

  it("returns null when the model answers without the required structured step", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "hello",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([{ content: "Hi! How can I help?" }]),
    });
    expect(outcome).toBeNull();
  });

  it("accepts a verified informational draft after tool lookups", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "where is my order ORD-101?",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        callTool("lookup_order", { order_id: "ORD-101" }),
        submit({
          intent: "ORDER_TRACKING",
          order_id: "ORD-101",
          confidence: 0.92,
          sentiment: "neutral",
          reason: "tracking a known order",
          draft_reply:
            "ORD-101 is currently out for delivery with BlueDart, tracking reference BD-982103, expected by 6 PM today. This is mock data, not live logistics.",
        }),
      ]),
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.metrics.acceptedDraft).toBe(true);
    expect(outcome?.result.intent).toBe("ORDER_TRACKING");
    expect(outcome?.result.reply).toContain("BlueDart");
    expect(outcome?.metrics.toolCalls).toContain("lookup_order");
  });

  it("rejects a draft that invents an order id and falls back to the engine reply", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "where is my order ORD-101?",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        submit({
          intent: "ORDER_TRACKING",
          order_id: "ORD-101",
          confidence: 0.8,
          sentiment: "neutral",
          reason: "tracking",
          draft_reply:
            "Your order ORD-777 is out for delivery and will arrive tomorrow. This is mock data.",
        }),
      ]),
    });
    expect(outcome?.metrics.acceptedDraft).toBe(false);
    expect(outcome?.result.reply).not.toContain("ORD-777");
    expect(outcome?.result.reply).toContain("ORD-101");
  });

  it("rejects a draft that claims a denied cancellation succeeded", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "please cancel ORD-101",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        callTool("check_cancellation", { order_id: "ORD-101" }),
        submit({
          intent: "CANCELLATION_REQUEST",
          order_id: "ORD-101",
          confidence: 0.9,
          sentiment: "neutral",
          reason: "cancel request",
          draft_reply: "I have cancelled ORD-101 for you successfully.",
        }),
      ]),
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.metrics.acceptedDraft).toBe(false);
    expect(outcome?.result.executed).toBe(false);
    expect(outcome?.result.resolution).toBe("UNRESOLVED");
    expect(outcome?.result.reply.toLowerCase()).not.toContain("cancelled it successfully");
  });

  it("still executes an allowed cancellation through the code layer", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const repo = createInMemoryOrderRepository();
    const outcome = await runSupportAgent({
      text: "cancel ORD-103 please",
      state: initialSessionState(),
      repo,
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        callTool("check_cancellation", { order_id: "ORD-103" }),
        submit({
          intent: "CANCELLATION_REQUEST",
          order_id: "ORD-103",
          confidence: 0.95,
          sentiment: "neutral",
          reason: "cancel a processing order",
        }),
      ]),
    });
    expect(outcome?.result.executed).toBe(true);
    expect(outcome?.result.resolution).toBe("RESOLVED");
    expect(repo.getById("ORD-103")?.status).toBe("Cancelled");
  });

  it("flags escalation when the model requests a human", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "what ingredients are in the serum?",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        submit({
          intent: "UNKNOWN",
          order_id: "",
          confidence: 0.5,
          sentiment: "neutral",
          reason: "needs a specialist",
          needs_escalation: true,
        }),
      ]),
    });
    expect(outcome?.result.resolution).toBe("ESCALATION_REQUIRED");
  });

  it("injects approved knowledge into the system prompt", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    let captured = "";
    const capturingFetch = (async (_url: string, init: RequestInit) => {
      captured = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          message: submit({
            intent: "SHIPPING_QUERY",
            order_id: "",
            confidence: 0.7,
            sentiment: "neutral",
            reason: "shipping question",
          }),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await runSupportAgent({
      text: "how long does shipping take",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      knowledge: [
        { question: "Shipping time?", answer: "Three to five business days across India." },
      ],
      fetchImpl: capturingFetch,
    });

    expect(captured).toContain("Three to five business days across India.");
  });

  it("injects retrieved RAG passages with citations into the prompt", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    let captured = "";
    const capturingFetch = (async (_url: string, init: RequestInit) => {
      captured = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          message: submit({
            intent: "SHIPPING_QUERY",
            order_id: "",
            confidence: 0.7,
            sentiment: "neutral",
            reason: "shipping question",
          }),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const outcome = await runSupportAgent({
      text: "what does delivery cost",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      passages: [
        {
          id: "K1",
          documentId: "policy.shipping",
          title: "Shipping charges and delivery time",
          source: "policy",
          text: "Orders above ₹499 qualify for free standard delivery.",
          intent: "SHIPPING_QUERY",
          locale: null,
          score: 0.5,
          lexical: 1,
          vector: 0.3,
        },
      ],
      fetchImpl: capturingFetch,
    });

    expect(captured).toContain("[K1]");
    expect(captured).toContain("Orders above ₹499");
    expect(outcome?.metrics.citations).toEqual([
      { id: "K1", title: "Shipping charges and delivery time", source: "policy" },
    ]);
  });

  it("accepts a humanised paraphrase that preserves a refusal", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "please cancel ORD-101",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        submit({
          intent: "CANCELLATION_REQUEST",
          order_id: "ORD-101",
          confidence: 0.9,
          sentiment: "neutral",
          reason: "cancel request",
          draft_reply:
            "I'm really sorry, but ORD-101 can't be cancelled because it is already out for delivery.",
        }),
      ]),
    });
    expect(outcome?.metrics.acceptedDraft).toBe(true);
    expect(outcome?.result.reply).toContain("can't be cancelled");
  });

  it("rejects a paraphrase that invents a policy number", async () => {
    process.env.AURA_ENABLE_LOCAL_AI = "true";
    const outcome = await runSupportAgent({
      text: "can I return ORD-102?",
      state: initialSessionState(),
      repo: createInMemoryOrderRepository(),
      now: FIXED_NOW,
      fetchImpl: scriptedFetch([
        submit({
          intent: "RETURN_REQUEST",
          order_id: "ORD-102",
          confidence: 0.9,
          sentiment: "neutral",
          reason: "return request",
          draft_reply:
            "Unfortunately returns are only accepted within 30 days, so I can't take this back.",
        }),
      ]),
    });
    expect(outcome?.metrics.acceptedDraft).toBe(false);
    expect(outcome?.metrics.rejectedDraft).toBe(true);
    expect(outcome?.result.reply).toContain("7");
  });
});

describe("parseUnderstanding", () => {
  it("clamps an unknown intent to UNKNOWN", () => {
    expect(parseUnderstanding({ intent: "HACK_THE_BANK" }).intent).toBe("UNKNOWN");
  });

  it("normalises order ids and clamps confidence", () => {
    const parsed = parseUnderstanding({
      intent: "ORDER_TRACKING",
      order_id: "101",
      confidence: 5,
    });
    expect(parsed.orderId).toBe("ORD-101");
    expect(parsed.confidence).toBe(1);
  });
});
