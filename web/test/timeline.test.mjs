import test from "node:test";
import assert from "node:assert/strict";
import {
  addAudioClip,
  adjustClipEffect,
  adjustClipVolume,
  audioClipsAtTime,
  audioClipLoops,
  audioClipSourceIn,
  audioFileOffset,
  audioFileSeconds,
  audioRateAtTime,
  audioRateSegments,
  boringRanges,
  canRedo,
  canUndo,
  clampAudioVolume,
  clampClipVolume,
  clampEffect,
  clampMusicVolume,
  clampSpeed,
  clipDuration,
  clipFilter,
  cutRange,
  cutdown,
  cutdownAudioClips,
  deleteClip,
  detectSilence,
  captionsFromWords,
  effectiveVolume,
  formatTime,
  makeAudioClip,
  makeClip,
  makeHistory,
  moveClip,
  musicLastLoopLength,
  musicLoops,
  normaliseEffects,
  packClips,
  pushHistory,
  redoHistory,
  removeAudioClip,
  respeedAudioClips,
  setAudioClipMuted,
  setAudioClipVolume,
  setClipEffects,
  setClipMuted,
  setClipVolume,
  shiftAudioClips,
  shiftTimedItems,
  shortcutForEvent,
  snapshotState,
  splitAudioClips,
  splitClip,
  splitSecondId,
  toggleAudioClipMuted,
  toggleClipMuted,
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
  assert.equal(out[1].id, "a-s1");
  assert.equal(clipDuration(out[0]), 4);
  assert.equal(clipDuration(out[1]), 6);
  assert.equal(out[1].sourceIn, 4);
  assert.equal(totalDuration(out), 16);
});

// Splitting a split clip used to nest the ids, "clip-1-b-b" and
// worse with every cut. Now the second half is numbered off the
// base id, so the ids stay short however often a clip is cut.
test("splitting a split clip twice keeps ids short and unique", () => {
  const clips = [makeClip("clip-1", "a.mp4", null, 10)];
  const once = splitClip(clips, "clip-1", 4);
  assert.deepEqual(
    once.map((c) => c.id),
    ["clip-1", "clip-1-s1"],
  );
  const twice = splitClip(once, "clip-1-s1", 7);
  assert.deepEqual(
    twice.map((c) => c.id),
    ["clip-1", "clip-1-s1", "clip-1-s2"],
  );
  const thrice = splitClip(twice, "clip-1-s2", 8.5);
  assert.deepEqual(
    thrice.map((c) => [c.id, c.sourceIn, c.sourceOut]),
    [
      ["clip-1", 0, 4],
      ["clip-1-s1", 4, 7],
      ["clip-1-s2", 7, 8.5],
      ["clip-1-s3", 8.5, 10],
    ],
  );
  assert.equal(totalDuration(thrice), 10);
  assert.equal(new Set(thrice.map((c) => c.id)).size, 4);
  assert.ok(thrice.every((c) => !c.id.includes("-b") && c.id.length <= "clip-1-s3".length));
  // Cutting the first half again skips the numbers already taken.
  const again = splitClip(thrice, "clip-1", 2);
  assert.deepEqual(
    again.map((c) => c.id),
    ["clip-1", "clip-1-s4", "clip-1-s1", "clip-1-s2", "clip-1-s3"],
  );
  assert.equal(totalDuration(again), 10);
});

test("split ids number off the base and skip taken numbers", () => {
  assert.equal(splitSecondId("clip-1", new Set()), "clip-1-s1");
  assert.equal(splitSecondId("clip-1", new Set(["clip-1-s1"])), "clip-1-s2");
  assert.equal(
    splitSecondId("clip-1-s2", new Set(["clip-1", "clip-1-s1", "clip-1-s2"])),
    "clip-1-s3",
  );
  // A clip saved by the old scheme, with nested "-b" ids, gets a
  // clean number the next time it is cut.
  assert.equal(splitSecondId("clip-1-b-b", new Set(["clip-1"])), "clip-1-s1");
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
  assert.equal(out[1].id, "a-s1");
  assert.equal(totalDuration(out), 15);
});

