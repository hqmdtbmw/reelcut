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

test("picture in picture", () => {
  assert.deepEqual(parseCommand("add picture in picture"), { kind: "add-pip" });
  assert.deepEqual(parseCommand("remove the picture in picture"), { kind: "remove-pip" });
  assert.deepEqual(parseCommand("move the picture in picture to the top left"), {
    kind: "move-pip",
    position: "top-left",
  });
  assert.deepEqual(parseCommand("move the picture in picture to the bottom right"), {
    kind: "move-pip",
    position: "bottom-right",
  });
});

test("mute and volume", () => {
  assert.deepEqual(parseCommand("mute it"), { kind: "mute" });
  assert.deepEqual(parseCommand("set volume to 50%"), { kind: "set-volume", volume: 0.5 });
});

test("mute and volume on one clip", () => {
  assert.deepEqual(parseCommand("mute this clip", { selectedIndex: 1 }), { kind: "mute-clip", index: 1 });
  assert.deepEqual(parseCommand("mute the selected clip", { selectedIndex: 0 }), { kind: "mute-clip", index: 0 });
  assert.deepEqual(parseCommand("mute clip 2"), { kind: "mute-clip", index: 1 });
  assert.deepEqual(parseCommand("unmute this clip", { selectedIndex: 1 }), { kind: "unmute-clip", index: 1 });
  assert.deepEqual(parseCommand("unmute clip 2"), { kind: "unmute-clip", index: 1 });
  assert.deepEqual(parseCommand("unmute it", { selectedIndex: 0 }), { kind: "unmute-clip", index: 0 });
  assert.deepEqual(parseCommand("set the volume to 50%", { selectedIndex: 1 }), {
    kind: "set-clip-volume",
    volume: 0.5,
    index: 1,
  });
  assert.deepEqual(parseCommand("set clip 2 volume to 25%"), { kind: "set-clip-volume", volume: 0.25, index: 1 });
  assert.deepEqual(parseCommand("set this clip's volume to 75%", { selectedIndex: 0 }), {
    kind: "set-clip-volume",
    volume: 0.75,
    index: 0,
  });
  assert.deepEqual(parseCommand("turn the volume down", { selectedIndex: 1 }), {
    kind: "adjust-clip-volume",
    delta: -0.25,
    index: 1,
  });
  assert.deepEqual(parseCommand("turn the volume up", { selectedIndex: 0 }), {
    kind: "adjust-clip-volume",
    delta: 0.25,
    index: 0,
  });
  assert.deepEqual(parseCommand("turn the volume down 20%", { selectedIndex: 0 }), {
    kind: "adjust-clip-volume",
    delta: -0.2,
    index: 0,
  });
  // With nothing selected, a per-clip command says so with index -1.
  assert.deepEqual(parseCommand("mute this clip"), { kind: "mute-clip", index: -1 });
  assert.deepEqual(parseCommand("turn the volume down"), { kind: "adjust-clip-volume", delta: -0.25, index: -1 });
});

test("fades", () => {
  assert.deepEqual(parseCommand("add a fade of 1 second"), { kind: "fade-all", seconds: 1 });
  assert.deepEqual(parseCommand("add fades"), { kind: "fade-all", seconds: 0.5 });
});

test("cut the boring parts", () => {
  assert.deepEqual(parseCommand("cut the boring parts"), { kind: "cut-boring-parts" });
  assert.deepEqual(parseCommand("remove the boring bits"), { kind: "cut-boring-parts" });
  assert.deepEqual(parseCommand("cut out the dead air"), { kind: "cut-boring-parts" });
  assert.deepEqual(parseCommand("tighten it up"), { kind: "cut-boring-parts" });
});

test("music commands", () => {
  assert.deepEqual(parseCommand("add music"), { kind: "add-music" });
  assert.deepEqual(parseCommand("add a song"), { kind: "add-music" });
  assert.deepEqual(parseCommand("remove the music"), { kind: "remove-music" });
  assert.deepEqual(parseCommand("take the music out"), { kind: "remove-music" });
  assert.deepEqual(parseCommand("music volume 50%"), { kind: "set-music-volume", volume: 0.5 });
  assert.deepEqual(parseCommand("set music volume to 25"), { kind: "set-music-volume", volume: 0.25 });
  assert.deepEqual(parseCommand("turn the music down"), { kind: "set-music-volume", volume: 0.25 });
  assert.deepEqual(parseCommand("turn the music up"), { kind: "set-music-volume", volume: 0.75 });
});

test("colour commands", () => {
  assert.deepEqual(parseCommand("make it brighter"), {
    kind: "set-effect",
    effect: "brightness",
    mode: "delta",
    value: 20,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("make it brighter 30%"), {
    kind: "set-effect",
    effect: "brightness",
    mode: "delta",
    value: 30,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("more contrast"), {
    kind: "set-effect",
    effect: "contrast",
    mode: "delta",
    value: 20,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("turn the saturation down"), {
    kind: "set-effect",
    effect: "saturation",
    mode: "delta",
    value: -20,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("make it darker"), {
    kind: "set-effect",
    effect: "brightness",
    mode: "delta",
    value: -20,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("set brightness to 150%"), {
    kind: "set-effect",
    effect: "brightness",
    mode: "set",
    value: 150,
    scope: "selected",
  });
  assert.deepEqual(parseCommand("make it brighter, all clips"), {
    kind: "set-effect",
    effect: "brightness",
    mode: "delta",
    value: 20,
    scope: "all",
  });
  assert.deepEqual(parseCommand("reset the colours"), { kind: "reset-effects", scope: "selected" });
  assert.deepEqual(parseCommand("reset the colours on all clips"), { kind: "reset-effects", scope: "all" });
});

test("unknown commands stay unknown", () => {
  const parsed = parseCommand("do something magical");
  assert.equal(parsed.kind, "unknown");
});

test("audio track commands", () => {
  assert.deepEqual(parseCommand("mute the audio track"), { kind: "mute-audio-track" });
  assert.deepEqual(parseCommand("unmute the audio track"), { kind: "unmute-audio-track" });
  assert.deepEqual(parseCommand("set the audio track volume to 50%"), {
    kind: "set-audio-track-volume",
    volume: 0.5,
  });
  assert.deepEqual(parseCommand("set the audio track volume to 25 percent"), {
    kind: "set-audio-track-volume",
    volume: 0.25,
  });
  assert.deepEqual(parseCommand("remove the audio track"), { kind: "remove-audio-track" });
  assert.deepEqual(parseCommand("delete the audio track"), { kind: "remove-audio-track" });
});

test("audio track commands do not read as clip commands", () => {
  assert.notEqual(parseCommand("mute the audio track").kind, "mute");
  assert.notEqual(parseCommand("mute the audio track").kind, "mute-clip");
  assert.notEqual(parseCommand("set the audio track volume to 50%").kind, "set-volume");
});
