import { clampMusicVolume, effectiveVolume } from "./timeline.js";

// The export draws video frames to a canvas and records them, but
// the canvas has no sound of its own. This builds the audio side:
// the export video element plays each clip, its sound runs through
// a gain node that follows the clip's volume and mute, and the
// background music, when there is any, mixes in on its own gain.
// Both feed one destination, whose track goes on the export stream.
//
// It works with or without music. Before this, the no-music path
// grabbed audio from a preview element that never played, so those
// exports came out silent.
export async function buildExportAudio({ createAudioContext, video, music, firstClip }) {
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
  const track = dest.stream.getAudioTracks()[0] || null;
  return { context, clipGain, musicSource, track };
}

// Set the clip gain for the clip now playing in the export, so each
// clip comes out at its own volume and a muted clip stays silent.
export function setExportClipVolume(mix, clip) {
  if (mix && mix.clipGain) {
    mix.clipGain.gain.value = effectiveVolume(clip);
  }
}

// Stop the music and close the context after an export.
export function stopExportAudio(mix) {
  if (!mix) return;
  try {
    mix.musicSource?.stop();
  } catch {
    // Already stopped, nothing to do.
  }
  if (mix.context && mix.context.close) {
    mix.context.close().catch(() => {});
  }
}