// Cutting a cut clip again numbers the new half off the base id,
// it does not nest the way the old "-b" ids did.
test("cutRange on a cut clip keeps ids short", () => {
  const clips = [makeClip("a", "a.mp4", null, 20)];
  const once = cutRange(clips, 5, 10);
  const twice = cutRange(once, 8, 12);
  assert.deepEqual(
    twice.map((c) => [c.id, c.sourceIn, c.sourceOut]),
    [
      ["a", 0, 5],
      ["a-s1", 10, 13],
      ["a-s2", 17, 20],
    ],
  );
  assert.equal(totalDuration(twice), 11);
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

test("new clips start unmuted at full volume", () => {
  const clip = makeClip("a", "a.mp4", null, 10);
  assert.equal(clip.volume, 1);
  assert.equal(clip.muted, false);
  assert.equal(effectiveVolume(clip), 1);
});

test("clip volume clamps to 0 to 1", () => {
  assert.equal(clampClipVolume(0.5), 0.5);
  assert.equal(clampClipVolume(2), 1);
  assert.equal(clampClipVolume(-1), 0);
  assert.equal(clampClipVolume(0), 0);
  assert.equal(clampClipVolume(NaN), 1);
  assert.equal(clampClipVolume(undefined), 1);
});

test("a muted clip is silent but keeps its volume", () => {
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.volume = 0.6;
  assert.equal(effectiveVolume(clip), 0.6);
  const muted = setClipMuted([clip], "a");
  assert.equal(muted[0].muted, true);
  assert.equal(muted[0].volume, 0.6);
  assert.equal(effectiveVolume(muted[0]), 0);
  const back = setClipMuted(muted, "a", false);
  assert.equal(back[0].muted, false);
  assert.equal(effectiveVolume(back[0]), 0.6);
});

test("toggling mute flips one clip and leaves the rest alone", () => {
  const out = toggleClipMuted(twoClips(), "b");
  assert.equal(out[0].muted, false);
  assert.equal(out[1].muted, true);
  const again = toggleClipMuted(out, "b");
  assert.equal(again[1].muted, false);
});

test("setting a clip volume unmutes it and leaves the rest alone", () => {
  const muted = setClipMuted(twoClips(), "a", true);
  const out = setClipVolume(muted, "a", 0.5);
  assert.equal(out[0].volume, 0.5);
  assert.equal(out[0].muted, false);
  assert.equal(out[1].volume, 1);
  assert.equal(out[1].muted, false);
});

test("setting a clip volume to zero keeps the mute flag as it is", () => {
  const out = setClipVolume(twoClips(), "a", 0);
  assert.equal(out[0].volume, 0);
  assert.equal(out[0].muted, false);
  const muted = setClipMuted(twoClips(), "a", true);
  const still = setClipVolume(muted, "a", 0);
  assert.equal(still[0].muted, true);
});

test("adjusting a clip volume moves it and clamps at the ends", () => {
  const down = adjustClipVolume(twoClips(), "a", -0.25);
  assert.equal(down[0].volume, 0.75);
  assert.equal(down[1].volume, 1);
  const over = adjustClipVolume(down, "a", 1);
  assert.equal(over[0].volume, 1);
  const under = adjustClipVolume(twoClips(), "a", -2);
  assert.equal(under[0].volume, 0);
});

test("adjusting the volume of a muted clip turns it back on", () => {
  const muted = setClipMuted(twoClips(), "a", true);
  const out = adjustClipVolume(muted, "a", 0.25);
  assert.equal(out[0].volume, 1);
  assert.equal(out[0].muted, false);
});

test("split keeps the volume and mute of the clip it came from", () => {
  const clips = [makeClip("a", "a.mp4", null, 10)];
  const prepared = setClipMuted(setClipVolume(clips, "a", 0.4), "a", true);
  const out = splitClip(prepared, "a", 4);
  assert.equal(out.length, 2);
  assert.equal(out[0].volume, 0.4);
  assert.equal(out[0].muted, true);
  assert.equal(out[1].volume, 0.4);
  assert.equal(out[1].muted, true);
});

test("a clip without a muted flag counts as unmuted", () => {
  const clip = { id: "a", volume: 0.7 };
  assert.equal(effectiveVolume(clip), 0.7);
  assert.equal(effectiveVolume(null), 0);
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

function twoAudioClips() {
  return [
    makeAudioClip("a1", "voice.mp3", null, 2, 5),
    makeAudioClip("a2", "sfx.mp3", null, 12, 3),
  ];
}

test("an audio clip clamps its start, duration and volume", () => {
  const clip = makeAudioClip("a", "voice.mp3", null, -2, 5, 2);
  assert.equal(clip.start, 0);
  assert.equal(clip.duration, 5);
  assert.equal(clip.volume, 1);
  assert.equal(clip.muted, false);
  assert.equal(makeAudioClip("b", "x.mp3", null, 1, 0).duration, 0);
});

test("an audio clip keeps its source offset, or starts at zero", () => {
  const clip = makeAudioClip("a", "voice.mp3", null, 2, 5, 1, 3);
  assert.equal(clip.sourceIn, 3);
  assert.equal(makeAudioClip("b", "x.mp3", null, 2, 5).sourceIn, 0);
  assert.equal(makeAudioClip("c", "x.mp3", null, 2, 5, 1, -2).sourceIn, 0);
  assert.equal(audioClipSourceIn({}), 0);
  assert.equal(audioClipSourceIn({ sourceIn: -1 }), 0);
  assert.equal(audioClipSourceIn({ sourceIn: 2.5 }), 2.5);
});

test("audio volume clamps to 0 to 1", () => {
  assert.equal(clampAudioVolume(0.5), 0.5);
  assert.equal(clampAudioVolume(2), 1);
  assert.equal(clampAudioVolume(-1), 0);
  assert.equal(clampAudioVolume(0), 0);
  assert.equal(clampAudioVolume(NaN), 1);
});

test("adding an audio clip keeps the track in timeline order", () => {
  const out = addAudioClip(twoAudioClips(), makeAudioClip("a3", "late.mp3", null, 8, 2));
  assert.deepEqual(out.map((c) => c.id), ["a1", "a3", "a2"]);
});

test("removing an audio clip leaves the rest alone", () => {
  const out = removeAudioClip(twoAudioClips(), "a1");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a2");
  assert.equal(removeAudioClip(twoAudioClips(), "nope").length, 2);
});

test("audio clips at a time only sound inside their clip", () => {
  const clips = twoAudioClips();
  assert.deepEqual(audioClipsAtTime(clips, 1), []);
  assert.deepEqual(audioClipsAtTime(clips, 2).map((c) => c.id), ["a1"]);
  assert.deepEqual(audioClipsAtTime(clips, 7), []);
  assert.deepEqual(audioClipsAtTime(clips, 13).map((c) => c.id), ["a2"]);
  const overlap = addAudioClip(clips, makeAudioClip("a3", "bed.mp3", null, 3, 10));
  assert.deepEqual(audioClipsAtTime(overlap, 4).map((c) => c.id), ["a1", "a3"]);
});

test("audio clip volume and mute follow the clip rules", () => {
  const clips = twoAudioClips();
  const quieter = setAudioClipVolume(clips, "a1", 0.3);
  assert.equal(quieter[0].volume, 0.3);
  assert.equal(quieter[0].muted, false);
  assert.equal(quieter[1].volume, 1);
  const muted = setAudioClipMuted(clips, "a1");
  assert.equal(muted[0].muted, true);
  assert.equal(muted[0].volume, 1);
  assert.equal(effectiveVolume(muted[0]), 0);
  const flipped = toggleAudioClipMuted(muted, "a1");
  assert.equal(flipped[0].muted, false);
  const raised = setAudioClipVolume(muted, "a1", 0.5);
  assert.equal(raised[0].muted, false);
});

test("shifting audio clips follows the cuts", () => {
  const ranges = [{ start: 3.5, end: 7.5 }];
  const clips = [
    makeAudioClip("early", "early.mp3", null, 1, 1),
    makeAudioClip("straddler", "mid.mp3", null, 6, 3),
    makeAudioClip("late", "late.mp3", null, 10, 2),
    makeAudioClip("inside", "gone.mp3", null, 4, 3),
  ];
  const out = shiftAudioClips(clips, ranges);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration]),
    [
      ["early", 1, 1],
      ["straddler-s1", 3.5, 1.5],
      ["late", 6, 2],
    ],
  );
  // The straddler was split at the end of the cut, so the part
  // after it resumes 1.5 seconds into its file, not from the start.
  assert.equal(out[1].sourceIn, 1.5);
});

test("shifting audio clips across two cuts splits the long one", () => {
  const clips = [makeAudioClip("a", "a.mp3", null, 0, 20)];
  const out = shiftAudioClips(clips, [
    { start: 2, end: 4 },
    { start: 8, end: 10 },
  ]);
  // The cut bits are gone, and what is left is three clips: the
  // head, the middle, and the tail, each resuming from the file
  // position where its timeline stretch starts.
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration, c.sourceIn]),
    [
      ["a", 0, 2, 0],
      ["a-s2", 2, 4, 4],
      ["a-s4", 6, 10, 10],
    ],
  );
  const gone = shiftAudioClips([makeAudioClip("b", "b.mp3", null, 3, 1)], [{ start: 2, end: 4 }]);
  assert.deepEqual(gone, []);
});

