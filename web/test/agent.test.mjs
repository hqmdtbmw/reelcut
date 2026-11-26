import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/agent.js";

test("remove the silences", () => {
  assert.deepEqual(parseCommand("remove the silences"), { kind: "remove-silences" });
  assert.deepEqual(parseCommand("please cut out the silences"), { kind: "remove-silences" });
});

test("add captions", () => {
  assert.deepEqual(parseCommand("add captions"), { kind: "add-captions" });
});

test("cut the first seconds", () => {
  assert.deepEqual(parseCommand("cut the first 5 seconds"), { kind: "cut-first", seconds: 5 });
  assert.deepEqual(parseCommand("cut the first 2.5 secs"), { kind: "cut-first", seconds: 2.5 });
});

test("cutdown to a length", () => {
  assert.deepEqual(parseCommand("make a 30 second cutdown"), { kind: "cutdown", seconds: 30 });
  assert.deepEqual(parseCommand("make a 60 second version"), { kind: "cutdown", seconds: 60 });
  assert.deepEqual(parseCommand("make a 30s cut"), { kind: "cutdown", seconds: 30 });
  assert.deepEqual(parseCommand("cut it down to 45 seconds"), { kind: "cutdown", seconds: 45 });
});

test("vertical and horizontal", () => {
  assert.deepEqual(parseCommand("make it vertical"), { kind: "make-vertical" });
  assert.deepEqual(parseCommand("make this for tiktok"), { kind: "make-vertical" });
  assert.deepEqual(parseCommand("make it horizontal"), { kind: "make-horizontal" });
});

test("speed commands", () => {
  assert.deepEqual(parseCommand("speed the whole thing up"), { kind: "speed-all", factor: 1.5 });
  assert.deepEqual(parseCommand("speed it up 2x"), { kind: "speed-all", factor: 2 });
  assert.deepEqual(parseCommand("speed it to 1.25x"), { kind: "speed-all", factor: 1.25 });
  assert.deepEqual(parseCommand("slow it down"), { kind: "speed-all", factor: 0.75 });
});

test("split and delete", () => {
  assert.deepEqual(parseCommand("split at 10 seconds"), { kind: "split-at", seconds: 10 });
  assert.deepEqual(parseCommand("delete clip 2"), { kind: "delete-clip", index: 1 });
});

test("add text with timing", () => {
  const parsed = parseCommand("add text hello world from 2 to 5");
  assert.equal(parsed.kind, "add-text");
  assert.equal(parsed.text, "hello world");
  assert.equal(parsed.start, 2);
  assert.equal(parsed.end, 5);
});

test("mute and volume", () => {
  assert.deepEqual(parseCommand("mute it"), { kind: "mute" });
  assert.deepEqual(parseCommand("set volume to 50%"), { kind: "set-volume", volume: 0.5 });
});

test("fades", () => {
  assert.deepEqual(parseCommand("add a fade of 1 second"), { kind: "fade-all", seconds: 1 });
  assert.deepEqual(parseCommand("add fades"), { kind: "fade-all", seconds: 0.5 });
});

test("unknown commands stay unknown", () => {
  const parsed = parseCommand("do something magical");
  assert.equal(parsed.kind, "unknown");
});
