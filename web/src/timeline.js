// timeline.js: the timeline model the web app uses.
// This mirrors reelcut-core in Rust, function for function, so the
// app keeps working even before the WASM module loads. When the WASM
// module is ready the app uses the Rust code for silence detection.

export function makeClip(id, name, url, sourceDuration) {
  return {
    id,
    name,
    url,
    sourceDuration,
    sourceIn: 0,
    sourceOut: sourceDuration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    effects: { brightness: 100, contrast: 100, saturation: 100 },
  };
}

// Per-clip volume and mute. A muted clip keeps its volume, so
// unmuting brings the level straight back. The preview and the
// export both play the effective volume, never the raw one.

// Clamp a clip volume to the 0 to 1 range. Bad input falls back
// to full volume, the same way the music volume does.
export function clampClipVolume(volume) {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

// What a clip actually sounds like: 0 when it is muted, its
// volume otherwise. Old clips without a muted flag count as
// unmuted.
export function effectiveVolume(clip) {
  if (!clip) return 0;
  return clip.muted ? 0 : clampClipVolume(clip.volume);
}

// Set one clip's volume, leaving the rest alone. Setting the
// volume above zero also unmutes the clip, since dragging the
// slider up is how you turn a clip back on.
export function setClipVolume(clips, id, volume) {
  const next = clampClipVolume(volume);
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, volume: next, muted: next > 0 ? false : c.muted };
  });
}

// Move one clip's volume up or down by a step, clamped to 0 to 1.
// Changing the volume unmutes the clip, unless the new volume is
// zero, in which case the mute flag stays as it is.
export function adjustClipVolume(clips, id, delta) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const next = clampClipVolume(clampClipVolume(c.volume) + delta);
    return { ...c, volume: next, muted: next > 0 ? false : c.muted };
  });
}

// Mute or unmute one clip, keeping its volume for later.
// With no third argument it mutes.
export function setClipMuted(clips, id, muted = true) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, muted: Boolean(muted) };
  });
}

// Flip one clip's mute flag.
export function toggleClipMuted(clips, id) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, muted: !c.muted };
  });
}

// Colour effects. Each clip carries its own brightness, contrast and
// saturation, 0 to 200 percent, 100 is untouched. The preview applies
// them with a CSS filter on the video element, the export with
// ctx.filter when it draws each frame.

// Clamp one effect value to the 0 to 200 range. Bad input falls back
// to 100, the untouched value.
export function clampEffect(value) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(0, value));
}

// Fill in missing effect values and clamp the rest, so a clip loaded
// from an old save or a partial patch still has all three.
export function normaliseEffects(effects) {
  const e = effects || {};
  return {
    brightness: clampEffect(e.brightness),
    contrast: clampEffect(e.contrast),
    saturation: clampEffect(e.saturation),
  };
}

// The CSS filter string for a clip, or "none" when it is untouched.
// The same string works for canvas ctx.filter at export time.
export function clipFilter(clip) {
  const e = normaliseEffects(clip.effects);
  if (e.brightness === 100 && e.contrast === 100 && e.saturation === 100) return "none";
  return `brightness(${e.brightness}%) contrast(${e.contrast}%) saturate(${e.saturation}%)`;
}

// Set one or more effect values on a clip, leaving the rest alone.
export function setClipEffects(clips, id, patch) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, effects: normaliseEffects({ ...normaliseEffects(c.effects), ...patch }) };
  });
}

// Move one effect value up or down by a step, clamped to 0 to 200.
export function adjustClipEffect(clips, id, key, delta) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const e = normaliseEffects(c.effects);
    return { ...c, effects: { ...e, [key]: clampEffect(e[key] + delta) } };
  });
}

export function clipDuration(clip) {
  const len = Math.max(0, clip.sourceOut - clip.sourceIn);
  return clip.speed > 0 ? len / clip.speed : len;
}

