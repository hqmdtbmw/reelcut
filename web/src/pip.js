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
// timeline and plays for its duration. sourceIn is where in its
// file the clip starts, so a clip trimmed from the left picks up
// partway through its file instead of starting over. The corner
// defaults to bottom right and the size to medium, and it plays
// at full volume unless you turn it down.
export function makePipClip(id, name, url, start, duration, position, size, sourceDuration = 0, sourceIn = 0) {
  return {
    id,
    name,
    url,
    start: Math.max(0, start || 0),
    duration: Math.max(0, duration || 0),
    position: PIP_POSITIONS.includes(position) ? position : PIP_DEFAULT_POSITION,
    size: Object.prototype.hasOwnProperty.call(PIP_SIZES, size) ? size : PIP_DEFAULT_SIZE,
    sourceDuration: Math.max(0, sourceDuration || 0),
    sourceIn: Math.max(0, sourceIn || 0),
    volume: 1,
    muted: false,
  };
}

// Where in its file an overlay clip starts. Clips saved before the
// offset existed have none, so they count as starting at zero.
export function pipClipSourceIn(clip) {
  if (!clip || !Number.isFinite(clip.sourceIn)) return 0;
  return Math.max(0, clip.sourceIn);
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
    sourceIn: pipClipSourceIn(clip),
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

// How long one video clip plays for on the timeline, from its
// source range and its speed. The overlay helpers need this to
// work out the speed under a point on the timeline. It mirrors
// clipDuration in timeline.js, kept here so this file stands on
// its own.
function videoClipDuration(clip) {
  const len = Math.max(0, (clip.sourceOut || 0) - (clip.sourceIn || 0));
  return clip.speed > 0 ? len / clip.speed : len;
}

// Pack video clips back to back, so each one knows where it starts
// on the timeline. Mirrors packClips in timeline.js.
function packVideoClips(clips) {
  let t = 0;
  return (clips || []).map((clip) => {
    const next = { ...clip, start: t };
    t += videoClipDuration(next);
    return next;
  });
}

// A speed as a real playback rate. Bad input falls back to normal
// speed, the same way the volume clamps fall back to full.
function clampPipRate(speed) {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return speed;
}

// The overlay in rate segments: each stretch of it that sits under
// a single video clip, with that clip's speed. Stretches with the
// same rate join up, and a stretch with no video under it plays at
// normal speed. With no video clips the whole overlay is one
// stretch at normal speed. Mirrors audioRateSegments in timeline.js.
export function pipRateSegments(clip, videoClips) {
  if (!clip || clip.duration <= 0) return [];
  const start = clip.start;
  const end = clip.start + clip.duration;
  const packed = packVideoClips(videoClips);
  const out = [];
  const push = (s, e, rate) => {
    if (e <= s) return;
    const last = out[out.length - 1];
    if (last && last.rate === rate && last.end === s) last.end = e;
    else out.push({ start: s, end: e, rate });
  };
  if (!packed.length) {
    push(start, end, 1);
    return out;
  }
  let cursor = start;
  for (const video of packed) {
    const clipStart = video.start;
    const clipEnd = video.start + videoClipDuration(video);
    if (clipEnd <= cursor) continue;
    if (clipStart > cursor) push(cursor, Math.min(clipStart, end), 1);
    if (clipStart >= end) break;
    push(Math.max(clipStart, cursor), Math.min(clipEnd, end), clampPipRate(video.speed));
    cursor = Math.min(clipEnd, end);
    if (cursor >= end) break;
  }
  if (cursor < end) push(cursor, end, 1);
  return out;
}

// Where in its file the overlay video should be, at a point on the
// timeline. The clip starts at its source offset in the file, then
// each timeline second under a sped up clip counts for more file
// seconds, so this adds up the rate over every stretch from the
// clip start to that point. Before the clip it is the source
// offset, past the end it stops at the end, so a seek never runs
// past what the clip covers. When the file length is known and the
// clip runs longer than the file, the offset wraps back to the
// start, since the video loops. Pass the video clips when you have
// them, so the speed is known; without them the offset counts at
// normal speed.
export function pipFileOffset(clip, time, fileDuration, videoClips) {
  if (!clip) return 0;
  const end = Math.min(Math.max(time, clip.start), clip.start + clip.duration);
  let offset = pipClipSourceIn(clip);
  for (const seg of pipRateSegments(clip, videoClips)) {
    const s = Math.max(seg.start, clip.start);
    const e = Math.min(seg.end, end);
    if (e > s) offset += (e - s) * seg.rate;
  }
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

// Split ids stay short no matter how many times an overlay is
// cut. The first half keeps the overlay id, the second half gets
// the base id plus a split number, so splitting a split overlay
// gives "pip-1-s2" instead of "pip-1-b-b". The number is the lowest
// one not already used on the track, so ids stay unique even when
// an overlay is split again and again. Old ids ending in "-b"
// count as split ids too, so an overlay saved by the old scheme
// gets a clean number the next time it is cut. Mirrors
// splitSecondId in timeline.js, kept here so this file stands on
// its own.
function splitSecondId(id, usedIds) {
  const base = String(id).replace(/(-b|-s\d+)+$/, "");
  let n = 1;
  while (usedIds.has(`${base}-s${n}`)) n += 1;
  return `${base}-s${n}`;
}

// Split overlays at a point on the timeline, the same way a video
// split cuts a clip in two. An overlay straddling the split point
// becomes two overlays: the first keeps its start and source
// offset, the second starts at the split point and resumes from
// the file position the first half reached, worked out at the
// video speed under it, so the picture carries on where it left
// off instead of starting over. Overlays fully before or after the
// point are untouched, and the corner, size, volume, mute flag and
// name survive on both halves. Splitting changes nothing about
// how the overlay looks, it just lets the two halves move on
// their own afterwards. With nothing straddling the point the
// list comes back as it was. Mirrors splitAudioClips in
// timeline.js.
export function splitPips(list, at, videoClips) {
  if (!list.length) return list;
  const used = new Set(list.map((c) => c.id));
  let changed = false;
  const out = [];
  for (const clip of list) {
    const end = clip.start + clip.duration;
    if (at <= clip.start || at >= end) {
      out.push(clip);
      continue;
    }
    changed = true;
    const first = { ...clip, duration: at - clip.start };
    const secondId = splitSecondId(clip.id, used);
    used.add(secondId);
    const second = {
      ...clip,
      id: secondId,
      start: at,
      duration: end - at,
      sourceIn: pipFileOffset(clip, at, undefined, videoClips),
    };
    out.push(first, second);
  }
  return changed ? out : list;
}

// Move overlays to match a timeline with ranges cut out of it, the
// same way the captions and text overlays move. An overlay that sat
// fully inside a cut range goes away, one that straddled a cut gets
// shorter, and the rest shift earlier by the cut time. An overlay
// whose start sat inside a cut range loses its left end, and the
// file seconds that left end used up move into the source offset,
// so the overlay resumes partway through its file instead of
// starting over. The offset is worked out at the video speed under
// the cut part, the same way the preview seeks, so a trimmed bit
// under a sped up clip counts double. Pass the video clips when
// you have them, so the speed is known; without them the trim
// counts at normal speed. The overlay still lands over the right
// part of the main video, which is what the cut is for.
export function shiftPips(list, ranges, videoClips) {
  const sorted = [...(ranges || [])].sort((a, b) => a.start - b.start);
  const cutBefore = (t) => {
    let cut = 0;
    for (const r of sorted) {
      if (r.start >= t) break;
      cut += Math.min(r.end, t) - r.start;
    }
    return cut;
  };
  const out = [];
  for (const clip of list || []) {
    // Split the overlay at every cut boundary inside it first, so
    // an overlay straddling a cut becomes two overlays and the part
    // after the cut resumes from the right spot in its file, instead
    // of one overlay playing straight through the removed bit.
    let pieces = [clip];
    for (const r of sorted) {
      pieces = splitPips(pieces, r.start, videoClips);
      pieces = splitPips(pieces, r.end, videoClips);
    }
    for (const piece of pieces) {
      const start = piece.start - cutBefore(piece.start);
      const end = piece.start + piece.duration - cutBefore(piece.start + piece.duration);
      if (end <= start) continue;
      let sourceIn = pipClipSourceIn(piece);
      const containing = sorted.find((r) => piece.start >= r.start && piece.start < r.end);
      if (containing) {
        // The overlay resumes where the cut ends, so its new source
        // offset is the file position at that point, which already
        // counts from the old offset.
        sourceIn = pipFileOffset(piece, containing.end, undefined, videoClips);
      }
      out.push({ ...piece, start, duration: end - start, sourceIn });
    }
  }
  return out;
}
