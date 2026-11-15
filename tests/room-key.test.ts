import assert from "node:assert/strict";
import test from "node:test";

import { normalizeKey, randomKey, roomNameFromKey } from "../lib/room-key.ts";

test("generated guest keys carry 128 bits and do not collide in a sample", () => {
  const keys = new Set(Array.from({ length: 1_000 }, randomKey));
  assert.equal(keys.size, 1_000);
  for (const key of keys) {
    assert.match(key, /^[a-f0-9]{32}$/);
    assert.equal(roomNameFromKey(key), `guest-${key}`);
  }
});

test("short or malformed room keys are rejected", () => {
  assert.equal(roomNameFromKey("abc"), "");
  assert.equal(roomNameFromKey("short-human-key"), "");
  assert.equal(roomNameFromKey("-".repeat(64)), "");
});

test("normalization has a bounded canonical form", () => {
  assert.equal(normalizeKey("  Á-B  C!! "), "a-b-c");
  assert.equal(normalizeKey("x".repeat(100)).length, 64);
});