// Pack clips back to back and return a new array with start times set.
export function packClips(clips) {
  let t = 0;
  return clips.map((clip) => {
    const next = { ...clip, start: t };
    t += clipDuration(next);
    return next;
  });
}

export function totalDuration(clips) {
  return packClips(clips).reduce((max, c) => Math.max(max, c.start + clipDuration(c)), 0);
}

export function clipAtTime(clips, time) {
  const packed = packClips(clips);
  return packed.find((c) => time >= c.start && time < c.start + clipDuration(c)) || null;
}

export function trimClip(clips, id, newIn, newOut) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    const sourceIn = Math.max(0, newIn);
    const sourceOut = Math.max(sourceIn, newOut);
    return { ...c, sourceIn, sourceOut };
  });
}

// Split ids stay short no matter how many times a clip is cut.
// The first half keeps the clip id, the second half gets the base
// id plus a split number, so splitting a split clip gives
// "clip-1-s2" instead of "clip-1-b-b". The number is the lowest
// one not already used on the timeline, so ids stay unique even
// when a clip is split again and again. Old ids ending in "-b"
// count as split ids too, so a clip saved by the old scheme gets
// a clean number the next time it is cut.
export function splitSecondId(id, usedIds) {
  const base = String(id).replace(/(-b|-s\d+)+$/, "");
  let n = 1;
  while (usedIds.has(`${base}-s${n}`)) n += 1;
  return `${base}-s${n}`;
}

export function splitClip(clips, id, at) {
  const packed = packClips(clips);
  const idx = packed.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const clip = packed[idx];
  const end = clip.start + clipDuration(clip);
  if (at <= clip.start || at >= end) return null;
  const cutSource = clip.sourceIn + (at - clip.start) * clip.speed;
  const first = { ...clip, sourceOut: cutSource };
  const second = {
    ...clip,
    id: splitSecondId(clip.id, new Set(packed.map((c) => c.id))),
    sourceIn: cutSource,
    sourceOut: clip.sourceOut,
    fadeIn: 0,
  };
  const out = [...packed];
  out[idx] = first;
  out.splice(idx + 1, 0, second);
  return out.map(({ start, ...rest }) => rest);
}

export function deleteClip(clips, id) {
  return clips.filter((c) => c.id !== id);
}

export function moveClip(clips, id, newIndex) {
  const idx = clips.findIndex((c) => c.id === id);
  if (idx === -1 || newIndex < 0 || newIndex >= clips.length) return clips;
  const out = [...clips];
  const [clip] = out.splice(idx, 1);
  out.splice(newIndex, 0, clip);
  return out;
}

// Cut a time range out of the edit. Clips overlapping the range are
// trimmed or split, and the timeline closes up.
export function cutRange(clips, start, end) {
  if (end <= start) return clips;
  const packed = packClips(clips);
  const used = new Set(packed.map((c) => c.id));
  const out = [];
  for (const clip of packed) {
    const clipStart = clip.start;
    const clipEnd = clip.start + clipDuration(clip);
    if (clipEnd <= start || clipStart >= end) {
      out.push(stripStart(clip));
      continue;
    }
    if (start <= clipStart && end >= clipEnd) {
      continue;
    }
    if (start <= clipStart) {
      const cutSource = clip.sourceIn + (end - clipStart) * clip.speed;
      out.push(stripStart({ ...clip, sourceIn: cutSource }));
      continue;
    }
    if (end >= clipEnd) {
      const cutSource = clip.sourceIn + (start - clipStart) * clip.speed;
      out.push(stripStart({ ...clip, sourceOut: cutSource }));
      continue;
    }
    const cutIn = clip.sourceIn + (start - clipStart) * clip.speed;
    const cutOut = clip.sourceIn + (end - clipStart) * clip.speed;
    out.push(stripStart({ ...clip, sourceOut: cutIn }));
    const secondId = splitSecondId(clip.id, used);
    used.add(secondId);
    out.push(stripStart({ ...clip, id: secondId, sourceIn: cutOut }));
  }
  return out;
}

