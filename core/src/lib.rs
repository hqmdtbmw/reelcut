// reelcut-core: the timeline engine behind reelcut.
// Pure logic, no file access, no network. The same code runs natively
// (cargo test) and in the browser (compiled to WebAssembly), and later
// inside the Linux, Windows and iOS shells.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// One piece of video on the timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    /// Stable id, so the UI can point at a clip after edits.
    pub id: String,
    /// Display name, usually the file name.
    pub name: String,
    /// Where the clip starts inside its source file, in seconds.
    pub source_in: f64,
    /// Where the clip ends inside its source file, in seconds.
    pub source_out: f64,
    /// Where the clip starts on the timeline, in seconds.
    pub start: f64,
    /// Playback speed. 1.0 is normal, 2.0 is twice as fast.
    pub speed: f64,
    /// Volume from 0.0 (muted) to 1.0.
    pub volume: f64,
    /// Fade in length in seconds, 0.0 means no fade.
    pub fade_in: f64,
    /// Fade out length in seconds, 0.0 means no fade.
    pub fade_out: f64,
}

impl Clip {
    pub fn new(id: &str, name: &str, source_in: f64, source_out: f64, start: f64) -> Clip {
        Clip {
            id: id.to_string(),
            name: name.to_string(),
            source_in,
            source_out,
            start,
            speed: 1.0,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
        }
    }

    /// How long the clip lasts on the timeline, after speed is applied.
    pub fn duration(&self) -> f64 {
        let source_len = (self.source_out - self.source_in).max(0.0);
        if self.speed > 0.0 {
            source_len / self.speed
        } else {
            source_len
        }
    }

    /// Where the clip ends on the timeline.
    pub fn end(&self) -> f64 {
        self.start + self.duration()
    }

    /// True when the given timeline time falls inside this clip.
    pub fn contains(&self, time: f64) -> bool {
        time >= self.start && time < self.end()
    }

    /// Source time for a timeline time inside this clip.
    pub fn source_time_at(&self, time: f64) -> f64 {
        self.source_in + (time - self.start) * self.speed
    }
}

/// A text overlay pinned to a time range.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextOverlay {
    pub id: String,
    pub text: String,
    /// Timeline start in seconds.
    pub start: f64,
    /// Timeline end in seconds.
    pub end: f64,
    /// Horizontal position as a fraction of the frame width, 0.0 to 1.0.
    pub x: f64,
    /// Vertical position as a fraction of the frame height, 0.0 to 1.0.
    pub y: f64,
    /// Font size in pixels at 1080p.
    pub size: u32,
}

/// One caption line with its timing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Caption {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// One word with its timing, as a speech recogniser would return it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// A stretch of silence in an audio track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SilenceRange {
    pub start: f64,
    pub end: f64,
}

impl SilenceRange {
    pub fn duration(&self) -> f64 {
        self.end - self.start
    }
}

/// The whole edit: clips in order, overlays, output size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timeline {
    pub clips: Vec<Clip>,
    pub overlays: Vec<TextOverlay>,
    /// Output width in pixels.
    pub width: u32,
    /// Output height in pixels.
    pub height: u32,
}

impl Default for Timeline {
    fn default() -> Timeline {
        Timeline {
            clips: Vec::new(),
            overlays: Vec::new(),
            width: 1920,
            height: 1080,
        }
    }
}

impl Timeline {
    pub fn new() -> Timeline {
        Timeline::default()
    }

    /// Total length of the edit in seconds.
    pub fn total_duration(&self) -> f64 {
        self.clips.iter().map(|c| c.end()).fold(0.0, f64::max)
    }

    /// Add a clip at the end of the timeline.
    pub fn add_clip(&mut self, mut clip: Clip) {
        clip.start = self.total_duration();
        self.clips.push(clip);
    }

    /// Find a clip by id, returning its index.
    fn index_of(&self, id: &str) -> Option<usize> {
        self.clips.iter().position(|c| c.id == id)
    }

    /// Change the source in and out points of a clip, then close up the
    /// timeline so clips after it slide to fill the gap.
    pub fn trim(&mut self, id: &str, new_in: f64, new_out: f64) -> bool {
        let Some(i) = self.index_of(id) else {
            return false;
        };
        let (source_in, source_out) = (new_in.max(0.0), new_out.max(new_in.max(0.0)));
        self.clips[i].source_in = source_in;
        self.clips[i].source_out = source_out;
        self.reflow_from(i);
        true
    }