// A cut that trims the left of an audio clip moves the trimmed
// seconds into the source offset, so the clip resumes partway
// through its file instead of starting over.

test("a cut from the left moves the trimmed bit into the source offset", () => {
  const clips = [makeAudioClip("a", "a.mp3", null, 2, 5)];
  const out = shiftAudioClips(clips, [{ start: 0, end: 4 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 0);
  assert.equal(out[0].duration, 3);
  assert.equal(out[0].sourceIn, 2);
});

test("a cut from the left adds to a source offset the clip already had", () => {
  const clip = makeAudioClip("a", "a.mp3", null, 2, 5, 1, 3);
  const out = shiftAudioClips([clip], [{ start: 0, end: 4 }]);
  assert.equal(out[0].start, 0);
  assert.equal(out[0].duration, 3);
  assert.equal(out[0].sourceIn, 5);
});

test("a cut from the left counts sped up seconds twice", () => {
  // The clip sits over a 2x video clip, so cutting its first 2
  // timeline seconds takes 4 file seconds off the front.
  const clips = [makeAudioClip("a", "a.mp3", null, 0, 5)];
  const out = shiftAudioClips(clips, [{ start: 0, end: 2 }], respeedTo(2));
  assert.equal(out[0].start, 0);
  assert.equal(out[0].duration, 3);
  assert.equal(out[0].sourceIn, 4);
});

test("a cut from the right leaves the source offset alone", () => {
  const clip = makeAudioClip("a", "a.mp3", null, 2, 5, 1, 3);
  const out = shiftAudioClips([clip], [{ start: 5, end: 7 }]);
  assert.equal(out[0].start, 2);
  assert.equal(out[0].duration, 3);
  assert.equal(out[0].sourceIn, 3);
  const untouched = shiftAudioClips([makeAudioClip("b", "b.mp3", null, 10, 2)], [
    { start: 2, end: 4 },
  ]);
  assert.equal(untouched[0].start, 8);
  assert.equal(untouched[0].sourceIn, 0);
});

// Splitting an audio clip: the two halves play on from each
// other, so the split itself changes nothing about how the track
// sounds, it just lets the halves move on their own afterwards.

test("splitting an audio clip at a point makes two clips", () => {
  const clip = { ...makeAudioClip("voice", "voice.mp3", null, 2, 5), volume: 0.5, muted: true };
  const out = splitAudioClips([clip], 4);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration, c.sourceIn]),
    [
      ["voice", 2, 2, 0],
      ["voice-s1", 4, 3, 2],
    ],
  );
  for (const half of out) {
    assert.equal(half.name, "voice.mp3");
    assert.equal(half.volume, 0.5);
    assert.equal(half.muted, true);
  }
  // The second half picks up exactly where the first left off:
  // 4 seconds into the file at 6 seconds on the timeline, the
  // same spot the unsplit clip would be at.
  assert.equal(audioFileOffset(out[1], [], 6), 4);
  assert.equal(audioFileOffset(out[1], [], 6), audioFileOffset(clip, [], 6));
});

