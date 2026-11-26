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
  };
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

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}
