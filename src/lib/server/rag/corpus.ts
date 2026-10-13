import type { Intent } from "@/lib/domain/types";
import type { Locale } from "@/lib/domain/locale";
import {
  POLICY_COD_LIMIT,
  POLICY_DAMAGE_REPORT_WINDOW_HOURS,
  POLICY_FREE_SHIPPING_THRESHOLD,
  POLICY_BELOW_THRESHOLD_FEE,
  POLICY_RETURN_WINDOW_DAYS,
  POLICY_STANDARD_ETA_DAYS,
} from "@/lib/domain/policy";
import type { RagDocument } from "./types";

/**
 * A tenant is one company's knowledge configuration. Everything the RAG engine
 * needs about "who we are" and "what we know" lives here, so the same code
 * serves any company: swap the tenant and the agent changes brand, persona and
 * knowledge without touching the engine.
 */
export interface TenantDocument {
  id: string;
  title: string;
  text: string;
  source: string;
  intent?: Intent | null;
  locale?: Locale | null;
  metadata?: Record<string, string>;
}

export interface Tenant {
  companyId: string;
  brand: string;
  agentName: string;
  locale: Locale;
  documents: TenantDocument[];
}

export const DEFAULT_COMPANY_ID = "aura-skincare";

const [ETA_MIN, ETA_MAX] = POLICY_STANDARD_ETA_DAYS;

/**
 * The default tenant's explanatory corpus. These are *narrative* policy
 * descriptions, not decision logic — the deterministic policy engine remains
 * the single source of truth for what is allowed. The corpus gives the model
 * grounded wording to paraphrase.
 */
export function auraPolicyDocuments(companyId = DEFAULT_COMPANY_ID): TenantDocument[] {
  const docs: Omit<TenantDocument, "companyId">[] = [
    {
      id: "policy.shipping",
      title: "Shipping charges and delivery time",
      source: "policy",
      intent: "SHIPPING_QUERY",
      text:
        `Standard delivery takes ${ETA_MIN} to ${ETA_MAX} business days. ` +
        `Orders above ₹${POLICY_FREE_SHIPPING_THRESHOLD} qualify for free standard delivery. ` +
        `Orders below ₹${POLICY_FREE_SHIPPING_THRESHOLD} incur a ₹${POLICY_BELOW_THRESHOLD_FEE} shipping fee. ` +
        `The policy does not define the charge for an order of exactly ₹${POLICY_FREE_SHIPPING_THRESHOLD}, ` +
        `so that case must be handed to the support team rather than guessed.`,
    },
    {
      id: "policy.returns",
      title: "Return window and conditions",
      source: "policy",
      intent: "RETURN_REQUEST",
      text:
        `Returns are accepted within ${POLICY_RETURN_WINDOW_DAYS} days of delivery. ` +
        `The product must be unopened, unused and in its original packaging. ` +
        `A return can only be assessed after the order shows as delivered; without a ` +
        `delivery confirmation the return cannot be promised.`,
    },
    {
      id: "policy.cancellation",
      title: "Cancellation eligibility",
      source: "policy",
      intent: "CANCELLATION_REQUEST",
      text:
        `An order can be cancelled only while its status is Processing. ` +
        `Once it is Shipped or Out for Delivery it can no longer be cancelled, and the ` +
        `customer may instead refuse the delivery at the doorstep. ` +
        `An order that is already Cancelled needs no further action.`,
    },
    {
      id: "policy.cod",
      title: "Cash on Delivery",
      source: "policy",
      intent: "COD_QUERY",
      text:
        `Cash on Delivery is available for orders up to ₹${POLICY_COD_LIMIT}, ` +
        `payable by cash or UPI at the doorstep. ` +
        `Orders above ₹${POLICY_COD_LIMIT} are not eligible for Cash on Delivery.`,
    },
    {
      id: "policy.damaged",
      title: "Damaged or defective products",
      source: "policy",
      intent: "DAMAGED_PRODUCT",
      text:
        `A damaged or defective product must be reported within ` +
        `${POLICY_DAMAGE_REPORT_WINDOW_HOURS} hours of delivery. ` +
        `A replacement requires photos of the product. Reports after the window ` +
        `cannot be offered a replacement. Delivery details are needed before a ` +
        `report can be assessed.`,
    },
  ];
  return docs.map((doc) => ({ ...doc, companyId }));
}

/** Product/order hints the agent can lean on when a customer asks "what did I order". */
export function auraProductDocuments(companyId = DEFAULT_COMPANY_ID): TenantDocument[] {
  const docs: Omit<TenantDocument, "companyId">[] = [
    {
      id: "faq.order_lookup",
      title: "Looking up an order",
      source: "faq",
      text:
        "To look up an order, use the order id, for example ORD-101. " +
        "The lookup returns the customer name, the items ordered, the amount paid, " +
        "the current status and, when shipped, the courier and tracking number.",
    },
    {
      id: "faq.escalation",
      title: "When to hand over to a human",
      source: "faq",
      text:
        "Hand the conversation to a human support agent when the request is outside " +
        "the documented policy, when the policy boundary is unclear, or when the " +
        "customer remains unsatisfied after the policy has been explained.",
    },
  ];
  return docs.map((doc) => ({ ...doc, companyId }));
}

export function defaultTenant(): Tenant {
  return {
    companyId: DEFAULT_COMPANY_ID,
    brand: "Aura Skincare",
    agentName: "Aria",
    locale: "en",
    documents: [...auraPolicyDocuments(), ...auraProductDocuments()],
  };
}

/** Flatten a tenant's documents into RAG documents. */
export function tenantDocuments(tenant: Tenant): RagDocument[] {
  return tenant.documents.map((doc) => ({
    id: doc.id,
    companyId: tenant.companyId,
    title: doc.title,
    text: doc.text,
    source: doc.source,
    intent: doc.intent ?? null,
    locale: doc.locale ?? null,
    metadata: doc.metadata,
  }));
}