test("splitting an audio clip twice keeps ids short and unique", () => {
  const clip = makeAudioClip("voice", "voice.mp3", null, 0, 10);
  const once = splitAudioClips([clip], 4);
  assert.deepEqual(
    once.map((c) => c.id),
    ["voice", "voice-s1"],
  );
  const twice = splitAudioClips(once, 7);
  assert.deepEqual(
    twice.map((c) => [c.id, c.start, c.duration, c.sourceIn]),
    [
      ["voice", 0, 4, 0],
      ["voice-s1", 4, 3, 4],
      ["voice-s2", 7, 3, 7],
    ],
  );
  assert.equal(new Set(twice.map((c) => c.id)).size, 3);
  assert.ok(twice.every((c) => !c.id.includes("-b")));
});

test("splitting an audio clip at its edges leaves it alone", () => {
  const clips = [makeAudioClip("voice", "voice.mp3", null, 2, 5)];
  assert.equal(splitAudioClips(clips, 2), clips);
  assert.equal(splitAudioClips(clips, 7), clips);
  assert.equal(splitAudioClips(clips, 0), clips);
  assert.deepEqual(splitAudioClips([], 4), []);
});

test("splitting an audio clip under a sped up video counts the speed", () => {
  // The first 2 timeline seconds sit under a 2x clip, so the
  // second half resumes 4 file seconds in, not 2.
  const clip = makeAudioClip("voice", "voice.mp3", null, 0, 5);
  const out = splitAudioClips([clip], 2, respeedTo(2));
  assert.equal(out.length, 2);
  assert.equal(out[1].start, 2);
  assert.equal(out[1].duration, 3);
  assert.equal(out[1].sourceIn, 4);
});

