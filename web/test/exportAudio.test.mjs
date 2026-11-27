import test from "node:test";
import assert from "node:assert/strict";
import { buildExportAudio, setExportClipVolume, stopExportAudio } from "../src/exportAudio.js";
import { makeClip } from "../src/timeline.js";
import { makePipClip } from "../src/pip.js";

// A small stand-in for the browser AudioContext. It records what
// connects to what, so the tests can check the mix is wired right
// without a real browser.
class FakeGain {
  constructor() {
    this.gain = { value: 1 };
    this.connectedTo = [];
  }
  connect(node) {
    this.connectedTo.push(node);
  }
}

class FakeSource {
  constructor() {
    this.connectedTo = [];
    this.started = false;
    this.stopped = false;
    this.buffer = null;
    this.loop = false;
    this.startWhen = null;
    this.startOffset = null;
    this.stopWhen = null;
    this.rateChanges = [];
    this.playbackRate = {
      value: 1,
      setValueAtTime: (rate, when) => {
        this.rateChanges.push([rate, when]);
      },
    };
  }
  connect(node) {
    this.connectedTo.push(node);
  }
  start(when, offset) {
    this.started = true;
    this.startWhen = when ?? null;
    this.startOffset = offset ?? null;
  }
  stop(when) {
    this.stopped = true;
    this.stopWhen = when ?? null;
  }
}

class FakeAudioContext {
  constructor({ decodeFails = false, decodedDuration = 30 } = {}) {
    this.decodeFails = decodeFails;
    this.decodedDuration = decodedDuration;
    this.gains = [];
    this.sources = [];
    this.elementSources = [];
    this.dest = { stream: { getAudioTracks: () => [{ kind: "audio" }] } };
    this.resumed = false;
    this.closed = false;
    this.currentTime = 0;
  }
  async resume() {
    this.resumed = true;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource(video) {
    const source = new FakeSource();
    source.video = video;
    this.elementSources.push(source);
    return source;
  }
  createMediaStreamDestination() {
    return this.dest;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    if (this.decodeFails) throw new Error("bad file");
    return { duration: this.decodedDuration };
  }
  async close() {
    this.closed = true;
  }
}

function fakeMusic(volume = 0.5) {
  return {
    name: "song.mp3",
    volume,
    file: { arrayBuffer: async () => new ArrayBuffer(4) },
  };
}

function fakeAudioClip({ start = 5, duration = 10, volume = 0.8, muted = false, unreadable = false, sourceIn = 0 } = {}) {
  return {
    id: "a1",
    name: "voice.mp3",
    url: null,
    start,
    duration,
    volume,
    muted,
    sourceIn,
    file: {
      arrayBuffer: async () => {
        if (unreadable) throw new Error("bad file");
        return new ArrayBuffer(4);
      },
    },
  };
}

function fakePip({ start = 2, duration = 4, volume = 0.9, muted = false, unreadable = false } = {}) {
  const clip = makePipClip("pip-1", "facecam.mp4", null, start, duration, "bottom-right", "medium", 30);
  clip.volume = volume;
  clip.muted = muted;
  clip.file = {
    arrayBuffer: async () => {
      if (unreadable) throw new Error("bad file");
      return new ArrayBuffer(4);
    },
  };
  return clip;
}

test("export audio carries the clip sound even with no music", async () => {
  const ctx = new FakeAudioContext();
  const video = { tagName: "VIDEO" };
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.volume = 0.5;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video,
    music: null,
    firstClip: clip,
  });
  assert.equal(ctx.resumed, true);
  assert.equal(mix.musicSource, null);
  assert.equal(mix.track.kind, "audio");
  // The clip gain starts at the clip's volume and feeds the mix.
  assert.equal(mix.clipGain.gain.value, 0.5);
  assert.deepEqual(ctx.elementSources[0].connectedTo, [mix.clipGain]);
  assert.deepEqual(mix.clipGain.connectedTo, [ctx.dest]);
  assert.equal(ctx.sources.length, 0);
});

