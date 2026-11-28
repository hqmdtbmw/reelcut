import test from "node:test";
import assert from "node:assert/strict";
import {
  PIP_POSITIONS,
  addPipClip,
  clampPipClip,
  clampPipVolume,
  cutdownPips,
  makePipClip,
  pipClipSourceIn,
  pipFileOffset,
  pipRateSegments,
  pipRect,
  pipVisibleAtTime,
  pipsFromState,
  removePipClip,
  setPipClipVolume,
  setPipMuted,
  setPipVolume,
  shiftPips,
  togglePipClipMuted,
  updatePipClip,
  visiblePipsAtTime,
} from "../src/pip.js";

function pip(start = 2, duration = 4, position = "bottom-right", size = "medium") {
  return makePipClip("pip-1", "facecam.mp4", null, start, duration, position, size, 10);
}

test("a new overlay clip defaults to bottom right and medium", () => {
  const clip = makePipClip("pip-1", "facecam.mp4", null, 2, 4);
  assert.equal(clip.position, "bottom-right");
  assert.equal(clip.size, "medium");
  assert.equal(clip.start, 2);
  assert.equal(clip.duration, 4);
});

test("a bad corner or size falls back to the defaults", () => {
  const clip = makePipClip("pip-1", "facecam.mp4", null, 2, 4, "middle", "huge");
  assert.equal(clip.position, "bottom-right");
  assert.equal(clip.size, "medium");
});

test("clamping keeps the overlay inside the edit", () => {
  const clip = clampPipClip(pip(28, 10), 30);
  assert.equal(clip.start, 28);
  assert.equal(clip.duration, 2);
});

test("clamping pulls a start past the end back into the edit", () => {
  const clip = clampPipClip(pip(40, 4), 30);
  assert.equal(clip.start, 29.5);
  assert.equal(clip.duration, 0.5);
});

test("clamping fixes a bad corner or size", () => {
  const clip = clampPipClip({ ...pip(), position: "centre", size: "tiny" }, 30);
  assert.equal(clip.position, "bottom-right");
  assert.equal(clip.size, "medium");
});

test("visibility starts at the start and stops at the end", () => {
  const clip = pip(2, 4);
  assert.equal(pipVisibleAtTime(clip, 1.9), false);
  assert.equal(pipVisibleAtTime(clip, 2), true);
  assert.equal(pipVisibleAtTime(clip, 5.9), true);
  assert.equal(pipVisibleAtTime(clip, 6), false);
  assert.equal(pipVisibleAtTime(null, 3), false);
});

test("the rectangle hugs the right corner by default", () => {
  const rect = pipRect(pip(), 1920, 1080);
  assert.equal(rect.width, Math.round(1920 * 0.33));
  assert.equal(rect.height, Math.round((rect.width * 9) / 16));
  assert.equal(rect.x + rect.width, 1920 - Math.round(1920 * 0.02));
  assert.equal(rect.y + rect.height, 1080 - Math.round(1920 * 0.02));
});

test("each corner puts the rectangle in the right place", () => {
  const margin = Math.round(1920 * 0.02);
  for (const position of PIP_POSITIONS) {
    const rect = pipRect(pip(2, 4, position), 1920, 1080);
    if (position.endsWith("right")) {
      assert.equal(rect.x + rect.width, 1920 - margin);
    } else {
      assert.equal(rect.x, margin);
    }
    if (position.startsWith("top")) {
      assert.equal(rect.y, margin);
    } else {
      assert.equal(rect.y + rect.height, 1080 - margin);
    }
  }
});

test("the rectangle stays inside the frame at every size", () => {
  for (const size of ["small", "medium", "large"]) {
    for (const position of PIP_POSITIONS) {
      const rect = pipRect(pip(2, 4, position, size), 1920, 1080);
      assert.ok(rect.x >= 0 && rect.y >= 0, `${position} ${size} starts inside`);
      assert.ok(rect.x + rect.width <= 1920, `${position} ${size} ends inside`);
      assert.ok(rect.y + rect.height <= 1080, `${position} ${size} ends inside`);
    }
  }
});

test("small is narrower than medium, medium narrower than large", () => {
  const small = pipRect(pip(2, 4, "bottom-right", "small"), 1920, 1080);
  const medium = pipRect(pip(2, 4, "bottom-right", "medium"), 1920, 1080);
  const large = pipRect(pip(2, 4, "bottom-right", "large"), 1920, 1080);
  assert.ok(small.width < medium.width);
  assert.ok(medium.width < large.width);
});