test("splitting an audio clip adds to a source offset it already had", () => {
  const clip = makeAudioClip("voice", "voice.mp3", null, 2, 5, 1, 3);
  const out = splitAudioClips([clip], 4);
  assert.equal(out[1].start, 4);
  assert.equal(out[1].duration, 3);
  assert.equal(out[1].sourceIn, 5);
});

test("a cut in the middle of an audio clip splits it and resumes past the cut", () => {
  // This was the old bug: one clip played straight through the
  // removed bit. Now the part after the cut is its own clip,
  // starting 10 seconds into its file.
  const clip = makeAudioClip("voice", "voice.mp3", null, 0, 20);
  const out = shiftAudioClips([clip], [{ start: 5, end: 10 }]);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration, c.sourceIn]),
    [
      ["voice", 0, 5, 0],
      ["voice-s2", 5, 10, 10],
    ],
  );
});

test("a cutdown trims and drops audio clips at the target", () => {
  const clips = [
    makeAudioClip("a", "a.mp3", null, 0, 10),
    makeAudioClip("b", "b.mp3", null, 12, 5),
    makeAudioClip("c", "c.mp3", null, 28, 5),
  ];
  const out = cutdownAudioClips(clips, 30);
  assert.equal(out.length, 3);
  assert.equal(out[0].duration, 10);
  assert.equal(out[1].duration, 5);
  assert.equal(out[2].duration, 2);
  const trimmed = cutdownAudioClips(clips, 15);
  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[1].duration, 3);
  assert.equal(trimmed[1].start, 12);
  assert.equal(cutdownAudioClips(clips, 0).length, 3);
});