    /// Split a clip into two at a timeline time. Returns the id of the
    /// new second half, or None when the time is not inside the clip.
    pub fn split(&mut self, id: &str, at: f64) -> Option<String> {
        let i = self.index_of(id)?;
        let clip = self.clips[i].clone();
        if at <= clip.start || at >= clip.end() {
            return None;
        }
        let cut_source = clip.source_time_at(at);
        let first = Clip {
            source_out: cut_source,
            ..clip.clone()
        };
        let second = Clip {
            id: format!("{}-b", clip.id),
            name: clip.name.clone(),
            source_in: cut_source,
            source_out: clip.source_out,
            start: at,
            speed: clip.speed,
            volume: clip.volume,
            fade_in: 0.0,
            fade_out: clip.fade_out,
        };
        self.clips[i] = first;
        self.clips.insert(i + 1, second.clone());
        self.reflow_from(i + 1);
        Some(second.id)
    }

    /// Delete a clip and close the gap.
    pub fn delete(&mut self, id: &str) -> bool {
        let Some(i) = self.index_of(id) else {
            return false;
        };
        self.clips.remove(i);
        self.reflow_from(i);
        true
    }

    /// Move a clip to a new position in the order.
    pub fn move_clip(&mut self, id: &str, new_index: usize) -> bool {
        let Some(i) = self.index_of(id) else {
            return false;
        };
        if new_index >= self.clips.len() {
            return false;
        }
        let clip = self.clips.remove(i);
        self.clips.insert(new_index, clip);
        self.reflow_from(0);
        true
    }

    /// Change a clip's speed. The clip gets shorter or longer and the
    /// clips after it slide.
    pub fn set_speed(&mut self, id: &str, speed: f64) -> bool {
        if speed <= 0.0 {
            return false;
        }
        let Some(i) = self.index_of(id) else {
            return false;
        };
        self.clips[i].speed = speed;
        self.reflow_from(i);
        true
    }

    /// Change a clip's volume.
    pub fn set_volume(&mut self, id: &str, volume: f64) -> bool {
        let Some(i) = self.index_of(id) else {
            return false;
        };
        self.clips[i].volume = volume.clamp(0.0, 1.0);
        true
    }

    /// Set fade in and out lengths for a clip.
    pub fn set_fade(&mut self, id: &str, fade_in: f64, fade_out: f64) -> bool {
        let Some(i) = self.index_of(id) else {
            return false;
        };
        self.clips[i].fade_in = fade_in.max(0.0);
        self.clips[i].fade_out = fade_out.max(0.0);
        true
    }

    /// Cut a time range out of the edit, for example a silence. Clips
    /// overlapping the range are trimmed or split as needed, and the
    /// timeline closes up.
    pub fn cut_range(&mut self, start: f64, end: f64) -> bool {
        if end <= start {
            return false;
        }
        let mut i = 0;
        while i < self.clips.len() {
            let clip = self.clips[i].clone();
            let clip_start = clip.start;
            let clip_end = clip.end();
            if clip_end <= start || clip_start >= end {
                i += 1;
                continue;
            }
            if start <= clip_start && end >= clip_end {
                // Range covers the whole clip.
                self.clips.remove(i);
                continue;
            }
            if start <= clip_start {
                // Range cuts the head off the clip.
                let cut_source = clip.source_time_at(end);
                self.clips[i].source_in = cut_source;
                i += 1;
                continue;
            }
            if end >= clip_end {
                // Range cuts the tail off the clip.
                let cut_source = clip.source_time_at(start);
                self.clips[i].source_out = cut_source;
                i += 1;
                continue;
            }
            // Range sits inside the clip, split it and drop the middle.
            let cut_in = clip.source_time_at(start);
            let cut_out = clip.source_time_at(end);
            let first = Clip {
                source_out: cut_in,
                ..clip.clone()
            };
            let second = Clip {
                id: format!("{}-b", clip.id),
                source_in: cut_out,
                ..clip.clone()
            };
            self.clips[i] = first;
            self.clips.insert(i + 1, second);
            i += 2;
        }
        self.reflow_from(0);
        true
    }

