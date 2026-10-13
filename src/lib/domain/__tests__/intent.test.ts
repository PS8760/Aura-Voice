import { describe, expect, it } from "vitest";
import { classifyIntent, extractOrderId } from "../intent";

describe("extractOrderId", () => {
  it("extracts order ids from text", () => {
    expect(extractOrderId("track ORD-101 please")).toBe("ORD-101");
    expect(extractOrderId("what about ord 102")).toBe("ORD-102");
  });
  it("returns null when no id is present", () => {
    expect(extractOrderId("where is my order")).toBeNull();
  });
});

describe("classifyIntent", () => {
  it("classifies tracking", () => {
    expect(classifyIntent("where is my order ORD-101").intent).toBe("ORDER_TRACKING");
  });
  it("classifies cancellation", () => {
    expect(classifyIntent("I want to cancel my order").intent).toBe("CANCELLATION_REQUEST");
  });
  it("classifies returns", () => {
    expect(classifyIntent("I want to return ORD-102").intent).toBe("RETURN_REQUEST");
  });
  it("classifies damaged products", () => {
    expect(classifyIntent("my serum arrived damaged").intent).toBe("DAMAGED_PRODUCT");
  });
  it("classifies COD questions", () => {
    expect(classifyIntent("can I pay cash on delivery").intent).toBe("COD_QUERY");
  });
  it("classifies shipping questions", () => {
    expect(classifyIntent("how much is the delivery charge").intent).toBe("SHIPPING_QUERY");
  });
  it("classifies product questions", () => {
    expect(classifyIntent("tell me about the vitamin c serum ingredients").intent).toBe(
      "GENERAL_PRODUCT_QUERY",
    );
  });
  it("classifies out-of-scope requests", () => {
    expect(classifyIntent("what is the weather today").intent).toBe("OUT_OF_SCOPE");
  });
  it("flags ambiguous order requests for clarification", () => {
    const result = classifyIntent("Can you help me with my order?");
    expect(result.needsClarification).toBe("order_action");
    expect(result.intent).toBe("UNKNOWN");
  });
  it("handles empty utterances", () => {
    expect(classifyIntent("   ").intent).toBe("UNKNOWN");
    expect(classifyIntent("").confidence).toBe(0);
  });
  it("extracts the order id alongside the intent", () => {
    const result = classifyIntent("please cancel ORD-103");
    expect(result.intent).toBe("CANCELLATION_REQUEST");
    expect(result.orderId).toBe("ORD-103");
  });

  it("classifies multilingual requests", () => {
    expect(classifyIntent("ORD-101 कहाँ है").intent).toBe("ORDER_TRACKING");
    expect(classifyIntent("मेरा ऑर्डर कैंसिल कर दो").intent).toBe("CANCELLATION_REQUEST");
    expect(classifyIntent("ORD-102 ফেরত দিতে চাই").intent).toBe("RETURN_REQUEST");
    expect(classifyIntent("ஆர்டர் எங்கே").intent).toBe("ORDER_TRACKING");
  });
});
