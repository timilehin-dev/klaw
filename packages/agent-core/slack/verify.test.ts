import { describe, expect, it } from "vitest";
import { signSlackRequest, verifySlackSignature } from "./verify";

describe("verifySlackSignature", () => {
  const secret = "test_signing_secret_xyz";

  it("accepts a valid signature", () => {
    const rawBody = JSON.stringify({ type: "event_callback", event_id: "Ev1" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSlackRequest(secret, timestamp, rawBody);

    const result = verifySlackSignature({
      signingSecret: secret,
      signature,
      timestamp,
      rawBody,
      nowSec: Number(timestamp),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects mismatched signature", () => {
    const rawBody = '{"ok":true}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifySlackSignature({
      signingSecret: secret,
      signature: "v0=deadbeef",
      timestamp,
      rawBody,
      nowSec: Number(timestamp),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects stale timestamps", () => {
    const rawBody = "{}";
    const timestamp = String(Math.floor(Date.now() / 1000) - 10_000);
    const signature = signSlackRequest(secret, timestamp, rawBody);
    const result = verifySlackSignature({
      signingSecret: secret,
      signature,
      timestamp,
      rawBody,
      nowSec: Math.floor(Date.now() / 1000),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timestamp_out_of_range");
  });

  it("rejects missing headers", () => {
    const result = verifySlackSignature({
      signingSecret: secret,
      signature: "",
      timestamp: "",
      rawBody: "{}",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_headers");
  });

  it("rejects missing signing secret", () => {
    const result = verifySlackSignature({
      signingSecret: "",
      signature: "v0=abc",
      timestamp: "1",
      rawBody: "{}",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_signing_secret");
  });
});
