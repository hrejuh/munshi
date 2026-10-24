import { describe, expect, it } from "vitest";
import { availableActions, computeTotals, nextStatus, validateOrder } from "@/lib/orders";
import { splitOrderText } from "@/lib/order-service";

const shop = { deliveryMode: "BOTH" as const, deliveryFee: 20, minOrder: 100 };
const lines = [
  { productId: "a", name: "Atta", price: 260, qty: 1 },
  { productId: "b", name: "Maggi", price: 14, qty: 3 },
];

describe("totals", () => {
  it("adds the delivery fee only for delivery", () => {
    expect(computeTotals(lines, shop, "DELIVERY")).toEqual({ subtotal: 302, deliveryFee: 20, total: 322 });
    expect(computeTotals(lines, shop, "PICKUP")).toEqual({ subtotal: 302, deliveryFee: 0, total: 302 });
  });
});

describe("validation", () => {
  it("enforces min order, address and the shop's fulfilment mode", () => {
    expect(validateOrder([{ ...lines[1], qty: 1 }], shop, "PICKUP")).toMatch(/Minimum/);
    expect(validateOrder(lines, shop, "DELIVERY", "")).toMatch(/address/);
    expect(validateOrder(lines, { ...shop, deliveryMode: "PICKUP" }, "DELIVERY", "x")).toMatch(/pickup only/);
    expect(validateOrder(lines, shop, "DELIVERY", "12 MG Road")).toBeNull();
    expect(validateOrder([], shop, "PICKUP")).toMatch(/empty/);
  });
});

describe("order state machine", () => {
  it("allows the owner's happy path", () => {
    expect(nextStatus("PLACED", "accept")).toBe("ACCEPTED");
    expect(nextStatus("ACCEPTED", "out_for_delivery")).toBe("OUT_FOR_DELIVERY");
    expect(nextStatus("OUT_FOR_DELIVERY", "complete")).toBe("COMPLETED");
    expect(nextStatus("ACCEPTED", "ready")).toBe("READY");
  });
  it("blocks invalid jumps", () => {
    expect(nextStatus("COMPLETED", "accept")).toBeNull();
    expect(nextStatus("REJECTED", "complete")).toBeNull();
    expect(nextStatus("PLACED", "complete")).toBeNull();
  });
  it("offers fulfilment-specific next steps", () => {
    expect(availableActions("ACCEPTED", "DELIVERY")).toEqual(["out_for_delivery"]);
    expect(availableActions("ACCEPTED", "PICKUP")).toEqual(["ready"]);
  });
});

describe("splitOrderText", () => {
  it("splits a typed order into items with quantities", () => {
    expect(splitOrderText("2 maggi, 1 kg sugar and bread")).toEqual([
      { name: "maggi", qty: 2 },
      { name: "1 kg sugar", qty: 1 },
      { name: "bread", qty: 1 },
    ]);
    expect(splitOrderText("do amul butter aur ek milk")).toEqual([
      { name: "amul butter", qty: 2 },
      { name: "milk", qty: 1 },
    ]);
  });
});