test("a snapshot covers the audio track too", () => {
  const state = snapshotState({
    clips: twoClips(),
    overlays: [],
    captions: [],
    audioClips: twoAudioClips(),
    music: null,
  });
  assert.equal(state.audioClips.length, 2);
  assert.equal(state.audioClips[0].name, "voice.mp3");
  const undone = undoHistory(pushHistory(makeHistory(), state), editState([], [], [], null));
  assert.equal(undone.state.audioClips.length, 2);
});

// Respeeding the audio track: the video clips run 10 seconds then
// 6 seconds at 1x, so the edit is 16 seconds long.

function respeedTo(factor) {
  return twoClips().map((c) => ({ ...c, speed: factor }));
}

test("respeeding the audio track follows a whole-edit speed up", () => {
  const clips = [
    makeAudioClip("early", "early.mp3", null, 2, 5),
    makeAudioClip("straddler", "mid.mp3", null, 8, 6),
  ];
  const out = respeedAudioClips(clips, twoClips(), respeedTo(2));
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration]),
    [
      ["early", 1, 2.5],
      ["straddler", 4, 3],
    ],
  );
});

test("respeeding the audio track follows a whole-edit slow down", () => {
  const clip = { ...makeAudioClip("voice", "voice.mp3", null, 2, 5), volume: 0.5, muted: true };
  const out = respeedAudioClips([clip], twoClips(), respeedTo(0.5));
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 4);
  assert.equal(out[0].duration, 10);
  assert.equal(out[0].name, "voice.mp3");
  assert.equal(out[0].volume, 0.5);
  assert.equal(out[0].muted, true);
});

test("respeeding an empty audio track stays empty", () => {
  assert.deepEqual(respeedAudioClips([], twoClips(), respeedTo(2)), []);
  assert.deepEqual(respeedAudioClips([], twoClips(), respeedTo(0.5)), []);
});

test("respeeding drops audio clips past the new end and trims straddlers", () => {
  const clips = [
    makeAudioClip("inside", "in.mp3", null, 2, 2),
    makeAudioClip("straddler", "mid.mp3", null, 14, 4),
    makeAudioClip("past", "past.mp3", null, 17, 2),
  ];
  const out = respeedAudioClips(clips, twoClips(), respeedTo(2));
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration]),
    [
      ["inside", 1, 1],
      ["straddler", 7, 1],
    ],
  );
});

test("respeeding maps through clips that had different speeds", () => {
  const before = [makeClip("a", "a.mp4", null, 10), makeClip("b", "b.mp4", null, 10)];
  before[1].speed = 2;
  const after = before.map((c) => ({ ...c, speed: 2 }));
  const out = respeedAudioClips([makeAudioClip("voice", "voice.mp3", null, 8, 5)], before, after);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 4);
  assert.equal(out[0].duration, 4);
});

test("respeeding with no video clips leaves the track alone", () => {
  const clips = twoAudioClips();
  assert.deepEqual(respeedAudioClips(clips, [], respeedTo(2)), clips);
});

// Speeding up or slowing down one clip only: the clips before it
// do not move, the ones after it shift by the time gained or lost.

function respeedOne(id, factor) {
  return twoClips().map((c) => (c.id === id ? { ...c, speed: factor } : c));
}

test("speeding up the first clip only moves later audio earlier", () => {
  const clips = [
    makeAudioClip("later", "later.mp3", null, 12, 2),
    { ...makeAudioClip("straddler", "mid.mp3", null, 8, 6), volume: 0.5, muted: true },
  ];
  const out = respeedAudioClips(clips, twoClips(), respeedOne("a", 2));
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration]),
    [
      ["later", 7, 2],
      ["straddler", 4, 5],
    ],
  );
  const straddler = out.find((c) => c.id === "straddler");
  assert.equal(straddler.name, "mid.mp3");
  assert.equal(straddler.volume, 0.5);
  assert.equal(straddler.muted, true);
});

