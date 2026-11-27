import { audioClipLoops, audioClipSourceIn, audioRateSegments, clampMusicVolume, effectiveVolume } from "./timeline.js";

// The export draws video frames to a canvas and records them, but
// the canvas has no sound of its own. This builds the audio side:
// the export video element plays each clip, its sound runs through
// a gain node that follows the clip's volume and mute, the audio
// track mixes in beside it, the picture in picture overlay mixes
// in beside that, and the background music, when there is any,
// mixes in on its own gain. All of them feed one
// destination, whose track goes on the export stream.
//
// An audio clip starts at its place on the timeline, since the
// export plays in real time from zero, and it plays from its source
// offset in its file, so a clip trimmed from the left resumes
// partway through instead of starting over. A clip that would not
// decode is left out, losing one clip is better than losing
// everything.
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
// so the words keep pace all the way through. A clip over a sped
// up stretch needs more of its file than the file holds, so it
// loops to fill its slot instead of going quiet halfway through,
// and every clip stops at the end of its slot, so a long file does
// not bleed past it. The background music stays at normal speed,
// it is a bed under the edit, not a voice tied to a clip. The
// picture in picture overlay works the same way as an audio clip:
// its file plays from the start at its place on the timeline, at
// the speed of the video clip underneath, looping when its file
// runs out before the overlay ends, and stopping at the end of
// its slot. Its volume and mute follow the same rules as the
// clip audio, so a muted overlay exports silence.
export async function buildExportAudio({ createAudioContext, video, music, firstClip, audioClips = [], clips = [], pip = null, pips = [] }) {
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
      // A clip that needs more file than it holds loops to fill its
      // slot. Every clip stops at the end of its slot, so a looped
      // clip ends on time and a long file does not bleed past it.
      source.loop = audioClipLoops(clip, clips, decoded.duration) > 1;
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
      // Start at the clip's source offset in its file, wrapped to
      // the file length, so a trimmed clip resumes partway through.
      // With looping on, the source wraps to the file start after
      // the first pass, the same as the preview does.
      const startOffset = decoded.duration > 0 ? audioClipSourceIn(clip) % decoded.duration : 0;
      source.start(context.currentTime + clip.start, startOffset);
      if (typeof source.stop === "function") {
        source.stop(context.currentTime + clip.start + clip.duration);
      }
      audioSources.push(source);
    } catch {
      // That clip would not decode. Leave it out and keep the rest.
    }
  }
  // The picture in picture overlays each have a voice of their
  // own. A single `pip` still works too, for callers that only
  // have one overlay.
  const pipSources = [];
  const overlayList = pips.length ? pips : pip ? [pip] : [];
  for (const overlay of overlayList) {
    if (!overlay || !overlay.file || overlay.duration <= 0) continue;
    try {
      const buf = await overlay.file.arrayBuffer();
      const decoded = await context.decodeAudioData(buf);
      const pipSource = context.createBufferSource();
      pipSource.buffer = decoded;
      pipSource.loop = audioClipLoops(overlay, clips, decoded.duration) > 1;
      const segments = audioRateSegments(overlay, clips);
      if (pipSource.playbackRate) {
        pipSource.playbackRate.value = segments[0] ? segments[0].rate : 1;
        if (typeof pipSource.playbackRate.setValueAtTime === "function") {
          for (const seg of segments.slice(1)) {
            pipSource.playbackRate.setValueAtTime(seg.rate, context.currentTime + seg.start);
          }
        }
      }
      const gain = context.createGain();
      gain.gain.value = effectiveVolume(overlay);
      pipSource.connect(gain);
      gain.connect(dest);
      pipSource.start(context.currentTime + overlay.start, 0);
      if (typeof pipSource.stop === "function") {
        pipSource.stop(context.currentTime + overlay.start + overlay.duration);
      }
      pipSources.push(pipSource);
    } catch {
      // That overlay file would not decode. Leave it out and keep
      // the rest, losing one overlay sound is better than losing
      // everything.
    }
  }
  const track = dest.stream.getAudioTracks()[0] || null;
  return { context, clipGain, musicSource, audioSources, pipSource: pipSources[0] || null, pipSources, track };
}

// Set the clip gain for the clip now playing in the export, so each
// clip comes out at its own volume and a muted clip stays silent.
export function setExportClipVolume(mix, clip) {
  if (mix && mix.clipGain) {
    mix.clipGain.gain.value = effectiveVolume(clip);
  }
}

// Stop the music, the audio track and the picture in picture
// sound, and close the context after an export.
export function stopExportAudio(mix) {
  if (!mix) return;
  try {
    mix.musicSource?.stop();
  } catch {
    // Already stopped, nothing to do.
  }
  try {
    mix.pipSource?.stop();
  } catch {
    // Already stopped, nothing to do.
  }
  for (const source of mix.pipSources || []) {
    try {
      source.stop();
    } catch {
      // Already stopped, nothing to do.
    }
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