    /// Remove every silent range, longest first so the earlier ranges
    /// keep their positions while we cut.
    pub fn remove_silences(&mut self, ranges: &[SilenceRange]) -> usize {
        let mut sorted: Vec<SilenceRange> = ranges.to_vec();
        sorted.sort_by(|a, b| b.start.partial_cmp(&a.start).unwrap());
        let mut removed = 0;
        for range in sorted {
            if self.cut_range(range.start, range.end) {
                removed += 1;
            }
        }
        removed
    }

    /// Keep only the first `target` seconds of the edit. Clips past
    /// the target are dropped, the clip straddling it is trimmed, and
    /// text overlays are clamped to the new end. Returns false when
    /// the edit is already that short.
    pub fn cutdown(&mut self, target: f64) -> bool {
        if target <= 0.0 || self.total_duration() <= target {
            return false;
        }
        let mut kept: Vec<Clip> = Vec::new();
        for clip in self.clips.iter() {
            if clip.start >= target {
                continue;
            }
            let mut clip = clip.clone();
            if clip.end() > target {
                clip.source_out = clip.source_time_at(target);
            }
            kept.push(clip);
        }
        self.clips = kept;
        self.overlays.retain(|o| o.start < target);
        for overlay in self.overlays.iter_mut() {
            if overlay.end > target {
                overlay.end = target;
            }
        }
        self.reflow_from(0);
        true
    }

    /// Switch the output to vertical 9:16.
    pub fn make_vertical(&mut self) {
        self.width = 1080;
        self.height = 1920;
    }

    /// Switch the output to horizontal 16:9.
    pub fn make_horizontal(&mut self) {
        self.width = 1920;
        self.height = 1080;
    }

    /// True when the output is vertical.
    pub fn is_vertical(&self) -> bool {
        self.height > self.width
    }

    /// Add a text overlay.
    pub fn add_overlay(&mut self, overlay: TextOverlay) {
        self.overlays.push(overlay);
    }

    /// Delete a text overlay by id.
    pub fn delete_overlay(&mut self, id: &str) -> bool {
        let before = self.overlays.len();
        self.overlays.retain(|o| o.id != id);
        self.overlays.len() != before
    }

    /// Recompute start times from a given index onward, packing clips
    /// back to back with no gaps.
    fn reflow_from(&mut self, from: usize) {
        let mut t = if from == 0 {
            0.0
        } else {
            self.clips[from - 1].end()
        };
        for clip in self.clips.iter_mut().skip(from) {
            clip.start = t;
            t = clip.end();
        }
    }

    /// Serialize the whole timeline to JSON.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// Load a timeline from JSON. Returns None when the JSON is invalid.
    pub fn from_json(json: &str) -> Option<Timeline> {
        serde_json::from_str(json).ok()
    }
}

/// Find the silent ranges in audio amplitude samples.
///
/// Samples are absolute amplitudes from 0.0 to 1.0, taken at
/// `sample_rate` samples per second. A sample counts as silent when it
/// is below `threshold`. Only stretches at least `min_silence_ms` long
/// are returned, and ranges shorter than the minimum are dropped.
pub fn detect_silence(
    samples: &[f32],
    sample_rate: f64,
    threshold: f32,
    min_silence_ms: f64,
) -> Vec<SilenceRange> {
    if samples.is_empty() || sample_rate <= 0.0 {
        return Vec::new();
    }
    let min_len = ((min_silence_ms / 1000.0) * sample_rate).max(1.0) as usize;
    let mut ranges = Vec::new();
    let mut run_start: Option<usize> = None;
    for (i, s) in samples.iter().enumerate() {
        let silent = s.abs() < threshold;
        match (silent, run_start) {
            (true, None) => run_start = Some(i),
            (false, Some(start)) => {
                if i - start >= min_len {
                    ranges.push(SilenceRange {
                        start: start as f64 / sample_rate,
                        end: i as f64 / sample_rate,
                    });
                }
                run_start = None;
            }
            _ => {}
        }
    }
    if let Some(start) = run_start {
        if samples.len() - start >= min_len {
            ranges.push(SilenceRange {
                start: start as f64 / sample_rate,
                end: samples.len() as f64 / sample_rate,
            });
        }
    }
    ranges
}

