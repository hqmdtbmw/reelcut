import test from "node:test";
import assert from "node:assert/strict";
import {
  CROSSFADE_DEFAULT,
  CROSSFADE_MAX,
  canUndo,
  clearAllTransitionsIn,
  clampTransitionDuration,
  clipFadeOpacity,
  crossfadeAllStored,
  crossfadeAtTime,
  crossfadeStored,
  cutRange,
  deleteClip,
  makeClip,
  makeHistory,
  moveClip,
  packClips,
  pushHistory,
  setAllTransitionsIn,
  setTransitionIn,
  snapshotState,
  splitClip,
  totalDuration,
  transitionDuration,
  trimClip,
  undoHistory,
} from "../src/timeline.js";

function twoClips() {
  return [makeClip("a", "a.mp4", null, 10), makeClip("b", "b.mp4", null, 10)];
}

function threeClips() {
  return [
    makeClip("a", "a.mp4", null, 10),
    makeClip("b", "b.mp4", null, 10),
    makeClip("c", "c.mp4", null, 10),
  ];
}

test("a crossfade never runs longer than the shorter clip", () => {
  assert.equal(clampTransitionDuration(0.5, 10, 10), 0.5);
  assert.equal(clampTransitionDuration(5, 10, 10), CROSSFADE_MAX);
  assert.equal(clampTransitionDuration(1, 0.4, 10), 0.4);
  assert.equal(clampTransitionDuration(1, 10, 0.3), 0.3);
  assert.equal(clampTransitionDuration(0, 10, 10), 0);
  assert.equal(clampTransitionDuration(-1, 10, 10), 0);
  assert.equal(clampTransitionDuration(NaN, 10, 10), 0);
  assert.equal(clampTransitionDuration(0.5, 0, 10), 0);
});

test("the join length comes from the incoming clip and clamps to the clips", () => {
  const [a, b] = twoClips();
  assert.equal(transitionDuration(a, b), 0);
  const faded = setTransitionIn([a, b], "b", 0.5);
  assert.equal(transitionDuration(faded[0], faded[1]), 0.5);
  const short = [makeClip("a", "a.mp4", null, 0.4), makeClip("b", "b.mp4", null, 10)];
  const shortFaded = setTransitionIn(short, "b", 0.5);
  assert.equal(transitionDuration(shortFaded[0], shortFaded[1]), 0.4);
  // A clip sped up gets shorter, so the dissolve shortens with it.
  const sped = [{ ...short[0], speed: 2 }, { ...short[1], speed: 1 }];
  const spedFaded = setTransitionIn(sped, "b", 0.5);
  assert.equal(transitionDuration(spedFaded[0], spedFaded[1]), 0.2);
  // An old clip without the field counts as a straight cut.
  const { transitionIn, ...oldClip } = b;
  assert.equal(transitionDuration(a, oldClip), 0);
});

test("a crossfade window sits centred on the join", () => {
  const clips = setTransitionIn(twoClips(), "b", 1);
  const packed = packClips(clips);
  assert.equal(crossfadeAtTime(packed, 5), null);
  const start = crossfadeAtTime(packed, 9.5);
  assert.equal(start.progress, 0);
  assert.equal(start.left.id, "a");
  assert.equal(start.right.id, "b");
  const middle = crossfadeAtTime(packed, 10);
  assert.equal(middle.progress, 0.5);
  const end = crossfadeAtTime(packed, 10.49);
  assert.ok(end.progress > 0.9 && end.progress < 1);
  assert.equal(crossfadeAtTime(packed, 10.5), null);
  assert.equal(crossfadeAtTime(packed, 15), null);
  // No crossfade set means no window anywhere.
  assert.equal(crossfadeAtTime(packClips(twoClips()), 10), null);
  // One clip has no join at all.
  assert.equal(crossfadeAtTime(packClips([makeClip("a", "a.mp4", null, 10)]), 5), null);
});