test("slowing down one clip only pushes later audio later", () => {
  const out = respeedAudioClips(
    [makeAudioClip("later", "later.mp3", null, 12, 2)],
    twoClips(),
    respeedOne("b", 0.5),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 14);
  assert.equal(out[0].duration, 4);
});

test("audio before the changed clip does not move", () => {
  const clips = [
    makeAudioClip("before", "before.mp3", null, 2, 3),
    makeAudioClip("after", "after.mp3", null, 12, 2),
  ];
  const out = respeedAudioClips(clips, twoClips(), respeedOne("b", 2));
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((c) => [c.id, c.start, c.duration]),
    [
      ["before", 2, 3],
      ["after", 11, 1],
    ],
  );
});

// Rate matched audio: the audio track has to play at the speed of
// the video clip under the playhead, or a voiceover drifts and
// gets cut off once the edit is sped up or slowed down.

test("a bad speed falls back to normal speed", () => {
  assert.equal(clampSpeed(2), 2);
  assert.equal(clampSpeed(0.5), 0.5);
  assert.equal(clampSpeed(0), 1);
  assert.equal(clampSpeed(-1), 1);
  assert.equal(clampSpeed(NaN), 1);
  assert.equal(clampSpeed(undefined), 1);
});

test("the audio rate follows the video clip under the playhead", () => {
  const clips = twoClips();
  clips[1].speed = 2;
  assert.equal(audioRateAtTime(clips, 2), 1);
  assert.equal(audioRateAtTime(clips, 12), 2);
  assert.equal(audioRateAtTime(clips, 9.9), 1);
  assert.equal(audioRateAtTime(clips, 20), 1);
  assert.equal(audioRateAtTime([], 2), 1);
});

test("rate segments follow each video clip an audio clip sits under", () => {
  const clips = twoClips();
  clips[1].speed = 2;
  const voice = makeAudioClip("voice", "voice.mp3", null, 8, 5);
  assert.deepEqual(audioRateSegments(voice, clips), [
    { start: 8, end: 10, rate: 1 },
    { start: 10, end: 13, rate: 2 },
  ]);
});

test("rate segments join up when neighbouring clips share a speed", () => {
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.deepEqual(audioRateSegments(voice, respeedTo(2)), [{ start: 2, end: 4.5, rate: 2 }]);
});

test("rate segments fall back to normal speed with no video clips", () => {
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 5);
  assert.deepEqual(audioRateSegments(voice, []), [{ start: 2, end: 7, rate: 1 }]);
  assert.deepEqual(audioRateSegments(voice), [{ start: 2, end: 7, rate: 1 }]);
});

test("the file offset counts sped up seconds twice", () => {
  // A 5 second voiceover squeezed to 2.5 seconds by a 2x edit.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 2), 0);
  assert.equal(audioFileOffset(voice, respeedTo(2), 3.5), 3);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5), 5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 9), 5);
});

test("the file offset adds up across clips at different speeds", () => {
  const clips = twoClips();
  clips[1].speed = 2;
  const voice = makeAudioClip("voice", "voice.mp3", null, 8, 5);
  assert.equal(audioFileOffset(voice, clips, 8), 0);
  assert.equal(audioFileOffset(voice, clips, 10), 2);
  assert.equal(audioFileOffset(voice, clips, 11), 4);
  assert.equal(audioFileOffset(voice, clips, 13), 8);
});

test("the file offset is just the timeline offset at normal speed", () => {
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 5);
  assert.equal(audioFileOffset(voice, twoClips(), 4), 2);
  assert.equal(audioFileOffset(voice, [], 4), 2);
  assert.equal(audioFileOffset(voice, twoClips(), 1), 0);
});