test("the file offset counts from the overlay start", () => {
  assert.equal(pipFileOffset(pip(2, 4), 5, 10), 3);
  assert.equal(pipFileOffset(pip(2, 4), 1, 10), 0);
});

test("the file offset wraps when the overlay loops", () => {
  // A 12 second overlay on a 10 second file: 11 seconds in, the
  // file has wrapped and is 1 second into its second play.
  assert.equal(pipFileOffset(pip(2, 12), 13, 10), 1);
});

test("the file offset stops at the end of the overlay", () => {
  assert.equal(pipFileOffset(pip(2, 10), 14, 10), 0);
});

test("the file offset does not wrap when the file length is unknown", () => {
  assert.equal(pipFileOffset(pip(2, 10), 14), 10);
});

test("a new overlay clip starts at its source offset", () => {
  const clip = makePipClip("pip-1", "facecam.mp4", null, 2, 4, "bottom-right", "medium", 10, 3);
  assert.equal(clip.sourceIn, 3);
  assert.equal(makePipClip("pip-1", "facecam.mp4", null, 2, 4).sourceIn, 0);
});

test("an old overlay without a source offset counts as starting at zero", () => {
  const old = pip(2, 4);
  delete old.sourceIn;
  assert.equal(pipClipSourceIn(old), 0);
  assert.equal(pipClipSourceIn(null), 0);
  assert.equal(pipClipSourceIn({ ...pip(), sourceIn: -2 }), 0);
  assert.equal(pipFileOffset(old, 5, 10), 3);
  assert.equal(clampPipClip(old, 30).sourceIn, 0);
});

test("the file offset starts at the source offset", () => {
  const clip = { ...pip(2, 4), sourceIn: 3 };
  assert.equal(pipFileOffset(clip, 2, 10), 3);
  assert.equal(pipFileOffset(clip, 5, 10), 6);
  assert.equal(pipFileOffset(clip, 1, 10), 3);
});

test("the file offset wraps from the source offset when the overlay loops", () => {
  // A 10 second file, the overlay starts 8 seconds in and runs
  // 5 timeline seconds: it plays 8 to 10, wraps, and ends 3
  // seconds into its second play.
  const clip = { ...pip(2, 5), sourceIn: 8 };
  assert.equal(pipFileOffset(clip, 7, 10), 3);
});

test("the file offset counts a sped up stretch at its speed", () => {
  const fast = { sourceIn: 0, sourceOut: 10, speed: 2 };
  assert.equal(pipFileOffset(pip(2, 4), 5, 10, [fast]), 6);
  assert.equal(pipFileOffset({ ...pip(2, 4), sourceIn: 1 }, 5, 10, [fast]), 7);
  assert.equal(pipFileOffset(pip(2, 4), 5, 10), 3);
});

test("the rate segments follow the video clip under each stretch", () => {
  const fast = { sourceIn: 0, sourceOut: 10, speed: 2 };
  const normal = { sourceIn: 0, sourceOut: 5, speed: 1 };
  assert.deepEqual(pipRateSegments(pip(2, 4), [fast, normal]), [
    { start: 2, end: 5, rate: 2 },
    { start: 5, end: 6, rate: 1 },
  ]);
  assert.deepEqual(pipRateSegments(pip(2, 4), []), [{ start: 2, end: 6, rate: 1 }]);
});

test("a new overlay clip is full volume and unmuted", () => {
  const clip = makePipClip("pip-1", "facecam.mp4", null, 2, 4);
  assert.equal(clip.volume, 1);
  assert.equal(clip.muted, false);
});

test("setting the overlay volume clamps it to the 0 to 1 range", () => {
  assert.equal(setPipVolume(pip(), 0.5).volume, 0.5);
  assert.equal(setPipVolume(pip(), 2).volume, 1);
  assert.equal(setPipVolume(pip(), -1).volume, 0);
  assert.equal(setPipVolume(pip(), "loud").volume, 1);
});