// Keep only the first target seconds of the edit. Clips past the
// target go, the clip straddling it is trimmed to end on the target.
export function cutdown(clips, target) {
  if (target <= 0) return clips;
  const packed = packClips(clips);
  const out = [];
  for (const clip of packed) {
    const end = clip.start + clipDuration(clip);
    if (clip.start >= target) continue;
    if (end > target) {
      const cutSource = clip.sourceIn + (target - clip.start) * clip.speed;
      out.push(stripStart({ ...clip, sourceOut: cutSource }));
      continue;
    }
    out.push(stripStart(clip));
  }
  return out;
}

function stripStart(clip) {
  const { start, ...rest } = clip;
  return rest;
}

// Find silent ranges in amplitude samples. Samples are absolute
// amplitudes from 0 to 1, taken at sampleRate samples per second.
export function detectSilence(samples, sampleRate, threshold = 0.05, minSilenceMs = 500) {
  if (!samples.length || sampleRate <= 0) return [];
  const minLen = Math.max(1, Math.floor((minSilenceMs / 1000) * sampleRate));
  const ranges = [];
  let runStart = null;
  for (let i = 0; i < samples.length; i += 1) {
    const silent = Math.abs(samples[i]) < threshold;
    if (silent && runStart === null) runStart = i;
    else if (!silent && runStart !== null) {
      if (i - runStart >= minLen) {
        ranges.push({ start: runStart / sampleRate, end: i / sampleRate });
      }
      runStart = null;
    }
  }
  if (runStart !== null && samples.length - runStart >= minLen) {
    ranges.push({ start: runStart / sampleRate, end: samples.length / sampleRate });
  }
  return ranges;
}