test("a muted clip exports silence", async () => {
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.volume = 0.8;
  clip.muted = true;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: clip,
  });
  assert.equal(mix.clipGain.gain.value, 0);
});

test("music mixes in beside the clip audio", async () => {
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.volume = 0.7;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: clip,
  });
  assert.equal(mix.clipGain.gain.value, 0.7);
  assert.equal(ctx.sources.length, 1);
  const musicSource = ctx.sources[0];
  assert.equal(musicSource.started, true);
  assert.equal(musicSource.loop, true);
  // The music gain sits at the music volume and feeds the same mix.
  const musicGain = ctx.gains[1];
  assert.equal(musicGain.gain.value, 0.5);
  assert.deepEqual(musicSource.connectedTo, [musicGain]);
  assert.deepEqual(musicGain.connectedTo, [ctx.dest]);
  assert.equal(mix.musicSource, musicSource);
});

test("an unreadable music file leaves the clip audio alone", async () => {
  const ctx = new FakeAudioContext({ decodeFails: true });
  const clip = makeClip("a", "a.mp4", null, 10);
  clip.volume = 0.6;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: clip,
  });
  assert.equal(mix.musicSource, null);
  assert.equal(mix.clipGain.gain.value, 0.6);
  assert.equal(mix.track.kind, "audio");
});

test("the clip gain follows each clip as the export plays", async () => {
  const ctx = new FakeAudioContext();
  const first = makeClip("a", "a.mp4", null, 10);
  first.volume = 0.5;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: first,
  });
  const muted = makeClip("b", "b.mp4", null, 6);
  muted.volume = 0.9;
  muted.muted = true;
  setExportClipVolume(mix, muted);
  assert.equal(mix.clipGain.gain.value, 0);
  const quiet = makeClip("c", "c.mp4", null, 6);
  quiet.volume = 0.3;
  setExportClipVolume(mix, quiet);
  assert.equal(mix.clipGain.gain.value, 0.3);
  // Nothing breaks when there is no mix at all.
  setExportClipVolume(null, quiet);
});

test("stopping the export stops the music and closes the context", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
  });
  stopExportAudio(mix);
  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(ctx.closed, true);
  // Stopping twice, or with no mix, is fine.
  stopExportAudio(mix);
  stopExportAudio(null);
});

test("an audio clip mixes in at its place on the timeline", async () => {
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: clip,
    audioClips: [fakeAudioClip({ start: 5, duration: 10, volume: 0.8 })],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.started, true);
  assert.equal(source.loop, false);
  // It starts 5 seconds into the export, from the start of its file.
  assert.equal(source.startWhen, 5);
  assert.equal(source.startOffset, 0);
  // Its gain sits at the clip volume and feeds the same mix.
  const gain = ctx.gains[1];
  assert.equal(gain.gain.value, 0.8);
  assert.deepEqual(source.connectedTo, [gain]);
  assert.deepEqual(gain.connectedTo, [ctx.dest]);
  assert.deepEqual(mix.audioSources, [source]);
});

test("an audio clip trimmed from the left starts partway through its file", async () => {
  // A 10 second clip starting 3 seconds into a 30 second file
  // resumes at 3 seconds in, and it does not loop, since 3 plus 10
  // still fits inside the file.
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: clip,
    audioClips: [fakeAudioClip({ start: 5, duration: 10, volume: 0.8, sourceIn: 3 })],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.startWhen, 5);
  assert.equal(source.startOffset, 3);
  assert.equal(source.loop, false);
  assert.equal(mix.audioSources[0], source);
});

test("an audio clip starting near the end of its file wraps and loops", async () => {
  // The same clip starting 25 seconds into a 30 second file has
  // only 5 seconds left before it wraps, so it loops to play 10.
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: clip,
    audioClips: [fakeAudioClip({ start: 5, duration: 10, volume: 0.8, sourceIn: 25 })],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.startOffset, 25);
  assert.equal(source.loop, true);
  assert.equal(mix.audioSources[0], source);
});