test("fade in and out opacity ramps at the ends and holds in the middle", () => {
  const clip = { ...makeClip("a", "a.mp4", null, 10), start: 0, fadeIn: 2, fadeOut: 2 };
  assert.equal(clipFadeOpacity(clip, 0), 0);
  assert.equal(clipFadeOpacity(clip, 1), 0.5);
  assert.equal(clipFadeOpacity(clip, 2), 1);
  assert.equal(clipFadeOpacity(clip, 5), 1);
  assert.equal(clipFadeOpacity(clip, 9), 0.5);
  assert.equal(clipFadeOpacity(clip, 10), 0);
  const plain = { ...makeClip("a", "a.mp4", null, 10), start: 0 };
  assert.equal(clipFadeOpacity(plain, 0), 1);
  assert.equal(clipFadeOpacity(plain, 9.9), 1);
});

test("setting and clearing crossfades touches only the join asked for", () => {
  const clips = threeClips();
  const one = setTransitionIn(clips, "b", 0.5);
  assert.deepEqual(
    one.map((c) => c.transitionIn),
    [0, 0.5, 0],
  );
  const tooLong = setTransitionIn(clips, "c", 5);
  assert.equal(tooLong[2].transitionIn, CROSSFADE_MAX);
  const bad = setTransitionIn(clips, "c", NaN);
  assert.equal(bad[2].transitionIn, 0);
  const all = setAllTransitionsIn(clips, 1);
  assert.deepEqual(
    all.map((c) => c.transitionIn),
    [0, 1, 1],
  );
  const none = clearAllTransitionsIn(all);
  assert.deepEqual(
    none.map((c) => c.transitionIn),
    [0, 0, 0],
  );
  // The default is the half second the agent bar uses.
  assert.equal(CROSSFADE_DEFAULT, 0.5);
});

test("writing a crossfade stores only what the two clips allow", () => {
  const short = [makeClip("a", "a.mp4", null, 0.4), makeClip("b", "b.mp4", null, 10)];
  const stored = setTransitionIn(short, "b", 1);
  assert.equal(stored[1].transitionIn, 0.4);
  // The slider value and the label both come from the join length,
  // so they match the stored value.
  assert.equal(transitionDuration(stored[0], stored[1]), stored[1].transitionIn);
  // A sped up clip is shorter, so the same write stores less.
  const sped = [{ ...short[0], speed: 2 }, short[1]];
  assert.equal(setTransitionIn(sped, "b", 0.5)[1].transitionIn, 0.2);
  // Writing again after a trim stores the new shorter length, so
  // the slider and the stored value agree after the trim too.
  const trimmed = trimClip(setTransitionIn(twoClips(), "b", 1.5), "a", 0, 0.4);
  const rewritten = setTransitionIn(trimmed, "b", 1.5);
  assert.equal(rewritten[1].transitionIn, 0.4);
  assert.equal(transitionDuration(rewritten[0], rewritten[1]), rewritten[1].transitionIn);
  // A clip with no clip before it has no join, so it only gets
  // the 0 to 2 second clamp.
  assert.equal(setTransitionIn(twoClips(), "a", 5)[0].transitionIn, CROSSFADE_MAX);
  assert.equal(setTransitionIn(twoClips(), "a", NaN)[0].transitionIn, 0);
});

test("crossfades on every join store only what each join allows", () => {
  const clips = [
    makeClip("a", "a.mp4", null, 10),
    makeClip("b", "b.mp4", null, 0.4),
    makeClip("c", "c.mp4", null, 10),
  ];
  const all = setAllTransitionsIn(clips, 1);
  // Both joins touch the short middle clip, so both store 0.4.
  assert.deepEqual(
    all.map((c) => c.transitionIn),
    [0, 0.4, 0.4],
  );
  assert.equal(transitionDuration(all[0], all[1]), 0.4);
  assert.equal(transitionDuration(all[1], all[2]), 0.4);
});

