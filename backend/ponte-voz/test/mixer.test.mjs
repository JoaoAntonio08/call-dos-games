import assert from "node:assert/strict";
import test from "node:test";
import { FRAME_LEN, Mixer, toStereo } from "../src/mixer.mjs";

const frame = (v, n = FRAME_LEN) => new Int16Array(n).fill(v);

test("sem ninguém falando não sai nada", () => {
  const m = new Mixer();
  assert.equal(m.pull(), null);
});

test("junta 40 ms antes de começar e depois sai de 20 em 20", () => {
  const m = new Mixer({ startMs: 40 });
  m.push("a", frame(100));
  assert.equal(m.pull(), null, "só 20 ms: ainda segura");
  m.push("a", frame(100));
  assert.equal(m.pull()[0], 100);
  assert.equal(m.pull()[0], 100);
  assert.equal(m.pull(), null, "acabou");
});

test("soma duas pessoas e não estoura", () => {
  const m = new Mixer({ startMs: 20 });
  m.push("a", frame(1000));
  m.push("b", frame(-300));
  assert.equal(m.pull()[0], 700);
  m.push("a", frame(30000));
  m.push("b", frame(30000));
  assert.equal(m.pull()[0], 32767, "corta no máximo em vez de dar a volta");
});

test("pedaços de tamanho qualquer viram quadros certos", () => {
  const m = new Mixer({ startMs: 20 });
  for (let i = 0; i < 4; i++) m.push("a", frame(i + 1, FRAME_LEN / 2)); // 4 pedaços de 10 ms
  const a = m.pull();
  assert.equal(a.length, FRAME_LEN);
  assert.equal(a[0], 1);
  assert.equal(a[FRAME_LEN - 1], 2);
  assert.equal(m.pull()[0], 3);
});

test("fila longa joga fora o mais velho (atraso não cresce)", () => {
  const m = new Mixer({ startMs: 20, maxMs: 60 });
  for (let i = 1; i <= 10; i++) m.push("a", frame(i));
  assert.equal(m.pull()[0], 8, "ficaram só os 60 ms mais novos");
});

test("quem sai some da mistura", () => {
  const m = new Mixer({ startMs: 20 });
  m.push("a", frame(5));
  m.remove("a");
  assert.equal(m.size, 0);
  assert.equal(m.pull(), null);
});

test("mono vira estéreo", () => {
  assert.deepEqual([...toStereo(new Int16Array([1, 2]), 1)], [1, 1, 2, 2]);
});
