import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustClipEffect,
  boringRanges,
  canRedo,
  canUndo,
  clampEffect,
  clampMusicVolume,
  clipDuration,
  clipFilter,
  cutRange,
  cutdown,
  deleteClip,
  detectSilence,
  captionsFromWords,
  formatTime,
  makeClip,
  makeHistory,
  moveClip,
  musicLastLoopLength,
  musicLoops,
  normaliseEffects,
  packClips,
  pushHistory,
  redoHistory,
  setClipEffects,
  shiftTimedItems,
  shortcutForEvent,
  snapshotState,
  splitClip,
  totalDuration,
  trimClip,
  undoHistory,
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

test("boring ranges find the long gaps between captions", () => {
  const captions = [
    { text: "hello", start: 1, end: 3 },
    { text: "and then", start: 8, end: 10 },
    { text: "goodbye", start: 12, end: 14 },
  ];
  // The 5 second gap counts, the 2 second one does not, and the
  // dead air after the last caption counts too. Each cut keeps
  // half a second of breathing room on both sides.
  const ranges = boringRanges(captions, 20);
  assert.deepEqual(ranges, [
    { start: 3.5, end: 7.5 },
    { start: 14.5, end: 19.5 },
  ]);
});

test("boring ranges catch leading dead air and ignore short gaps", () => {
  const late = [{ text: "late start", start: 6, end: 8 }];
  assert.deepEqual(boringRanges(late, 10), [{ start: 0.5, end: 5.5 }]);

  const tight = [
    { text: "one", start: 1, end: 2 },
    { text: "two", start: 4, end: 5 },
  ];
  assert.deepEqual(boringRanges(tight, 6), []);
  assert.deepEqual(boringRanges([], 20), []);
});

test("shifting timed items follows the cuts", () => {
  const ranges = [{ start: 3.5, end: 7.5 }];
  const items = [
    { text: "early", start: 1, end: 2 },
    { text: "straddler", start: 6, end: 9 },
    { text: "late", start: 10, end: 12 },
    { text: "inside", start: 4, end: 7 },
  ];
  const out = shiftTimedItems(items, ranges);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { text: "early", start: 1, end: 2 });
  assert.deepEqual(out[1], { text: "straddler", start: 3.5, end: 5 });
  assert.deepEqual(out[2], { text: "late", start: 6, end: 8 });
});

test("formatTime reads like a clock", () => {
  assert.equal(formatTime(0), "0:00.0");
  assert.equal(formatTime(65.5), "1:05.5");
  assert.equal(formatTime(125), "2:05.0");
});

test("music volume clamps to 0 to 1", () => {
  assert.equal(clampMusicVolume(0.5), 0.5);
  assert.equal(clampMusicVolume(2), 1);
  assert.equal(clampMusicVolume(-1), 0);
  assert.equal(clampMusicVolume(0), 0);
  assert.equal(clampMusicVolume(NaN), 1);
  assert.equal(clampMusicVolume(undefined), 1);
});

test("music loops cover the edit", () => {
  assert.equal(musicLoops(30, 90), 3);
  assert.equal(musicLoops(30, 95), 4);
  assert.equal(musicLoops(120, 45), 1);
  assert.equal(musicLoops(0, 45), 0);
  assert.equal(musicLoops(30, 0), 0);
});

test("music last loop is the leftover", () => {
  assert.equal(musicLastLoopLength(30, 95), 5);
  assert.equal(musicLastLoopLength(120, 45), 45);
  assert.equal(musicLastLoopLength(30, 90), 30);
  assert.equal(musicLastLoopLength(0, 45), 0);
});

test("new clips start with untouched colours", () => {
  const clip = makeClip("a", "a.mp4", null, 10);
  assert.deepEqual(clip.effects, { brightness: 100, contrast: 100, saturation: 100 });
});

test("effect values clamp to 0 to 200", () => {
  assert.equal(clampEffect(120), 120);
  assert.equal(clampEffect(0), 0);
  assert.equal(clampEffect(200), 200);
  assert.equal(clampEffect(250), 200);
  assert.equal(clampEffect(-10), 0);
  assert.equal(clampEffect(NaN), 100);
  assert.equal(clampEffect(undefined), 100);
});

test("normaliseEffects fills in missing values and clamps the rest", () => {
  assert.deepEqual(normaliseEffects({ brightness: 150 }), { brightness: 150, contrast: 100, saturation: 100 });
  assert.deepEqual(normaliseEffects({ saturation: 300 }), { brightness: 100, contrast: 100, saturation: 200 });
  assert.deepEqual(normaliseEffects(null), { brightness: 100, contrast: 100, saturation: 100 });
});

test("clip filter string is none when untouched", () => {
  assert.equal(clipFilter(makeClip("a", "a.mp4", null, 10)), "none");
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.effects = { brightness: 120, contrast: 90, saturation: 110 };
  assert.equal(clipFilter(clip), "brightness(120%) contrast(90%) saturate(110%)");
});

test("setClipEffects changes one clip and leaves the rest alone", () => {
  const out = setClipEffects(twoClips(), "a", { brightness: 130 });
  assert.deepEqual(out[0].effects, { brightness: 130, contrast: 100, saturation: 100 });
  assert.deepEqual(out[1].effects, { brightness: 100, contrast: 100, saturation: 100 });
});