test("a crossfade reply quotes the length that was actually stored", () => {
  // A normal join stores the length asked for.
  const [a, b] = twoClips();
  assert.deepEqual(crossfadeStored(a, b, 0.5), { seconds: 0.5, shortened: false, capped: false });
  // Short clips store less, and say so.
  const short = [makeClip("a", "a.mp4", null, 0.4), makeClip("b", "b.mp4", null, 10)];
  assert.deepEqual(crossfadeStored(short[0], short[1], 0.5), {
    seconds: 0.4,
    shortened: true,
    capped: false,
  });
  // The stored length matches what the setter writes, so the reply
  // and the join agree.
  const stored = setTransitionIn(short, "b", 0.5);
  assert.equal(crossfadeStored(short[0], short[1], 0.5).seconds, stored[1].transitionIn);
  // Clips with no room at all store nothing.
  const empty = [makeClip("a", "a.mp4", null, 0), makeClip("b", "b.mp4", null, 10)];
  assert.deepEqual(crossfadeStored(empty[0], empty[1], 0.5), {
    seconds: 0,
    shortened: false,
    capped: false,
  });
  // Asking for more than the 2 second ceiling caps it, and that is
  // not the clips being too short.
  assert.deepEqual(crossfadeStored(a, b, 5), { seconds: 2, shortened: false, capped: true });
  // Bad input stores nothing.
  assert.deepEqual(crossfadeStored(a, b, NaN), { seconds: 0, shortened: false, capped: false });
});

test("crossfades on every join report the real lengths", () => {
  // Every join the same length when every clip has room.
  const even = crossfadeAllStored(threeClips(), 1);
  assert.deepEqual(even.lengths, [1, 1]);
  assert.equal(even.shortest, 1);
  assert.equal(even.longest, 1);
  assert.equal(even.addedCount, 2);
  assert.equal(even.joinCount, 2);
  assert.equal(even.allSame, true);
  // Joins on short clips store less, so the lengths differ.
  const mixed = [
    makeClip("a", "a.mp4", null, 10),
    makeClip("b", "b.mp4", null, 1),
    makeClip("c", "c.mp4", null, 0.3),
  ];
  const uneven = crossfadeAllStored(mixed, 1);
  assert.deepEqual(uneven.lengths, [1, 0.3]);
  assert.equal(uneven.shortest, 0.3);
  assert.equal(uneven.longest, 1);
  assert.equal(uneven.addedCount, 2);
  assert.equal(uneven.allSame, false);
  // The lengths match what the setter writes on every join.
  const stored = setAllTransitionsIn(mixed, 1);
  assert.deepEqual(uneven.lengths, stored.slice(1).map((c) => c.transitionIn));
  // A join with no room at all stays a straight cut, and does not
  // drag the shortest real dissolve down to 0.
  const gapped = [
    makeClip("a", "a.mp4", null, 10),
    makeClip("b", "b.mp4", null, 10),
    makeClip("c", "c.mp4", null, 0),
    makeClip("d", "d.mp4", null, 10),
  ];
  const partial = crossfadeAllStored(gapped, 1);
  assert.deepEqual(partial.lengths, [1, 0, 0]);
  assert.equal(partial.shortest, 1);
  assert.equal(partial.longest, 1);
  assert.equal(partial.addedCount, 1);
  assert.equal(partial.joinCount, 3);
  assert.equal(partial.allSame, false);
  // No join with room means nothing was added.
  const none = crossfadeAllStored(
    [makeClip("a", "a.mp4", null, 0), makeClip("b", "b.mp4", null, 10)],
    1,
  );
  assert.deepEqual(none.lengths, [0]);
  assert.equal(none.addedCount, 0);
  assert.equal(none.allSame, false);
});