test("a muted audio clip exports silence", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip({ volume: 0.8, muted: true })],
  });
  assert.equal(ctx.gains[1].gain.value, 0);
  assert.equal(mix.audioSources.length, 1);
});

test("audio clips mix in beside the music", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip({ start: 2, duration: 4, volume: 0.6 })],
  });
  assert.equal(mix.musicSource, ctx.sources[0]);
  assert.equal(mix.audioSources[0], ctx.sources[1]);
  assert.equal(ctx.gains[2].gain.value, 0.6);
  assert.deepEqual(ctx.gains[2].connectedTo, [ctx.dest]);
});

test("an unreadable audio clip leaves the music and the rest alone", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [
      fakeAudioClip({ start: 0, duration: 3, unreadable: true }),
      fakeAudioClip({ start: 4, duration: 3, volume: 0.7 }),
    ],
  });
  assert.equal(mix.musicSource, ctx.sources[0]);
  assert.equal(mix.audioSources.length, 1);
  assert.equal(mix.audioSources[0], ctx.sources[1]);
  assert.equal(mix.audioSources[0].startWhen, 4);
  assert.equal(mix.track.kind, "audio");
});

test("stopping the export stops the audio clips too", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip()],
  });
  stopExportAudio(mix);
  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(ctx.sources[1].stopped, true);
  assert.equal(ctx.closed, true);
});

test("an audio clip exports at the speed of the video under it", async () => {
  const ctx = new FakeAudioContext();
  const fast = makeClip("a", "a.mp4", null, 10);
  fast.speed = 2;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: fast,
    audioClips: [fakeAudioClip({ start: 1, duration: 2, volume: 0.8 })],
    clips: [fast],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.playbackRate.value, 2);
  assert.deepEqual(source.rateChanges, []);
  assert.equal(source.startWhen, 1);
  assert.equal(mix.audioSources[0], source);
});

test("an audio clip changes rate as the export crosses into the next clip", async () => {
  const ctx = new FakeAudioContext();
  const fast = makeClip("a", "a.mp4", null, 10);
  fast.speed = 2;
  const slow = makeClip("b", "b.mp4", null, 10);
  slow.speed = 0.5;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: fast,
    audioClips: [fakeAudioClip({ start: 2, duration: 10, volume: 0.8 })],
    clips: [fast, slow],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  // It starts at 2x under the fast clip, then drops to 0.5x when the
  // slow clip starts 5 seconds into the export.
  assert.equal(source.playbackRate.value, 2);
  assert.deepEqual(source.rateChanges, [[0.5, 5]]);
  assert.equal(source.startWhen, 2);
  assert.equal(mix.audioSources[0], source);
});

test("an audio clip exports at normal speed when no video clips are given", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip({ start: 2, duration: 4, volume: 0.6 })],
  });
  assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.sources[0].playbackRate.value, 1);
  assert.deepEqual(ctx.sources[0].rateChanges, []);
  assert.equal(mix.audioSources[0], ctx.sources[0]);
});

// Looping audio: a short clip over a sped up stretch needs more of
// its file than the file holds, so it has to play over from the top
// instead of going quiet halfway through its slot.

test("an audio clip loops when its file runs out over a sped-up stretch", async () => {
  // A 5 second clip at 2x needs 10 file seconds, but the file is
  // only 5 seconds long, so it plays twice to fill its slot.
  const ctx = new FakeAudioContext({ decodedDuration: 5 });
  const fast = makeClip("a", "a.mp4", null, 10);
  fast.speed = 2;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: fast,
    audioClips: [fakeAudioClip({ start: 1, duration: 5, volume: 0.8 })],
    clips: [fast],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.playbackRate.value, 2);
  assert.equal(source.startWhen, 1);
  // It stops at the end of its slot, not when the loop runs out.
  assert.equal(source.stopWhen, 6);
  assert.equal(mix.audioSources[0], source);
});

