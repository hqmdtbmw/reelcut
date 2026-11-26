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
    fadeIn: 0,
    fadeOut: 0,
    effects: { brightness: 100, contrast: 100, saturation: 100 },
  };
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
    id: `${clip.id}-b`,
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
    out.push(stripStart({ ...clip, id: `${clip.id}-b`, sourceIn: cutOut }));
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
// the clips, the text overlays, the captions and the music. Snapshots
// copy the clip and overlay objects, but the music file itself is
// shared by reference, since it is never changed in place. The
// history keeps the last 50 edits, old ones drop off the front.

export const HISTORY_LIMIT = 50;

// A plain snapshot of the edit, safe to store and restore later.
export function snapshotState(state) {
  return {
    clips: state.clips.map((c) => ({ ...c, effects: { ...c.effects } })),
    overlays: state.overlays.map((o) => ({ ...o })),
    captions: state.captions.map((c) => ({ ...c })),
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
