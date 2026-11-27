// pip.js: picture in picture. One overlay video clip that sits on
// top of the main track, in a corner of the frame. The helpers here
// are pure, so they are easy to test. The app wires them up to the
// preview, the timeline row and the export.

export const PIP_POSITIONS = ["bottom-right", "top-right", "bottom-left", "top-left"];

export const PIP_SIZES = {
  small: 0.25,
  medium: 0.33,
  large: 0.45,
};

export const PIP_DEFAULT_POSITION = "bottom-right";
export const PIP_DEFAULT_SIZE = "medium";

// How loud the overlay sounds: its volume from 0 to 1, and a
// mute flag. Muting keeps the volume, so unmuting brings it
// straight back, the same way the main clips and the audio track
// work.

// Clamp an overlay volume to the 0 to 1 range. Bad input falls
// back to full volume.
export function clampPipVolume(volume) {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

// Set the overlay volume, leaving the rest alone. Setting the
// volume above zero also unmutes it, since dragging the slider
// up is how you turn it back on.
export function setPipVolume(clip, volume) {
  const next = clampPipVolume(volume);
  return { ...clip, volume: next, muted: next > 0 ? false : clip.muted };
}

// Mute or unmute the overlay, keeping its volume for later.
// With no second argument it mutes.
export function setPipMuted(clip, muted = true) {
  return { ...clip, muted: Boolean(muted) };
}

// Make one picture in picture clip. It starts at a point on the
// timeline and plays for its duration, from the start of its file.
// The corner defaults to bottom right and the size to medium, and
// it plays at full volume unless you turn it down.
export function makePipClip(id, name, url, start, duration, position, size, sourceDuration = 0) {
  return {
    id,
    name,
    url,
    start: Math.max(0, start || 0),
    duration: Math.max(0, duration || 0),
    position: PIP_POSITIONS.includes(position) ? position : PIP_DEFAULT_POSITION,
    size: Object.prototype.hasOwnProperty.call(PIP_SIZES, size) ? size : PIP_DEFAULT_SIZE,
    sourceDuration: Math.max(0, sourceDuration || 0),
    volume: 1,
    muted: false,
  };
}

// Keep a picture in picture clip inside the edit and on valid
// settings. The start is clamped into the edit, the duration is
// trimmed to what is left after the start, and a bad corner or size
// falls back to the defaults. With no edit to clamp against, the
// clip keeps its start and a duration of at least half a second.
export function clampPipClip(clip, total) {
  const totalSeconds = Number.isFinite(total) && total > 0 ? total : 0;
  const start = totalSeconds > 0 ? Math.min(Math.max(0, clip.start || 0), Math.max(0, totalSeconds - 0.5)) : Math.max(0, clip.start || 0);
  const maxDuration = totalSeconds > 0 ? Math.max(0.5, totalSeconds - start) : Math.max(0.5, clip.duration || 0);
  const duration = Math.min(Math.max(0.5, clip.duration || 0), maxDuration);
  return {
    ...clip,
    start,
    duration,
    position: PIP_POSITIONS.includes(clip.position) ? clip.position : PIP_DEFAULT_POSITION,
    size: Object.prototype.hasOwnProperty.call(PIP_SIZES, clip.size) ? clip.size : PIP_DEFAULT_SIZE,
    volume: clampPipVolume(clip.volume),
    muted: Boolean(clip.muted),
  };
}

// Is the overlay on screen at a point on the timeline? The end is
// exclusive, so a clip ending at 5 seconds is gone at 5 seconds.
export function pipVisibleAtTime(clip, time) {
  if (!clip) return false;
  return time >= clip.start && time < clip.start + clip.duration;
}

// The rectangle the overlay covers on a frame of the given size.
// The width is a share of the frame width, the height follows a
// 16:9 overlay, and the corner sets which edges it hugs, with a
// small margin so it never touches the frame edge. Values are
// rounded to whole pixels, since canvas and CSS both want those.
export function pipRect(clip, frameWidth, frameHeight) {
  const size = Object.prototype.hasOwnProperty.call(PIP_SIZES, clip.size) ? clip.size : PIP_DEFAULT_SIZE;
  const width = Math.round(frameWidth * PIP_SIZES[size]);
  const height = Math.round((width * 9) / 16);
  const margin = Math.round(frameWidth * 0.02);
  const position = PIP_POSITIONS.includes(clip.position) ? clip.position : PIP_DEFAULT_POSITION;
  const x = position.endsWith("right") ? frameWidth - margin - width : margin;
  const y = position.startsWith("top") ? margin : frameHeight - margin - height;
  return { x, y, width, height };
}

// Where in its file the overlay video should be, at a point on the
// timeline. The clip starts at the beginning of its file, so the
// offset is just how far past its start the playhead is. When the
// file length is known and the clip runs longer than the file, the
// offset wraps back to the start, since the video loops.
export function pipFileOffset(clip, time, fileDuration) {
  if (!clip) return 0;
  const offset = Math.max(0, time - clip.start);
  if (Number.isFinite(fileDuration) && fileDuration > 0) {
    return offset % fileDuration;
  }
  return offset;
}

// More than one overlay at a time. The editor keeps a list of
// overlay clips, each with its own video, corner, size, volume
// and mute. The helpers below work on that list, and they never
// change the list in place, so undo history stays honest.

// Read the overlay list out of a saved state. Old saves kept a
// single clip under `pip`, so that one becomes a one-item list
// and nothing is lost. A state with no overlays at all gives an
// empty list.
export function pipsFromState(state) {
  if (!state) return [];
  if (Array.isArray(state.pips)) return state.pips.map((c) => ({ ...c }));
  if (state.pip) return [{ ...state.pip }];
  return [];
}

// Add an overlay to the end of the list. Adding a second one no
// longer replaces the first, each one keeps its own place.
export function addPipClip(list, clip) {
  return [...(list || []), clip];
}

// Take one overlay out of the list, leaving the rest alone.
export function removePipClip(list, id) {
  return (list || []).filter((c) => c.id !== id);
}

// Change one overlay in the list, leaving the rest alone.
export function updatePipClip(list, id, patch) {
  return (list || []).map((c) => (c.id === id ? { ...c, ...patch } : c));
}

// Set one overlay's volume, using the same rules as the single
// overlay setter: dragging the volume up unmutes it.
export function setPipClipVolume(list, id, volume) {
  return (list || []).map((c) => (c.id === id ? setPipVolume(c, volume) : c));
}

// Flip one overlay's mute flag, keeping its volume for later.
export function togglePipClipMuted(list, id) {
  return (list || []).map((c) => (c.id === id ? setPipMuted(c, !c.muted) : c));
}

// Which overlays are on screen at a point on the timeline.
export function visiblePipsAtTime(list, time) {
  return (list || []).filter((c) => pipVisibleAtTime(c, time));
}

// Cut the overlays down to a shorter edit: overlays past the new
// end go away, and one straddling the end is trimmed to it.
export function cutdownPips(list, seconds) {
  return (list || [])
    .filter((c) => c.start < seconds)
    .map((c) => (c.start + c.duration > seconds ? { ...c, duration: seconds - c.start } : c));
}