test("turning the overlay volume up unmutes it, turning it to zero keeps the mute flag", () => {
  const muted = { ...pip(), volume: 0.6, muted: true };
  const turnedUp = setPipVolume(muted, 0.5);
  assert.equal(turnedUp.muted, false);
  assert.equal(turnedUp.volume, 0.5);
  const turnedDown = setPipVolume(pip(), 0);
  assert.equal(turnedDown.volume, 0);
  assert.equal(turnedDown.muted, false);
});

test("muting the overlay keeps its volume for later", () => {
  const muted = setPipMuted(pip(), true);
  assert.equal(muted.muted, true);
  assert.equal(muted.volume, 1);
  assert.equal(setPipMuted(muted, false).muted, false);
  assert.equal(setPipMuted(pip()).muted, true);
});

test("clamping fills in volume and mute on an overlay saved before they existed", () => {
  const old = pip();
  delete old.volume;
  delete old.muted;
  const fixed = clampPipClip(old, 30);
  assert.equal(fixed.volume, 1);
  assert.equal(fixed.muted, false);
  assert.equal(clampPipVolume(2), 1);
  assert.equal(clampPipVolume(-1), 0);
  assert.equal(clampPipVolume("loud"), 1);
  assert.equal(clampPipClip({ ...pip(), volume: 2, muted: "yes" }, 30).volume, 1);
  assert.equal(clampPipClip({ ...pip(), volume: 2, muted: "yes" }, 30).muted, true);
});

// More than one overlay at a time.

test("adding a second overlay keeps the first one", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  const list = addPipClip(addPipClip([], first), second);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "pip-1");
  assert.equal(list[1].id, "pip-2");
  assert.equal(list[1].position, "top-left");
});

test("removing one overlay leaves the rest alone", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  const list = removePipClip([first, second], "pip-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "pip-2");
  assert.deepEqual(removePipClip([first], "pip-9"), [first]);
});

test("updating one overlay leaves the rest alone", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  const list = updatePipClip([first, second], "pip-2", { position: "bottom-left", size: "large" });
  assert.equal(list[0].position, "bottom-right");
  assert.equal(list[1].position, "bottom-left");
  assert.equal(list[1].size, "large");
});

test("setting one overlay volume unmutes it, the others keep theirs", () => {
  const first = { ...pip(2, 4), muted: true, volume: 0.6 };
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  const list = setPipClipVolume([first, second], "pip-1", 0.5);
  assert.equal(list[0].volume, 0.5);
  assert.equal(list[0].muted, false);
  assert.equal(list[1].volume, 1);
  assert.equal(list[1].muted, false);
});

test("muting one overlay keeps its volume and leaves the other alone", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  const list = togglePipClipMuted([first, second], "pip-2");
  assert.equal(list[0].muted, false);
  assert.equal(list[1].muted, true);
  assert.equal(list[1].volume, 1);
  const back = togglePipClipMuted(list, "pip-2");
  assert.equal(back[1].muted, false);
});

test("only the overlays on screen at a time count as visible", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 3, "top-left", "small", 10);
  assert.deepEqual(visiblePipsAtTime([first, second], 3).map((c) => c.id), ["pip-1"]);
  assert.deepEqual(visiblePipsAtTime([first, second], 9).map((c) => c.id), ["pip-2"]);
  assert.deepEqual(visiblePipsAtTime([first, second], 7), []);
  assert.deepEqual(visiblePipsAtTime([], 3), []);
});

test("a cutdown drops overlays past the end and trims a straddler", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 5, "top-left", "small", 10);
  const third = makePipClip("pip-3", "third.mp4", null, 15, 3, "top-right", "small", 10);
  const list = cutdownPips([first, second, third], 10);
  assert.equal(list.length, 2);
  assert.equal(list[0].duration, 4);
  assert.equal(list[1].duration, 2);
  assert.equal(list[1].start, 8);
});

// Moving the overlays with the cuts.

test("an overlay fully inside a removed range goes away", () => {
  const list = shiftPips([pip(5, 2)], [{ start: 4, end: 8 }]);
  assert.deepEqual(list, []);
});