test("an audio clip that fits stops at the end of its slot", async () => {
  // A 10 second clip at normal speed needs 10 file seconds out of
  // a 30 second file, so it does not loop, but it still stops at
  // the end of its slot instead of playing the rest of the file.
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip({ start: 5, duration: 10, volume: 0.8 })],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.loop, false);
  assert.equal(source.startWhen, 5);
  assert.equal(source.stopWhen, 15);
  assert.equal(mix.audioSources[0], source);
});

// The picture in picture overlay: its sound used to be left out
// of the export entirely, so the overlay played silent.

test("the picture in picture sound mixes into the export", async () => {
  const ctx = new FakeAudioContext();
  const clip = makeClip("a", "a.mp4", null, 10);
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: clip,
    pip: fakePip({ start: 2, duration: 4, volume: 0.9 }),
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.started, true);
  assert.equal(source.loop, false);
  // It starts 2 seconds into the export, from the start of its file.
  assert.equal(source.startWhen, 2);
  assert.equal(source.startOffset, 0);
  assert.equal(source.stopWhen, 6);
  // Its gain sits at the overlay volume and feeds the same mix.
  const gain = ctx.gains[1];
  assert.equal(gain.gain.value, 0.9);
  assert.deepEqual(source.connectedTo, [gain]);
  assert.deepEqual(gain.connectedTo, [ctx.dest]);
  assert.equal(mix.pipSource, source);
});

test("a muted overlay exports silence", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: makeClip("a", "a.mp4", null, 10),
    pip: fakePip({ volume: 0.9, muted: true }),
  });
  assert.equal(ctx.gains[1].gain.value, 0);
  assert.equal(mix.pipSource, ctx.sources[0]);
});

test("the overlay plays at the speed of the video under it", async () => {
  const ctx = new FakeAudioContext();
  const fast = makeClip("a", "a.mp4", null, 10);
  fast.speed = 2;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: fast,
    pip: fakePip({ start: 1, duration: 2, volume: 0.8 }),
    clips: [fast],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.playbackRate.value, 2);
  assert.deepEqual(source.rateChanges, []);
  assert.equal(source.startWhen, 1);
  assert.equal(mix.pipSource, source);
});

test("the overlay loops when its file runs out over a sped-up stretch", async () => {
  // A 5 second overlay at 2x needs 10 file seconds, but the file
  // is only 5 seconds long, so it plays twice to fill its slot.
  const ctx = new FakeAudioContext({ decodedDuration: 5 });
  const fast = makeClip("a", "a.mp4", null, 10);
  fast.speed = 2;
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: null,
    firstClip: fast,
    pip: fakePip({ start: 1, duration: 5, volume: 0.8 }),
    clips: [fast],
  });
  assert.equal(ctx.sources.length, 1);
  const source = ctx.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.playbackRate.value, 2);
  assert.equal(source.startWhen, 1);
  assert.equal(source.stopWhen, 6);
  assert.equal(mix.pipSource, source);
});

test("an unreadable overlay file leaves the music and the rest alone", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
    pip: fakePip({ unreadable: true }),
  });
  assert.equal(mix.pipSource, null);
  assert.equal(mix.musicSource, ctx.sources[0]);
  assert.equal(mix.track.kind, "audio");
});

test("stopping the export stops the overlay sound too", async () => {
  const ctx = new FakeAudioContext();
  const mix = await buildExportAudio({
    createAudioContext: () => ctx,
    video: {},
    music: fakeMusic(0.5),
    firstClip: makeClip("a", "a.mp4", null, 10),
    audioClips: [fakeAudioClip()],
    pip: fakePip(),
  });
  stopExportAudio(mix);
  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(ctx.sources[1].stopped, true);
  assert.equal(ctx.sources[2].stopped, true);
  assert.equal(ctx.closed, true);
});