// Group recognised words into caption lines. A new line starts on a
// gap over 0.8 seconds or after 7 words.
export function captionsFromWords(words) {
  const captions = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    captions.push({
      text: current.map((w) => w.text).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };
  for (const word of words) {
    const last = current[current.length - 1];
    const gap = last ? word.start - last.end : 0;
    if (current.length && (gap > 0.8 || current.length >= 7)) flush();
    current.push(word);
  }
  flush();
  return captions;
}

// Find the boring parts of an edit from its captions: the long gaps
// where nobody says anything. A gap only counts when it is longer
// than minGap seconds. Each cut leaves `keep` seconds of breathing
// room on both sides so the edit does not sound chopped. The dead
// air before the first caption and after the last one counts too.
export function boringRanges(captions, total, minGap = 3, keep = 0.5) {
  const lines = [...captions].sort((a, b) => a.start - b.start);
  const ranges = [];
  const add = (start, end) => {
    if (end > start) ranges.push({ start, end });
  };
  let prevEnd = 0;
  for (const line of lines) {
    if (line.start - prevEnd > minGap) {
      add(prevEnd + keep, line.start - keep);
    }
    prevEnd = Math.max(prevEnd, line.end);
  }
  if (lines.length && total > 0 && total - prevEnd > minGap) {
    add(prevEnd + keep, total - keep);
  }
  return ranges;
}

// Move timed items (captions, overlays) to match a timeline with
// ranges cut out of it. An item that sat fully inside a cut range
// goes away, one that straddled a cut gets shorter.
export function shiftTimedItems(items, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const cutBefore = (t) => {
    let cut = 0;
    for (const r of sorted) {
      if (r.start >= t) break;
      cut += Math.min(r.end, t) - r.start;
    }
    return cut;
  };
  const out = [];
  for (const item of items) {
    const start = item.start - cutBefore(item.start);
    const end = item.end - cutBefore(item.end);
    if (end <= start) continue;
    out.push({ ...item, start, end });
  }
  return out;
}

// Undo and redo. A history entry is a snapshot of the whole edit:
// the clips, the text overlays, the captions, the audio track and
// the music. Snapshots copy the clip and overlay objects, but the
// music file itself is shared by reference, since it is never
// changed in place. The history keeps the last 50 edits, old ones
// drop off the front.

export const HISTORY_LIMIT = 50;

// A plain snapshot of the edit, safe to store and restore later.
// Old snapshots without an audio track still restore fine.
export function snapshotState(state) {
  return {
    clips: state.clips.map((c) => ({ ...c, effects: { ...c.effects } })),
    overlays: state.overlays.map((o) => ({ ...o })),
    captions: state.captions.map((c) => ({ ...c })),
    audioClips: (state.audioClips || []).map((c) => ({ ...c })),
    music: state.music ? { ...state.music } : null,
  };
}

export function makeHistory() {
  return { past: [], future: [] };
}

// Record the state before an edit. A new edit wipes the redo stack,
// since redo only makes sense until you do something different.
export function pushHistory(history, state) {
  const past = [...history.past, state];
  if (past.length > HISTORY_LIMIT) {
    past.splice(0, past.length - HISTORY_LIMIT);
  }
  return { past, future: [] };
}

// Step back one edit. Returns null when there is nothing to undo.
// The state you pass in is the current one, it becomes the first
// redo entry, so redo can bring it back.
export function undoHistory(history, current) {
  if (!history.past.length) return null;
  const past = [...history.past];
  const state = past.pop();
  return { history: { past, future: [current, ...history.future] }, state };
}

// Step forward one edit. Returns null when there is nothing to redo.
export function redoHistory(history, current) {
  if (!history.future.length) return null;
  const [state, ...future] = history.future;
  return { history: { past: [...history.past, current], future }, state };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}

// Keyboard shortcuts. The event can be a real KeyboardEvent or a
// plain object with the same fields, which keeps it testable.
// Returns "play", "split", "delete", "undo", "redo" or null.
// Shortcuts stay quiet while you type in a field, and Space on a
// focused button is left alone so the button still works.
export function shortcutForEvent(event) {
  const target = event.target || {};
  const tag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
    return null;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.shiftKey && (event.key === "z" || event.key === "Z")) return "undo";
  if (mod && (event.key === "y" || event.key === "Y")) return "redo";
  if (mod && event.shiftKey && (event.key === "z" || event.key === "Z")) return "redo";
  if (mod) return null;
  if (event.key === " " || event.key === "Spacebar") {
    if (tag === "button") return null;
    return "play";
  }
  if (event.key === "s" || event.key === "S") return "split";
  if (event.key === "Delete" || event.key === "Backspace") return "delete";
  return null;
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

// Background music helpers. A music track loops to fill the edit, so
// a short song can cover a long video and a long song is trimmed.

// Clamp a music volume to the 0 to 1 range. Bad input falls back to full.
export function clampMusicVolume(volume) {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

// How many full plays of a track it takes to cover an edit of a given
// length. Zero when either length is missing.
export function musicLoops(trackDuration, editDuration) {
  if (trackDuration <= 0 || editDuration <= 0) return 0;
  return Math.ceil(editDuration / trackDuration);
}

// How much of the track plays on its last, partial loop. When the track
// is longer than the edit, the whole edit is the first loop, so the
// answer is the edit length.
export function musicLastLoopLength(trackDuration, editDuration) {
  if (trackDuration <= 0 || editDuration <= 0) return 0;
  const loops = musicLoops(trackDuration, editDuration);
  return editDuration - (loops - 1) * trackDuration;
}

// The audio track. Voiceover, sound effects or a second music bed,
// each clip sitting at a chosen point on the timeline. A clip has a
// start in timeline seconds, a duration, a volume from 0 to 1 and a
// mute flag, the same shape the video clips and the music use, so
// the preview and the export can treat them all the same way.

// Make one audio clip. The start and duration are clamped to zero
// or more, the volume to the 0 to 1 range. sourceIn is where in the
// file the clip starts, so a clip trimmed from the left picks up
// partway through its file instead of starting over. Old clips
// without one count as starting at the beginning.
export function makeAudioClip(id, name, url, start, duration, volume = 1, sourceIn = 0) {
  return {
    id,
    name,
    url,
    start: Math.max(0, start || 0),
    duration: Math.max(0, duration || 0),
    volume: clampAudioVolume(volume),
    muted: false,
    sourceIn: Math.max(0, sourceIn || 0),
  };
}

// Where in its file an audio clip starts. Clips saved before the
// offset existed have none, so they count as starting at zero.
export function audioClipSourceIn(clip) {
  if (!clip || !Number.isFinite(clip.sourceIn)) return 0;
  return Math.max(0, clip.sourceIn);
}

// Clamp an audio clip volume to the 0 to 1 range. Bad input falls
// back to full volume, the same way the clip and music volumes do.
export function clampAudioVolume(volume) {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

// Add an audio clip to the track, keeping the track in timeline
// order so the track row reads left to right.
export function addAudioClip(clips, clip) {
  return [...clips, clip].sort((a, b) => a.start - b.start);
}

// Take one audio clip off the track.
export function removeAudioClip(clips, id) {
  return clips.filter((c) => c.id !== id);
}

// The clips sounding at a point in time. More than one can be
// active at once, when clips overlap on the track.
export function audioClipsAtTime(clips, time) {
  return clips.filter((c) => time >= c.start && time < c.start + c.duration);
}

// Set one audio clip's volume, leaving the rest alone. Setting the
// volume above zero also unmutes the clip, since dragging the
// slider up is how you turn a clip back on.
export function setAudioClipVolume(clips, id, volume) {
  const next = clampAudioVolume(volume);
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, volume: next, muted: next > 0 ? false : c.muted };
  });
}