test("adjustClipEffect moves one value and clamps at the ends", () => {
  const up = adjustClipEffect(twoClips(), "a", "brightness", 20);
  assert.equal(up[0].effects.brightness, 120);
  const over = adjustClipEffect(up, "a", "brightness", 200);
  assert.equal(over[0].effects.brightness, 200);
  const under = adjustClipEffect(twoClips(), "a", "saturation", -150);
  assert.equal(under[0].effects.saturation, 0);
});

// Undo and redo, worked through the history helpers directly.

function editState(clips, overlays = [], captions = [], music = null) {
  return snapshotState({ clips, overlays, captions, music });
}

test("undo returns the previous state and redo reapplies", () => {
  let history = makeHistory();
  const first = editState(twoClips());
  const second = editState(deleteClip(twoClips(), "a"));
  history = pushHistory(history, first);
  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), false);

  const undone = undoHistory(history, second);
  assert.deepEqual(undone.state.clips, first.clips);
  assert.equal(canUndo(undone.history), false);
  assert.equal(canRedo(undone.history), true);

  const redone = redoHistory(undone.history, undone.state);
  assert.deepEqual(redone.state.clips, second.clips);
  assert.equal(canRedo(redone.history), false);
});

test("undo and redo do nothing when their stack is empty", () => {
  const history = makeHistory();
  assert.equal(undoHistory(history, editState(twoClips())), null);
  assert.equal(redoHistory(history, editState(twoClips())), null);
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
});

test("pushing after undo clears the redo stack", () => {
  let history = makeHistory();
  const first = editState(twoClips());
  const second = editState(deleteClip(twoClips(), "a"));
  const third = editState(moveClip(twoClips(), "b", 0));
  history = pushHistory(history, first);
  const undone = undoHistory(history, second);
  history = pushHistory(undone.history, undone.state);
  assert.equal(canRedo(history), false);
  const undoneAgain = undoHistory(history, third);
  assert.deepEqual(undoneAgain.state.clips, first.clips);
});

test("history keeps the last 50 edits and drops older ones", () => {
  let history = makeHistory();
  for (let i = 0; i < 60; i += 1) {
    const state = editState([makeClip(`c${i}`, "c.mp4", null, 1)]);
    history = pushHistory(history, state);
  }
  assert.equal(history.past.length, 50);
  assert.equal(history.past[0].clips[0].id, "c10");
  assert.equal(history.past[49].clips[0].id, "c59");
});

test("a snapshot covers clips, overlays, captions and music", () => {
  const state = editState(
    twoClips(),
    [{ id: "t1", text: "hello", start: 0, end: 2 }],
    [{ text: "hi", start: 0, end: 1 }],
    { name: "song.mp3", volume: 0.5, duration: 30 },
  );
  let history = pushHistory(makeHistory(), state);
  const changed = editState([], [], [], null);
  const undone = undoHistory(history, changed);
  assert.equal(undone.state.clips.length, 2);
  assert.equal(undone.state.overlays[0].text, "hello");
  assert.equal(undone.state.captions[0].text, "hi");
  assert.equal(undone.state.music.name, "song.mp3");
  history = undone.history;
});

test("snapshots do not share clip objects with the live edit", () => {
  const clips = twoClips();
  const state = editState(clips);
  clips[0].effects.brightness = 150;
  assert.equal(state.clips[0].effects.brightness, 100);
});

test("shortcuts map keys to actions", () => {
  const body = { tagName: "DIV" };
  assert.equal(shortcutForEvent({ key: " ", target: body }), "play");
  assert.equal(shortcutForEvent({ key: "s", target: body }), "split");
  assert.equal(shortcutForEvent({ key: "S", target: body }), "split");
  assert.equal(shortcutForEvent({ key: "Delete", target: body }), "delete");
  assert.equal(shortcutForEvent({ key: "Backspace", target: body }), "delete");
  assert.equal(shortcutForEvent({ key: "z", ctrlKey: true, target: body }), "undo");
  assert.equal(shortcutForEvent({ key: "Z", ctrlKey: true, shiftKey: true, target: body }), "redo");
  assert.equal(shortcutForEvent({ key: "y", ctrlKey: true, target: body }), "redo");
  assert.equal(shortcutForEvent({ key: "z", metaKey: true, target: body }), "undo");
  assert.equal(shortcutForEvent({ key: "x", target: body }), null);
  assert.equal(shortcutForEvent({ key: "z", ctrlKey: true, shiftKey: false, target: body }), "undo");
});

test("shortcuts stay quiet while typing", () => {
  const input = { tagName: "INPUT" };
  const textarea = { tagName: "TEXTAREA" };
  assert.equal(shortcutForEvent({ key: " ", target: input }), null);
  assert.equal(shortcutForEvent({ key: "s", target: textarea }), null);
  assert.equal(shortcutForEvent({ key: "z", ctrlKey: true, target: input }), null);
  assert.equal(shortcutForEvent({ key: "Delete", target: input }), null);
});

test("space on a focused button is left to the button", () => {
  const button = { tagName: "BUTTON" };
  assert.equal(shortcutForEvent({ key: " ", target: button }), null);
  assert.equal(shortcutForEvent({ key: "s", target: button }), "split");
});
