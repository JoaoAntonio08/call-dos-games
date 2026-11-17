import assert from "node:assert/strict";
import test from "node:test";

import { guestTokenRateLimited } from "../lib/guest-token-rate-limit.ts";

test("guest token limiter allows 15 attempts and rejects the next one", () => {
  const id = `test-${crypto.randomUUID()}`;
  const now = 1_000_000;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    assert.equal(guestTokenRateLimited(id, now), false);
  }
  assert.equal(guestTokenRateLimited(id, now), true);
});

test("guest token limiter expires attempts after one minute", () => {
  const id = `test-${crypto.randomUUID()}`;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    assert.equal(guestTokenRateLimited(id, 2_000_000), false);
  }

  assert.equal(guestTokenRateLimited(id, 2_060_001), false);
});