/// Group recognised words into caption lines. A new line starts when
/// the gap between words is over 0.8 seconds, or when the line already
/// holds 7 words.
pub fn captions_from_words(words: &[Word]) -> Vec<Caption> {
    let mut captions: Vec<Caption> = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    for word in words {
        let gap = match current.last() {
            Some(last) => word.start - last.end,
            None => 0.0,
        };
        if !current.is_empty() && (gap > 0.8 || current.len() >= 7) {
            captions.push(flush_caption(&current));
            current = Vec::new();
        }
        current.push(word.clone());
    }
    if !current.is_empty() {
        captions.push(flush_caption(&current));
    }
    captions
}

fn flush_caption(words: &[Word]) -> Caption {
    Caption {
        text: words
            .iter()
            .map(|w| w.text.clone())
            .collect::<Vec<String>>()
            .join(" "),
        start: words.first().map(|w| w.start).unwrap_or(0.0),
        end: words.last().map(|w| w.end).unwrap_or(0.0),
    }
}

// WebAssembly bindings. These are thin wrappers over the same
// functions above, so the browser runs the real Rust code.

/// Silence detection for the browser. Takes a Float32Array of
/// amplitudes and returns a JSON array of {start, end} ranges.
#[wasm_bindgen]
pub fn wasm_detect_silence(
    samples: &[f32],
    sample_rate: f64,
    threshold: f32,
    min_silence_ms: f64,
) -> String {
    let ranges = detect_silence(samples, sample_rate, threshold, min_silence_ms);
    serde_json::to_string(&ranges).unwrap_or_else(|_| "[]".to_string())
}

/// Total duration of a timeline given as JSON. Returns -1 when the
/// JSON does not parse.
#[wasm_bindgen]
pub fn wasm_timeline_duration(timeline_json: &str) -> f64 {
    match Timeline::from_json(timeline_json) {
        Some(t) => t.total_duration(),
        None => -1.0,
    }
}

/// Cut a timeline given as JSON down to its first `target` seconds,
/// and return the new timeline as JSON. Returns an empty string when
/// the input does not parse.
#[wasm_bindgen]
pub fn wasm_cutdown(timeline_json: &str, target: f64) -> String {
    let mut timeline = match Timeline::from_json(timeline_json) {
        Some(t) => t,
        None => return String::new(),
    };
    timeline.cutdown(target);
    timeline.to_json()
}