// Mute or unmute one audio clip, keeping its volume for later.
// With no third argument it mutes.
export function setAudioClipMuted(clips, id, muted = true) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, muted: Boolean(muted) };
  });
}

// Flip one audio clip's mute flag.
export function toggleAudioClipMuted(clips, id) {
  return clips.map((c) => {
    if (c.id !== id) return c;
    return { ...c, muted: !c.muted };
  });
}

// Split audio clips at a point on the timeline, the same way a
// video split cuts a clip in two. A clip straddling the split point
// becomes two clips: the first keeps its start and source offset,
// the second starts at the split point and resumes from the file
// position the first half reached, worked out at the video speed
// under it, so the words carry on where they left off instead of
// starting over. Clips fully before or after the point are
// untouched, and volume, mute flag and name survive on both halves.
// Splitting changes nothing about how the track sounds, it just
// lets the two halves move on their own afterwards. With nothing
// straddling the point the track comes back as it was.
export function splitAudioClips(clips, at, videoClips) {
  if (!clips.length) return clips;
  const used = new Set(clips.map((c) => c.id));
  let changed = false;
  const out = [];
  for (const clip of clips) {
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
      sourceIn: audioFileOffset(clip, videoClips, at),
    };
    out.push(first, second);
  }
  return changed ? out : clips;
}

