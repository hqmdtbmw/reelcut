import test from "node:test";
import assert from "node:assert/strict";
import { buildExportAudio, setExportClipVolume, stopExportAudio } from "../src/exportAudio.js";
import { makeClip } from "../src/timeline.js";

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
  }
  connect(node) {
    this.connectedTo.push(node);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  constructor({ decodeFails = false } = {}) {
    this.decodeFails = decodeFails;
    this.gains = [];
    this.sources = [];
    this.elementSources = [];
    this.dest = { stream: { getAudioTracks: () => [{ kind: "audio" }] } };
    this.resumed = false;
    this.closed = false;
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
    return { duration: 30 };
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