/// Cut a time range out of a timeline given as JSON, and return the
/// new timeline as JSON. Returns an empty string when the input does
/// not parse.
#[wasm_bindgen]
pub fn wasm_cut_range(timeline_json: &str, start: f64, end: f64) -> String {
    let mut timeline = match Timeline::from_json(timeline_json) {
        Some(t) => t,
        None => return String::new(),
    };
    timeline.cut_range(start, end);
    timeline.to_json()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_timeline() -> Timeline {
        let mut t = Timeline::new();
        t.add_clip(Clip::new("a", "clip-a.mp4", 0.0, 10.0, 0.0));
        t.add_clip(Clip::new("b", "clip-b.mp4", 2.0, 8.0, 0.0));
        t
    }

    #[test]
    fn durations_add_up() {
        let t = sample_timeline();
        assert!((t.total_duration() - 16.0).abs() < 1e-9);
        assert!((t.clips[1].start - 10.0).abs() < 1e-9);
    }

    #[test]
    fn trim_shortens_and_reflows() {
        let mut t = sample_timeline();
        assert!(t.trim("a", 2.0, 8.0));
        assert!((t.clips[0].duration() - 6.0).abs() < 1e-9);
        assert!((t.clips[1].start - 6.0).abs() < 1e-9);
        assert!((t.total_duration() - 12.0).abs() < 1e-9);
    }

    #[test]
    fn trim_unknown_clip_returns_false() {
        let mut t = sample_timeline();
        assert!(!t.trim("nope", 0.0, 5.0));
    }

    #[test]
    fn split_makes_two_clips() {
        let mut t = sample_timeline();
        let second = t.split("a", 4.0);
        assert_eq!(second, Some("a-b".to_string()));
        assert_eq!(t.clips.len(), 3);
        assert!((t.clips[0].duration() - 4.0).abs() < 1e-9);
        assert!((t.clips[1].duration() - 6.0).abs() < 1e-9);
        assert!((t.clips[1].source_in - 4.0).abs() < 1e-9);
        assert!((t.total_duration() - 16.0).abs() < 1e-9);
    }

    #[test]
    fn split_outside_clip_returns_none() {
        let mut t = sample_timeline();
        assert_eq!(t.split("a", 10.0), None);
        assert_eq!(t.split("a", -1.0), None);
        assert_eq!(t.clips.len(), 2);
    }

    #[test]
    fn delete_closes_the_gap() {
        let mut t = sample_timeline();
        assert!(t.delete("a"));
        assert_eq!(t.clips.len(), 1);
        assert!((t.clips[0].start - 0.0).abs() < 1e-9);
        assert!((t.total_duration() - 6.0).abs() < 1e-9);
    }

    #[test]
    fn move_clip_reorders() {
        let mut t = sample_timeline();
        assert!(t.move_clip("b", 0));
        assert_eq!(t.clips[0].id, "b");
        assert_eq!(t.clips[1].id, "a");
        assert!((t.clips[0].start - 0.0).abs() < 1e-9);
        assert!((t.clips[1].start - 6.0).abs() < 1e-9);
    }

    #[test]
    fn speed_changes_duration() {
        let mut t = sample_timeline();
        assert!(t.set_speed("a", 2.0));
        assert!((t.clips[0].duration() - 5.0).abs() < 1e-9);
        assert!((t.clips[1].start - 5.0).abs() < 1e-9);
        assert!((t.total_duration() - 11.0).abs() < 1e-9);
        assert!(!t.set_speed("a", 0.0));
        assert!(!t.set_speed("a", -1.0));
    }

    #[test]
    fn volume_clamps() {
        let mut t = sample_timeline();
        assert!(t.set_volume("a", 0.5));
        assert!((t.clips[0].volume - 0.5).abs() < 1e-9);
        assert!(t.set_volume("a", 2.0));
        assert!((t.clips[0].volume - 1.0).abs() < 1e-9);
        assert!(t.set_volume("a", -1.0));
        assert!((t.clips[0].volume - 0.0).abs() < 1e-9);
    }

    #[test]
    fn json_roundtrip_keeps_everything() {
        let mut t = sample_timeline();
        t.make_vertical();
        t.add_overlay(TextOverlay {
            id: "o1".to_string(),
            text: "hello".to_string(),
            start: 1.0,
            end: 3.0,
            x: 0.5,
            y: 0.8,
            size: 64,
        });
        let json = t.to_json();
        let back = Timeline::from_json(&json).expect("valid json");
        assert_eq!(back, t);
        assert!(Timeline::from_json("not json").is_none());
    }

    #[test]
    fn cut_range_removes_the_middle() {
        let mut t = Timeline::new();
        t.add_clip(Clip::new("a", "clip.mp4", 0.0, 20.0, 0.0));
        assert!(t.cut_range(5.0, 10.0));
        assert_eq!(t.clips.len(), 2);
        assert!((t.total_duration() - 15.0).abs() < 1e-9);
        assert!((t.clips[0].source_out - 5.0).abs() < 1e-9);
        assert!((t.clips[1].source_in - 10.0).abs() < 1e-9);
    }

    #[test]
    fn cut_range_across_clips() {
        let mut t = sample_timeline();
        assert!(t.cut_range(8.0, 12.0));
        assert!((t.total_duration() - 12.0).abs() < 1e-9);
    }

    #[test]
    fn remove_silences_cuts_them_all() {
        let mut t = Timeline::new();
        t.add_clip(Clip::new("a", "clip.mp4", 0.0, 20.0, 0.0));
        let ranges = vec![
            SilenceRange { start: 3.0, end: 5.0 },
            SilenceRange { start: 12.0, end: 15.0 },
        ];
        assert_eq!(t.remove_silences(&ranges), 2);
        assert!((t.total_duration() - 15.0).abs() < 1e-9);
    }

    #[test]
    fn cutdown_trims_the_last_clip() {
        let mut t = sample_timeline();
        assert!(t.cutdown(12.0));
        assert_eq!(t.clips.len(), 2);
        assert!((t.total_duration() - 12.0).abs() < 1e-9);
        assert!((t.clips[1].duration() - 2.0).abs() < 1e-9);
        assert!((t.clips[1].source_out - 4.0).abs() < 1e-9);
    }

    #[test]
    fn cutdown_drops_trailing_clips() {
        let mut t = sample_timeline();
        assert!(t.cutdown(8.0));
        assert_eq!(t.clips.len(), 1);
        assert!((t.total_duration() - 8.0).abs() < 1e-9);
    }

    #[test]
    fn cutdown_leaves_short_timelines_alone() {
        let mut t = sample_timeline();
        assert!(!t.cutdown(16.0));
        assert!(!t.cutdown(20.0));
        assert!(!t.cutdown(0.0));
        assert_eq!(t.clips.len(), 2);
    }

    #[test]
    fn cutdown_clamps_overlays() {
        let mut t = sample_timeline();
        t.add_overlay(TextOverlay {
            id: "o1".to_string(),
            text: "early".to_string(),
            start: 1.0,
            end: 3.0,
            x: 0.5,
            y: 0.5,
            size: 48,
        });
        t.add_overlay(TextOverlay {
            id: "o2".to_string(),
            text: "late".to_string(),
            start: 14.0,
            end: 16.0,
            x: 0.5,
            y: 0.5,
            size: 48,
        });
        t.add_overlay(TextOverlay {
            id: "o3".to_string(),
            text: "straddle".to_string(),
            start: 9.0,
            end: 13.0,
            x: 0.5,
            y: 0.5,
            size: 48,
        });
        assert!(t.cutdown(12.0));
        assert_eq!(t.overlays.len(), 2);
        assert_eq!(t.overlays[0].text, "early");
        assert!((t.overlays[1].end - 12.0).abs() < 1e-9);
    }

    #[test]
    fn vertical_and_horizontal() {
        let mut t = Timeline::new();
        assert!(!t.is_vertical());
        t.make_vertical();
        assert!(t.is_vertical());
        assert_eq!((t.width, t.height), (1080, 1920));
        t.make_horizontal();
        assert!(!t.is_vertical());
    }

    #[test]
    fn overlays_add_and_delete() {
        let mut t = Timeline::new();
        t.add_overlay(TextOverlay {
            id: "o1".to_string(),
            text: "hi".to_string(),
            start: 0.0,
            end: 2.0,
            x: 0.5,
            y: 0.5,
            size: 48,
        });
        assert_eq!(t.overlays.len(), 1);
        assert!(t.delete_overlay("o1"));
        assert!(t.overlays.is_empty());
        assert!(!t.delete_overlay("o1"));
    }

    #[test]
    fn silence_detection_finds_quiet_stretches() {
        // 10 seconds at 10 samples a second: loud, quiet, loud.
        let mut samples = vec![0.5f32; 100];
        for s in samples.iter_mut().take(60).skip(30) {
            *s = 0.01;
        }
        let ranges = detect_silence(&samples, 10.0, 0.05, 500.0);
        assert_eq!(ranges.len(), 1);
        assert!((ranges[0].start - 3.0).abs() < 1e-9);
        assert!((ranges[0].end - 6.0).abs() < 1e-9);
    }

    #[test]
    fn silence_detection_ignores_short_dips() {
        let mut samples = vec![0.5f32; 100];
        for s in samples.iter_mut().take(32).skip(30) {
            *s = 0.01;
        }
        let ranges = detect_silence(&samples, 10.0, 0.05, 500.0);
        assert!(ranges.is_empty());
    }

    #[test]
    fn silence_detection_empty_input() {
        assert!(detect_silence(&[], 10.0, 0.05, 500.0).is_empty());
    }

    #[test]
    fn captions_group_words() {
        let words = vec![
            Word { text: "hello".into(), start: 0.0, end: 0.4 },
            Word { text: "world".into(), start: 0.5, end: 0.9 },
            Word { text: "this".into(), start: 1.0, end: 1.3 },
            Word { text: "is".into(), start: 3.0, end: 3.2 },
            Word { text: "later".into(), start: 3.3, end: 3.7 },
        ];
        let caps = captions_from_words(&words);
        assert_eq!(caps.len(), 2);
        assert_eq!(caps[0].text, "hello world this");
        assert!((caps[0].start - 0.0).abs() < 1e-9);
        assert!((caps[0].end - 1.3).abs() < 1e-9);
        assert_eq!(caps[1].text, "is later");
    }

    #[test]
    fn captions_empty_input() {
        assert!(captions_from_words(&[]).is_empty());
    }

    #[test]
    fn source_time_tracks_speed() {
        let mut clip = Clip::new("a", "clip.mp4", 10.0, 20.0, 5.0);
        clip.speed = 2.0;
        assert!((clip.source_time_at(7.0) - 14.0).abs() < 1e-9);
        assert!(clip.contains(7.0));
        assert!(!clip.contains(10.0));
    }
}