// Move audio clips to match a timeline with ranges cut out of it.
// A clip that sat fully inside a cut range goes away, one that
// straddled a cut is split in two, so the part after the cut
// resumes from the right spot in its file instead of playing
// straight through the removed bit, and the rest shift earlier by
// the cut time. A clip whose start sat inside a cut range loses its
// left end, and the file seconds that left end used up move into the
// source offset, so the clip resumes partway through its file
// instead of starting over. The offset is worked out at the video
// speed under the cut part, the same way the preview seeks, so a
// trimmed bit under a sped up clip counts double. Pass the video
// clips when you have them, so the speed is known; without them
// the trim counts at normal speed.
export function shiftAudioClips(clips, ranges, videoClips) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const cutBefore = (t) => {
    let cut = 0;
    for (const r of sorted) {
      if (r.start >= t) break;
      cut += Math.min(r.end, t) - r.start;
    }
    return cut;
  };
  const out = [];
  for (const clip of clips) {
    // Split the clip at every cut boundary inside it first, so a
    // clip straddling a cut becomes two clips and the part after the
    // cut resumes from the right spot in its file, instead of one
    // clip playing straight through the removed bit.
    let pieces = [clip];
    for (const r of sorted) {
      pieces = splitAudioClips(pieces, r.start, videoClips);
      pieces = splitAudioClips(pieces, r.end, videoClips);
    }
    for (const piece of pieces) {
      const start = piece.start - cutBefore(piece.start);
      const end = piece.start + piece.duration - cutBefore(piece.start + piece.duration);
      if (end <= start) continue;
      let sourceIn = audioClipSourceIn(piece);
      const containing = sorted.find((r) => piece.start >= r.start && piece.start < r.end);
      if (containing) {
        // The clip resumes where the cut ends, so its new source
        // offset is the file position at that point, which already
        // counts from the old offset.
        sourceIn = audioFileOffset(piece, videoClips, containing.end);
      }
      out.push({ ...piece, start, duration: end - start, sourceIn });
    }
  }
  return out;
}

// Keep only the first target seconds of the audio track. Clips past
// the target go, the clip straddling it ends on the target.
export function cutdownAudioClips(clips, target) {
  if (target <= 0) return clips;
  const out = [];
  for (const clip of clips) {
    const end = clip.start + clip.duration;
    if (clip.start >= target) continue;
    if (end > target) {
      out.push({ ...clip, duration: target - clip.start });
      continue;
    }
    out.push(clip);
  }
  return out;
}

// Rate matched audio. When a clip runs at 2x, the words on the
// audio track have to run at 2x too, or the voiceover gets cut off
// halfway through. The video element already does this for the
// sound baked into a clip, since its playbackRate follows the clip
// speed. The audio track needs the same treatment, and it needs
// two things: the rate to play at right now, and where in its file
// that lands, since a timeline second is no longer a file second
// once a clip is sped up or slowed down.

// A speed as a real playback rate. Bad input falls back to normal
// speed, the same way the volume clamps fall back to full.
export function clampSpeed(speed) {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return speed;
}

// The rate the audio track should play at, at a point on the
// timeline: the speed of the video clip under the playhead. No
// clip there, or no clips at all, means normal speed.
export function audioRateAtTime(videoClips, time) {
  const clip = clipAtTime(videoClips, time);
  return clip ? clampSpeed(clip.speed) : 1;
}

// The audio track in rate segments: each stretch of one audio clip
// that sits under a single video clip, with that clip's speed.
// Stretches with the same rate join up, and a stretch with no
// video under it plays at normal speed. With no video clips the
// whole audio clip is one stretch at normal speed.
export function audioRateSegments(audioClip, videoClips) {
  if (!audioClip || audioClip.duration <= 0) return [];
  const start = audioClip.start;
  const end = audioClip.start + audioClip.duration;
  const packed = packClips(videoClips || []);
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
  for (const clip of packed) {
    const clipStart = clip.start;
    const clipEnd = clip.start + clipDuration(clip);
    if (clipEnd <= cursor) continue;
    if (clipStart > cursor) push(cursor, Math.min(clipStart, end), 1);
    if (clipStart >= end) break;
    push(Math.max(clipStart, cursor), Math.min(clipEnd, end), clampSpeed(clip.speed));
    cursor = Math.min(clipEnd, end);
    if (cursor >= end) break;
  }
  if (cursor < end) push(cursor, end, 1);
  return out;
}