test("splitting a clip leaves a straight cut between the halves", () => {
  const clips = setTransitionIn(threeClips(), "c", 0.5);
  const out = splitClip(clips, "b", 14);
  assert.deepEqual(
    out.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["b", 0],
      ["b-s1", 0],
      ["c", 0.5],
    ],
  );
  // Splitting the clip that holds the dissolve keeps the dissolve
  // on its first half, the new join between the halves is straight.
  const splitFaded = splitClip(setTransitionIn(twoClips(), "b", 0.5), "b", 14);
  assert.deepEqual(
    splitFaded.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["b", 0.5],
      ["b-s1", 0],
    ],
  );
  assert.equal(totalDuration(out), 30);
});

test("cutting out a whole clip takes its joins with it", () => {
  const clips = setTransitionIn(threeClips(), "c", 0.5);
  const cut = setTransitionIn(clips, "b", 0.5);
  // The silence range covers all of clip b, so b goes and c now
  // follows a. Both dissolves are gone.
  const out = cutRange(cut, 10, 20);
  assert.deepEqual(
    out.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["c", 0],
    ],
  );
  // Trimming the end of a clip keeps the dissolve after it.
  const trimmed = cutRange(setTransitionIn(threeClips(), "c", 0.5), 25, 30);
  assert.deepEqual(
    trimmed.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["b", 0],
      ["c", 0.5],
    ],
  );
  // Splitting a clip with a cut keeps the dissolve after it: the
  // second half is still the same clip, just cut in two.
  const split = cutRange(setTransitionIn(threeClips(), "c", 0.5), 13, 15);
  assert.deepEqual(
    split.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["b", 0],
      ["b-s1", 0],
      ["c", 0.5],
    ],
  );
  assert.equal(totalDuration(split), 28);
});

test("deleting a clip takes the joins on both sides with it", () => {
  const clips = setAllTransitionsIn(threeClips(), 0.5);
  const out = deleteClip(clips, "b");
  assert.deepEqual(
    out.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["c", 0],
    ],
  );
  // Deleting the first clip takes the dissolve into the second
  // with it, the one after that stays.
  const first = deleteClip(setAllTransitionsIn(threeClips(), 0.5), "a");
  assert.deepEqual(
    first.map((c) => [c.id, c.transitionIn]),
    [
      ["b", 0],
      ["c", 0.5],
    ],
  );
  // Deleting the last clip leaves the earlier join alone.
  const last = deleteClip(setAllTransitionsIn(threeClips(), 0.5), "c");
  assert.deepEqual(
    last.map((c) => [c.id, c.transitionIn]),
    [
      ["a", 0],
      ["b", 0.5],
    ],
  );
});

test("reordering clips drops the dissolves that no longer join", () => {
  const clips = setAllTransitionsIn(threeClips(), 0.5);
  const moved = moveClip(clips, "c", 0);
  // Moving c to the front takes the dissolve into c with it, but
  // a still sits right before b, so that join keeps its dissolve.
  assert.deepEqual(
    moved.map((c) => [c.id, c.transitionIn]),
    [
      ["c", 0],
      ["a", 0],
      ["b", 0.5],
    ],
  );
  const swapped = moveClip(clips, "a", 1);
  assert.deepEqual(
    swapped.map((c) => [c.id, c.transitionIn]),
    [
      ["b", 0],
      ["a", 0],
      ["c", 0],
    ],
  );
});

test("undo and redo cover a crossfade change", () => {
  const before = {
    clips: threeClips(),
    overlays: [],
    captions: [],
    audioClips: [],
    music: null,
    pips: [],
  };
  let history = makeHistory();
  history = pushHistory(history, snapshotState(before));
  const after = {
    ...before,
    clips: setTransitionIn(before.clips, "b", 0.5),
  };
  assert.equal(canUndo(history), true);
  const undone = undoHistory(history, snapshotState(after));
  assert.deepEqual(
    undone.state.clips.map((c) => c.transitionIn),
    [0, 0, 0],
  );
  // The snapshot itself carries the dissolve, so redo brings it back.
  const snap = snapshotState(after);
  assert.equal(snap.clips[1].transitionIn, 0.5);
});