test("an overlay straddling a cut is trimmed to what is left", () => {
  const list = shiftPips([pip(2, 6)], [{ start: 4, end: 6 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 2);
  assert.equal(list[0].duration, 4);
  assert.equal(list[0].position, "bottom-right");
});

test("an overlay starting inside a cut loses its left end", () => {
  const list = shiftPips([pip(5, 4)], [{ start: 4, end: 7 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 4);
  assert.equal(list[0].duration, 2);
});

test("a cut that trims the left of an overlay moves its source offset", () => {
  const list = shiftPips([pip(5, 4)], [{ start: 4, end: 7 }]);
  assert.equal(list[0].sourceIn, 2);
  // The offset counts from where the overlay already was, so a
  // second cut keeps moving it forward instead of starting over.
  const again = shiftPips(list, [{ start: 2, end: 5 }]);
  assert.equal(again[0].start, 2);
  assert.equal(again[0].duration, 1);
  assert.equal(again[0].sourceIn, 3);
});

test("a trimmed bit under a sped up clip counts double", () => {
  const fast = { sourceIn: 0, sourceOut: 20, speed: 2 };
  const list = shiftPips([pip(5, 4)], [{ start: 4, end: 7 }], [fast]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 4);
  assert.equal(list[0].duration, 2);
  assert.equal(list[0].sourceIn, 4);
});

test("an overlay straddling a cut keeps its source offset", () => {
  const list = shiftPips([pip(2, 6)], [{ start: 4, end: 6 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 2);
  assert.equal(list[0].duration, 4);
  assert.equal(list[0].sourceIn, 0);
});

test("an overlay before a cut keeps its source offset", () => {
  const clip = { ...pip(1, 2), sourceIn: 3 };
  const list = shiftPips([clip], [{ start: 4, end: 6 }]);
  assert.equal(list[0].start, 1);
  assert.equal(list[0].duration, 2);
  assert.equal(list[0].sourceIn, 3);
});

test("an old overlay without a source offset still moves with the cuts", () => {
  const old = pip(5, 4);
  delete old.sourceIn;
  const list = shiftPips([old], [{ start: 4, end: 7 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 4);
  assert.equal(list[0].duration, 2);
  assert.equal(list[0].sourceIn, 2);
});

test("an overlay after a cut shifts earlier by the cut time", () => {
  const list = shiftPips([pip(10, 3)], [{ start: 4, end: 6 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 8);
  assert.equal(list[0].duration, 3);
});

test("an overlay before a cut does not move", () => {
  const clip = pip(1, 2);
  const list = shiftPips([clip], [{ start: 4, end: 6 }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, 1);
  assert.equal(list[0].duration, 2);
});

test("several overlays move through several cuts at once", () => {
  const first = pip(1, 2);
  const second = makePipClip("pip-2", "other.mp4", null, 5, 2, "top-left", "small", 10);
  const third = makePipClip("pip-3", "third.mp4", null, 10, 4, "top-right", "small", 10);
  const list = shiftPips([first, second, third], [
    { start: 4, end: 6 },
    { start: 9, end: 11 },
  ]);
  assert.equal(list.length, 3);
  assert.equal(list[0].id, "pip-1");
  assert.equal(list[0].start, 1);
  assert.equal(list[1].id, "pip-2");
  assert.equal(list[1].start, 4);
  assert.equal(list[1].duration, 1);
  assert.equal(list[2].id, "pip-3");
  assert.equal(list[2].start, 7);
  assert.equal(list[2].duration, 3);
});

test("with no cuts the overlays come back as they were", () => {
  const clip = pip(2, 4);
  assert.deepEqual(shiftPips([clip], []), [clip]);
  assert.deepEqual(shiftPips([clip]), [clip]);
});

test("a cutdown still works after the overlays moved with a cut", () => {
  const first = pip(2, 4);
  const second = makePipClip("pip-2", "other.mp4", null, 8, 5, "top-left", "small", 10);
  const moved = shiftPips([first, second], [{ start: 3, end: 5 }]);
  assert.equal(moved[0].duration, 2);
  assert.equal(moved[1].start, 6);
  const cut = cutdownPips(moved, 8);
  assert.equal(cut.length, 2);
  assert.equal(cut[1].duration, 2);
});

test("a saved single overlay migrates into a one-item list", () => {
  const single = pip(2, 4);
  assert.deepEqual(pipsFromState({ pip: single }), [single]);
  assert.deepEqual(pipsFromState({ pips: [single] }), [single]);
  assert.deepEqual(pipsFromState({}), []);
  assert.deepEqual(pipsFromState(null), []);
  const migrated = pipsFromState({ pip: single });
  migrated[0].position = "top-left";
  assert.equal(single.position, "bottom-right");
});
