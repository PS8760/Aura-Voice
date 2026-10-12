"use client";

import { useState } from "react";
import {
  Check,
  Clipboard,
  Database,
  Package,
} from "lucide-react";

import { SAMPLE_ORDERS, FIXTURE_VERSION } from "@/lib/domain/orders";
import type { Order, OrderStatus } from "@/lib/domain/types";
import { copyToClipboard } from "@/lib/client/download";
import { cn } from "@/lib/client/cn";
import { Badge, Card, SectionHeader } from "./ui";

const STATUS_TONE: Record<
  OrderStatus,
  "forest" | "sage" | "amber" | "neutral" | "rust"
> = {
  Processing: "amber",
  Shipped: "sage",
  "Out for Delivery": "sage",
  Delivered: "forest",
  Cancelled: "rust",
};

function OrderRow({
  order,
  selected,
  onSelect,
}: {
  order: Order;
  selected: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const ok = await copyToClipboard(order.id);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const missingCourier = !order.courier || !order.trackingRef;

  return (
    <li>
      <div
        className={cn(
          "w-full rounded-[11px] border p-3 text-left transition-colors",
          selected
            ? "border-forest/40 bg-forest-tint/40"
            : "border-line bg-canvas hover:border-line-strong",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          className="flex w-full items-start justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-ink">
                {order.id}
              </span>
              <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
            </span>
            <span className="mt-1 block truncate text-[12.5px] text-muted">
              {order.productName} · ₹{order.value}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-faint">
              {order.customerName} · {order.supplierNote}
            </span>
          </span>
          <span className="mt-0.5 shrink-0 text-[11px] font-medium text-forest">
            {selected ? "Hide" : "Inspect"}
          </span>
        </button>

        {selected ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-[12px]">
            <div>
              <dt className="text-faint">Customer</dt>
              <dd className="text-charcoal">{order.customerName}</dd>
            </div>
            <div>
              <dt className="text-faint">Value</dt>
              <dd className="text-charcoal">₹{order.value}</dd>
            </div>
            <div>
              <dt className="text-faint">Courier</dt>
              <dd className="text-charcoal">
                {order.courier ?? (
                  <span className="text-amber">Not supplied</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Tracking</dt>
              <dd className="font-mono text-charcoal">
                {order.trackingRef ?? (
                  <span className="font-sans text-amber">Not supplied</span>
                )}
              </dd>
            </div>
            {missingCourier ? (
              <div className="col-span-2 rounded-[8px] border border-amber/30 bg-amber-soft px-2.5 py-2 text-[11.5px] text-amber">
                No courier or tracking reference was supplied for this order.
                Aria will not invent one.
              </div>
            ) : null}
            <div className="col-span-2 mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-panel px-3 py-1 text-[11.5px] font-medium text-charcoal hover:border-forest hover:text-forest"
              >
                {copied ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Clipboard size={12} aria-hidden />
                )}
                {copied ? "Copied" : "Copy order ID"}
              </button>
            </div>
          </dl>
        ) : null}
      </div>
    </li>
  );
}

export function TestOrdersPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Card>
      <SectionHeader
        title="Test orders"
        hint={`Mock fixtures · ${FIXTURE_VERSION}`}
        icon={<Database size={16} />}
        action={
          <Badge tone="amber">
            <Package size={11} aria-hidden /> Not live data
          </Badge>
        }
      />
      <div className="px-4 py-4 sm:px-5">
        <ul className="space-y-2.5">
          {SAMPLE_ORDERS.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              selected={selectedId === order.id}
              onSelect={() =>
                setSelectedId((prev) => (prev === order.id ? null : order.id))
              }
            />
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          These are mock fixtures, not live logistics data. Selecting an order is
          a convenience for inspection only — it does not perform a lookup. Ask
          Aria by voice or text to test the real order tools.
        </p>
      </div>
    </Card>
  );
}