// Looping audio: a short clip over a sped up stretch needs more of
// its file than the file holds, so it starts over from the top
// instead of running out and going quiet.

test("an audio clip counts the file seconds it needs", () => {
  // A 5 second voiceover squeezed to 2.5 seconds by a 2x edit needs
  // all 5 file seconds, the same clip at normal speed needs 2.5.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioFileSeconds(voice, respeedTo(2)), 5);
  assert.equal(audioFileSeconds(voice, twoClips()), 2.5);
  assert.equal(audioFileSeconds(voice, []), 2.5);
  assert.equal(audioFileSeconds(null, []), 0);
  assert.equal(audioFileSeconds(makeAudioClip("voice", "voice.mp3", null, 2, 0), []), 0);
});

test("an audio clip counts how many times its file has to play", () => {
  // The 5 second voiceover above needs 5 file seconds at 2x, so a
  // 2 second file plays 3 times and a 5 second file plays once.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioClipLoops(voice, respeedTo(2), 2), 3);
  assert.equal(audioClipLoops(voice, respeedTo(2), 5), 1);
  assert.equal(audioClipLoops(voice, respeedTo(2), 10), 1);
  assert.equal(audioClipLoops(voice, twoClips(), 2), 2);
  assert.equal(audioClipLoops(voice, respeedTo(2), 0), 0);
  assert.equal(audioClipLoops(voice, respeedTo(2), undefined), 0);
  assert.equal(audioClipLoops(null, [], 2), 0);
  // A clip starting 8 seconds into a 10 second file has only 2
  // seconds left before it wraps, so 5 file seconds take 2 plays
  // even though the file is longer than the clip needs on its own.
  const trimmed = makeAudioClip("voice", "voice.mp3", null, 2, 5, 1, 8);
  assert.equal(audioClipLoops(trimmed, [], 10), 2);
  assert.equal(audioClipLoops(trimmed, [], 20), 1);
});

test("the file offset wraps back to the start when the clip loops", () => {
  // The 5 second voiceover at 2x over a 2 second file: at 3.5
  // seconds in it is 3 file seconds in, which is 1 second into its
  // second play, and at the end it has played 5 file seconds, which
  // is 1 second into its third play.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 2, 2), 0);
  assert.equal(audioFileOffset(voice, respeedTo(2), 3.5, 2), 1);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5, 2), 1);
  assert.equal(audioFileOffset(voice, respeedTo(2), 9, 2), 1);
});

test("the file offset does not wrap when the file is long enough", () => {
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 3.5, 10), 3);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5, 10), 5);
});

test("the file offset is unwrapped when the file length is unknown", () => {
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 2.5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5), 5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5, 0), 5);
  assert.equal(audioFileOffset(voice, respeedTo(2), 4.5, NaN), 5);
});

test("the file offset starts at the clip's source offset", () => {
  // A clip trimmed from the left resumes 3 seconds into its file,
  // so at its start the offset is 3, a second in it is 4, and past
  // the end it stops at the end of what the clip covers.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 5, 1, 3);
  assert.equal(audioFileOffset(voice, [], 2), 3);
  assert.equal(audioFileOffset(voice, [], 3), 4);
  assert.equal(audioFileOffset(voice, [], 7), 8);
  assert.equal(audioFileOffset(voice, [], 9), 8);
});

test("the file offset wraps from the source offset when the clip loops", () => {
  // A 10 second file, the clip starts 8 seconds in and needs 5
  // file seconds: it plays 8 to 10, wraps, and ends 3 seconds into
  // its second play.
  const voice = makeAudioClip("voice", "voice.mp3", null, 2, 5, 1, 8);
  assert.equal(audioFileOffset(voice, [], 2, 10), 8);
  assert.equal(audioFileOffset(voice, [], 4, 10), 0);
  assert.equal(audioFileOffset(voice, [], 7, 10), 3);
});