// Where in its file an audio clip should be, at a point on the
// timeline. The clip starts at its source offset in the file, then
// each timeline second under a sped up clip counts for more file
// seconds, so this adds up the rate over every stretch from the
// clip start to that point. Before the clip it is the source
// offset, past the end it stops at the end, so a seek never runs
// past what the clip covers. When the file length is given and the
// clip needs more file than it holds, the clip loops, so the
// offset wraps back to the start of the file instead of running
// past the end.
export function audioFileOffset(audioClip, videoClips, time, fileDuration) {
  if (!audioClip) return 0;
  const end = Math.min(Math.max(time, audioClip.start), audioClip.start + audioClip.duration);
  let offset = audioClipSourceIn(audioClip);
  for (const seg of audioRateSegments(audioClip, videoClips)) {
    const s = Math.max(seg.start, audioClip.start);
    const e = Math.min(seg.end, end);
    if (e > s) offset += (e - s) * seg.rate;
  }
  if (Number.isFinite(fileDuration) && fileDuration > 0) {
    return offset % fileDuration;
  }
  return offset;
}

// How many file seconds an audio clip needs over its whole length.
// A 5 second clip over a 2x stretch needs 10 file seconds, the same
// clip at normal speed needs 5. This is the offset at the clip end.
export function audioFileSeconds(audioClip, videoClips) {
  if (!audioClip || audioClip.duration <= 0) return 0;
  let total = 0;
  for (const seg of audioRateSegments(audioClip, videoClips)) {
    total += (seg.end - seg.start) * seg.rate;
  }
  return total;
}

// How many times the file has to play to fill the clip. One when
// the file covers it, more when a sped up stretch needs more file
// than the clip holds. Zero when the file length is unknown or the
// clip needs nothing, so the caller can leave looping alone. A
// clip that starts partway through its file has less file left
// before the first wrap, so the source offset counts towards the
// total file the clip needs.
export function audioClipLoops(audioClip, videoClips, fileDuration) {
  if (!Number.isFinite(fileDuration) || fileDuration <= 0) return 0;
  const needed = audioClipSourceIn(audioClip) + audioFileSeconds(audioClip, videoClips);
  if (needed <= 0) return 0;
  return Math.ceil(needed / fileDuration);
}

// Move the audio track through a speed change. Speeding the whole
// edit up or down, or changing one clip's speed, stretches or
// squeezes the video clips, so a point on the old timeline lands
// somewhere else on the new one. Each audio clip is remapped through
// that same move: its start and its end are mapped, and the duration
// is what is left between them. An audio clip that ends up past the
// new end of the edit goes away, one that straddles the end is
// trimmed to it. With no audio clips there is nothing to move, and
// with no video clips there is nothing to map against, so the track
// is left alone. A remap only moves a clip, it never trims its
// left end, so the source offset stays where it was.
export function respeedAudioClips(audioClips, oldClips, newClips) {
  if (!audioClips.length) return [];
  const oldPacked = packClips(oldClips);
  const newPacked = packClips(newClips);
  if (!oldPacked.length || !newPacked.length) return audioClips;
  const oldTotal = totalDuration(oldClips);
  const newTotal = totalDuration(newClips);
  const mapTime = (t) => {
    if (t <= 0) return 0;
    if (t >= oldTotal) return newTotal;
    const idx = oldPacked.findIndex((c) => t >= c.start && t < c.start + clipDuration(c));
    if (idx === -1) return newTotal;
    const oldClip = oldPacked[idx];
    const newClip = newPacked[idx];
    const oldLen = clipDuration(oldClip);
    const ratio = oldLen > 0 ? clipDuration(newClip) / oldLen : 0;
    return newClip.start + (t - oldClip.start) * ratio;
  };
  const out = [];
  for (const clip of audioClips) {
    const start = mapTime(clip.start);
    const end = mapTime(clip.start + clip.duration);
    if (start >= newTotal || end <= start) continue;
    out.push({ ...clip, start, duration: end - start });
  }
  return out;
}
