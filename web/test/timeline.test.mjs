import test from "node:test";
import assert from "node:assert/strict";
import {
  clipDuration,
  cutRange,
  cutdown,
  deleteClip,
  detectSilence,
  captionsFromWords,
  formatTime,
  makeClip,
  moveClip,
  packClips,
  splitClip,
  totalDuration,
  trimClip,
} from "../src/timeline.js";

function twoClips() {
  return [
    makeClip("a", "a.mp4", null, 10),
    makeClip("b", "b.mp4", null, 6),
  ];
}

test("total duration packs clips back to back", () => {
  const packed = packClips(twoClips());
  assert.equal(packed[0].start, 0);
  assert.equal(packed[1].start, 10);
  assert.equal(totalDuration(twoClips()), 16);
});

test("trim shortens and reflows", () => {
  const out = trimClip(twoClips(), "a", 2, 8);
  assert.equal(clipDuration(out[0]), 6);
  assert.equal(totalDuration(out), 12);
});

test("split makes two clips", () => {
  const out = splitClip(twoClips(), "a", 4);
  assert.equal(out.length, 3);
  assert.equal(clipDuration(out[0]), 4);
  assert.equal(clipDuration(out[1]), 6);
  assert.equal(out[1].sourceIn, 4);
  assert.equal(totalDuration(out), 16);
});

test("split outside a clip returns null", () => {
  assert.equal(splitClip(twoClips(), "a", 10), null);
  assert.equal(splitClip(twoClips(), "a", -1), null);
});

test("delete closes the gap", () => {
  const out = deleteClip(twoClips(), "a");
  assert.equal(out.length, 1);
  assert.equal(totalDuration(out), 6);
});

test("move reorders", () => {
  const out = moveClip(twoClips(), "b", 0);
  assert.equal(out[0].id, "b");
  assert.equal(out[1].id, "a");
  assert.equal(totalDuration(out), 16);
});

test("cutRange removes the middle of a clip", () => {
  const clips = [makeClip("a", "a.mp4", null, 20)];
  const out = cutRange(clips, 5, 10);
  assert.equal(out.length, 2);
  assert.equal(totalDuration(out), 15);
});

test("cutRange across two clips", () => {
  const out = cutRange(twoClips(), 8, 12);
  assert.equal(totalDuration(out), 12);
});

test("silence detection finds quiet stretches and ignores short dips", () => {
  const samples = new Array(100).fill(0.5);
  for (let i = 30; i < 60; i += 1) samples[i] = 0.01;
  const ranges = detectSilence(samples, 10, 0.05, 500);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 3);
  assert.equal(ranges[0].end, 6);

  const short = new Array(100).fill(0.5);
  for (let i = 30; i < 32; i += 1) short[i] = 0.01;
  assert.deepEqual(detectSilence(short, 10, 0.05, 500), []);
});

test("captions group words into lines", () => {
  const words = [
    { text: "hello", start: 0, end: 0.4 },
    { text: "world", start: 0.5, end: 0.9 },
    { text: "later", start: 3, end: 3.4 },
  ];
  const caps = captionsFromWords(words);
  assert.equal(caps.length, 2);
  assert.equal(caps[0].text, "hello world");
  assert.equal(caps[1].text, "later");
});

test("cutdown trims the last clip and drops the rest", () => {
  const out = cutdown(twoClips(), 12);
  assert.equal(out.length, 2);
  assert.equal(totalDuration(out), 12);
  assert.equal(out[1].sourceOut, 2);
  assert.equal(clipDuration(out[1]), 2);
});

test("cutdown drops trailing clips", () => {
  const out = cutdown(twoClips(), 8);
  assert.equal(out.length, 1);
  assert.equal(totalDuration(out), 8);
});

test("cutdown leaves a short timeline alone", () => {
  assert.equal(totalDuration(cutdown(twoClips(), 16)), 16);
  assert.equal(totalDuration(cutdown(twoClips(), 20)), 16);
});

test("formatTime reads like a clock", () => {
  assert.equal(formatTime(0), "0:00.0");
  assert.equal(formatTime(65.5), "1:05.5");
  assert.equal(formatTime(125), "2:05.0");
});
