/**
 * Slack request signature verification (official HMAC-SHA256 scheme).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */

import crypto from "crypto";

export type SlackVerifyInput = {
  signingSecret: string;
  /** X-Slack-Signature header, e.g. v0=... */
  signature: string;
  /** X-Slack-Request-Timestamp header */
  timestamp: string;
  /** Raw request body string */
  rawBody: string;
  /** Max age of request in seconds (default 5 minutes) */
  maxAgeSec?: number;
  /** Override "now" for tests (unix seconds) */
  nowSec?: number;
};

export type SlackVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify Slack signing secret. Pure function — no I/O.
 */
export function verifySlackSignature(input: SlackVerifyInput): SlackVerifyResult {
  const {
    signingSecret,
    signature,
    timestamp,
    rawBody,
    maxAgeSec = 60 * 5,
    nowSec = Math.floor(Date.now() / 1000),
  } = input;

  if (!signingSecret) {
    return { ok: false, reason: "missing_signing_secret" };
  }
  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  if (Math.abs(nowSec - ts) > maxAgeSec) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base, "utf8")
    .digest("hex");
  const expected = `v0=${digest}`;

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature_mismatch" };
    }
  } catch {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

/** Build a valid signature for tests / local tooling */
export function signSlackRequest(
  signingSecret: string,
  timestamp: string,
  rawBody: string
): string {
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base, "utf8")
    .digest("hex");
  return `v0=${digest}`;
}
