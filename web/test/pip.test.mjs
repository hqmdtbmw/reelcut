import test from "node:test";
import assert from "node:assert/strict";
import {
  PIP_POSITIONS,
  clampPipClip,
  clampPipVolume,
  makePipClip,
  pipFileOffset,
  pipRect,
  pipVisibleAtTime,
  setPipMuted,
  setPipVolume,
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
  assert.equal(pipFileOffset(pip(2, 10), 14, 10), 2);
});

test("the file offset does not wrap when the file length is unknown", () => {
  assert.equal(pipFileOffset(pip(2, 10), 14), 12);
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
