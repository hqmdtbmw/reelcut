import { audioRateSegments, clampMusicVolume, effectiveVolume } from "./timeline.js";

// The export draws video frames to a canvas and records them, but
// the canvas has no sound of its own. This builds the audio side:
// the export video element plays each clip, its sound runs through
// a gain node that follows the clip's volume and mute, the audio
// track mixes in beside it, and the background music, when there
// is any, mixes in on its own gain. All of them feed one
// destination, whose track goes on the export stream.
//
// An audio clip starts at its place on the timeline, since the
// export plays in real time from zero, and it plays from the start
// of its file. A clip that would not decode is left out, losing
// one clip is better than losing everything.
//
// It works with or without music. Before this, the no-music path
// grabbed audio from a preview element that never played, so those
// exports came out silent.
//
// Rate matched audio: an audio clip that was squeezed by a speed
// change has to play faster in the export too, or the voiceover
// gets cut off. The clip sound baked into the video already does,
// since the export video element plays at the clip speed. For the
// audio track, each clip plays at the speed of the video clip under
// it, changing rate as the export crosses into the next video clip,
// so the words keep pace all the way through. The background music
// stays at normal speed, it is a bed under the edit, not a voice
// tied to a clip.
export async function buildExportAudio({ createAudioContext, video, music, firstClip, audioClips = [], clips = [] }) {
  const context = createAudioContext();
  if (context.resume) {
    try {
      await context.resume();
    } catch {
      // A suspended context still mixes once it starts running.
    }
  }
  const dest = context.createMediaStreamDestination();
  const elementSource = context.createMediaElementSource(video);
  const clipGain = context.createGain();
  clipGain.gain.value = effectiveVolume(firstClip);
  elementSource.connect(clipGain);
  clipGain.connect(dest);
  let musicSource = null;
  if (music) {
    try {
      const buf = await music.file.arrayBuffer();
      const decoded = await context.decodeAudioData(buf);
      musicSource = context.createBufferSource();
      musicSource.buffer = decoded;
      musicSource.loop = true;
      const musicGain = context.createGain();
      musicGain.gain.value = clampMusicVolume(music.volume);
      musicSource.connect(musicGain);
      musicGain.connect(dest);
      musicSource.start();
    } catch {
      // The music file would not decode. Leave it out and keep the
      // clip audio, losing the music is better than losing everything.
      musicSource = null;
    }
  }
  const audioSources = [];
  for (const clip of audioClips) {
    if (!clip || !clip.file || clip.duration <= 0) continue;
    try {
      const buf = await clip.file.arrayBuffer();
      const decoded = await context.decodeAudioData(buf);
      const source = context.createBufferSource();
      source.buffer = decoded;
      const segments = audioRateSegments(clip, clips);
      if (source.playbackRate) {
        source.playbackRate.value = segments[0] ? segments[0].rate : 1;
        if (typeof source.playbackRate.setValueAtTime === "function") {
          for (const seg of segments.slice(1)) {
            source.playbackRate.setValueAtTime(seg.rate, context.currentTime + seg.start);
          }
        }
      }
      const gain = context.createGain();
      gain.gain.value = effectiveVolume(clip);
      source.connect(gain);
      gain.connect(dest);
      source.start(context.currentTime + clip.start, 0);
      audioSources.push(source);
    } catch {
      // That clip would not decode. Leave it out and keep the rest.
    }
  }
  const track = dest.stream.getAudioTracks()[0] || null;
  return { context, clipGain, musicSource, audioSources, track };
}

// Set the clip gain for the clip now playing in the export, so each
// clip comes out at its own volume and a muted clip stays silent.
export function setExportClipVolume(mix, clip) {
  if (mix && mix.clipGain) {
    mix.clipGain.gain.value = effectiveVolume(clip);
  }
}

// Stop the music and the audio track and close the context after
// an export.
export function stopExportAudio(mix) {
  if (!mix) return;
  try {
    mix.musicSource?.stop();
  } catch {
    // Already stopped, nothing to do.
  }
  for (const source of mix.audioSources || []) {
    try {
      source.stop();
    } catch {
      // Already stopped, nothing to do.
    }
  }
  if (mix.context && mix.context.close) {
    mix.context.close().catch(() => {});
  }
}
