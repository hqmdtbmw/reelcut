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

// Make one picture in picture clip. It starts at a point on the
// timeline and plays for its duration, from the start of its file.
// The corner defaults to bottom right and the size to medium.
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
