import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractJson } from "@/lib/agenticorg";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import { normalizePhone, slugify } from "@/lib/ids";

describe("AgenticOrg output parsing", () => {
  it("extracts JSON from fenced or prose text", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson({ text: 'Result {"items":[{"name":"x"}]} done' })).toEqual({ items: [{ name: "x" }] });
  });
});

describe("ElevenLabs webhook signature", () => {
  it("accepts a valid signature and rejects tampering", () => {
    const body = '{"type":"post_call_transcription"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "s3cret").update(`${t}.${body}`).digest("hex");
    expect(verifyWebhookSignature(body, `t=${t},v0=${sig}`, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body + " ", `t=${t},v0=${sig}`, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, `t=${t - 4000},v0=${sig}`, "s3cret")).toBe(false);
  });
});

describe("ids", () => {
  it("normalizes Indian phone numbers", () => {
    expect(normalizePhone("98450 12345")).toBe("+919845012345");
    expect(normalizePhone("+91 98450-12345")).toBe("+919845012345");
    expect(normalizePhone("098450 12345")).toBe("+919845012345");
  });
  it("slugifies shop names", () => {
    expect(slugify("Ganesh Provision Stores!")).toBe("ganesh-provision-stores");
  });
});
