import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAudioClip,
  adjustClipEffect,
  adjustClipVolume,
  audioFileOffset,
  audioRateAtTime,
  boringRanges,
  canRedo,
  canUndo,
  clampMusicVolume,
  clipAtTime,
  clipDuration,
  clipFilter,
  cutRange,
  cutdown,
  cutdownAudioClips,
  deleteClip,
  detectSilence,
  effectiveVolume,
  formatTime,
  makeAudioClip,
  makeClip,
  makeHistory,
  moveClip,
  normaliseEffects,
  packClips,
  pushHistory,
  redoHistory,
  removeAudioClip,
  respeedAudioClips,
  setAudioClipVolume,
  setClipEffects,
  setClipMuted,
  setClipVolume,
  shiftAudioClips,
  shiftTimedItems,
  shortcutForEvent,
  snapshotState,
  splitClip,
  toggleAudioClipMuted,
  totalDuration,
  trimClip,
  undoHistory,
} from "./timeline.js";
import { EXAMPLE_COMMANDS, parseCommand } from "./agent.js";
import { buildExportAudio, setExportClipVolume, stopExportAudio } from "./exportAudio.js";

let nextId = 1;
function newId(prefix) {
  return `${prefix}-${Date.now()}-${nextId++}`;
}

const POSITIONS = {
  Top: { x: 0.5, y: 0.12 },
  Center: { x: 0.5, y: 0.5 },
  Bottom: { x: 0.5, y: 0.85 },
};

export default function App() {
  const [clips, setClips] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [overlays, setOverlays] = useState([]);
  const [captions, setCaptions] = useState([]);
  const [vertical, setVertical] = useState(false);
  const [agentSay, setAgentSay] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState("");
  const [exportProgress, setExportProgress] = useState(null);
  const [overlayDraft, setOverlayDraft] = useState({ text: "", start: 0, end: 3, position: "Bottom" });
  const [captionDraft, setCaptionDraft] = useState({ text: "", start: 0, end: 3 });
  const [music, setMusic] = useState(null);
  const [audioClips, setAudioClips] = useState([]);
  const [selectedAudioId, setSelectedAudioId] = useState(null);

  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const wasmRef = useRef(null);
  const musicInputRef = useRef(null);
  const musicAudioRef = useRef(null);
  const musicRef = useRef(null);
  musicRef.current = music;
  const audioInputRef = useRef(null);
  const audioElsRef = useRef(new Map());
  const audioClipsRef = useRef(audioClips);
  audioClipsRef.current = audioClips;
  const [wasmReady, setWasmReady] = useState(false);
  const playheadRef = useRef(0);
  playheadRef.current = playhead;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const captionsRef = useRef(captions);
  captionsRef.current = captions;
  // Undo history. The ref holds the stacks, the version state only
  // exists so the Undo and Redo buttons re-render when it changes.
  const historyRef = useRef(makeHistory());
  const lastPushRef = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);

  const packed = useMemo(() => packClips(clips), [clips]);
  const total = useMemo(() => totalDuration(clips), [clips]);
  const selected = packed.find((c) => c.id === selectedId) || null;
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId) || null;
  const currentClip = clipAtTime(packed, playhead);
  const activeOverlays = overlays.filter((o) => playhead >= o.start && playhead < o.end);
  const activeCaption = captions.find((c) => playhead >= c.start && playhead < c.end);

  // Load the Rust core compiled to WebAssembly. If it fails to load,
  // the app keeps working on the JavaScript mirror in timeline.js.
  useEffect(() => {
    let alive = true;
    import("./wasm/reelcut-core.js")
      .then(async (mod) => {
        await mod.default();
        return mod;
      })
      .then((mod) => {
        if (!alive) return;
        wasmRef.current = mod;
        setWasmReady(true);
      })
      .catch(() => {
        if (alive) setWasmReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the background music on the right track and volume.
  // The audio element loops, so a short song covers a long edit.
  useEffect(() => {
    if (!musicAudioRef.current) {
      musicAudioRef.current = new Audio();
      musicAudioRef.current.loop = true;
    }
    const audio = musicAudioRef.current;
    if (!music) {
      audio.pause();
      audio.removeAttribute("src");
      return;
    }
    if (audio.dataset.track !== music.url) {
      audio.dataset.track = music.url;
      audio.src = music.url;
    }
    audio.volume = clampMusicVolume(music.volume);
  }, [music]);

  // Start and stop the music with the preview, from the playhead.
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio || !music) return;
    if (playing) {
      audio.currentTime = music.duration > 0 ? playheadRef.current % music.duration : playheadRef.current;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, music]);

  // Scrubbing while paused moves the music to match the playhead.
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio || !music || playing) return;
    audio.currentTime = music.duration > 0 ? playhead % music.duration : playhead;
  }, [playhead, music, playing]);

  // One audio element per audio clip, kept in a map so the preview
  // can start and stop each clip on its own. Elements for clips
  // that are gone get paused and dropped.
  useEffect(() => {
    const els = audioElsRef.current;
    for (const clip of audioClips) {
      let el = els.get(clip.id);
      if (!el) {
        el = new Audio();
        els.set(clip.id, el);
      }
      if (el.dataset.track !== clip.url) {
        el.dataset.track = clip.url;
        el.src = clip.url;
      }
      el.volume = effectiveVolume(clip);
    }
    for (const [id, el] of [...els]) {
      if (!audioClips.some((c) => c.id === id)) {
        el.pause();
        el.removeAttribute("src");
        els.delete(id);
      }
    }
  }, [audioClips]);

  // Keep the audio track in sync with the playhead. A clip only
  // sounds while the playhead is inside it. Scrubbing while paused
  // moves each clip to the right spot in its file, so pressing play
  // picks it up from there. The clip plays at the speed of the video
  // clip under the playhead, and the spot in its file is worked out
  // from that speed, so a voiceover keeps pace with a sped up or
  // slowed down video instead of drifting and getting cut off. A
  // clip whose file has already run out stays quiet rather than
  // starting over from the top.
  useEffect(() => {
    for (const clip of audioClips) {
      const el = audioElsRef.current.get(clip.id);
      if (!el) continue;
      const offset = playhead - clip.start;
      const active = offset >= 0 && offset < clip.duration;
      const rate = audioRateAtTime(packed, playhead);
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const fileOffset = audioFileOffset(clip, packed, playhead);
      const fileEnded =
        Number.isFinite(el.duration) && el.duration > 0 && fileOffset >= el.duration - 0.05;
      const seekTo =
        Number.isFinite(el.duration) && el.duration > 0
          ? Math.min(fileOffset, Math.max(0, el.duration - 0.05))
          : fileOffset;
      if (playing && active && !fileEnded) {
        if (Math.abs(el.currentTime - seekTo) > 0.3) el.currentTime = seekTo;
        if (el.paused) el.play().catch(() => {});
      } else {
        el.pause();
        if (!playing && active && !fileEnded && Math.abs(el.currentTime - seekTo) > 0.3) {
          el.currentTime = seekTo;
        }
      }
    }
  }, [playing, playhead, audioClips, packed]);

  // Keep the preview video on the right clip and the right source time.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentClip) return;
    if (video.dataset.clip !== currentClip.id) {
      video.dataset.clip = currentClip.id;
      video.src = currentClip.url;
      video.playbackRate = currentClip.speed;
      video.volume = effectiveVolume(currentClip);
    }
    const want = currentClip.sourceIn + (playhead - currentClip.start) * currentClip.speed;
    if (Math.abs(video.currentTime - want) > 0.3) {
      video.currentTime = Math.min(want, currentClip.sourceOut - 0.05);
    }
    video.playbackRate = currentClip.speed;
    video.volume = effectiveVolume(currentClip);
  }, [playhead, currentClip]);

  // Drive playback: advance the playhead, hop to the next clip, apply fades.
  useEffect(() => {
    if (!playing) {
      videoRef.current?.pause();
      return;
    }
    const video = videoRef.current;
    if (!video || !currentClip) {
      setPlaying(false);
      return;
    }
    let raf = 0;
    const tick = () => {
      const clip = clipAtTime(packClips(clipsRef.current), playheadRef.current);
      if (!clip || !video) {
        setPlaying(false);
        return;
      }
      const sourceTime = video.currentTime;
      if (sourceTime >= clip.sourceOut - 0.05) {
        const next = packClips(clipsRef.current).find((c) => c.start > clip.start);
        if (next) {
          setPlayhead(next.start + 0.01);
        } else {
          setPlaying(false);
          setPlayhead(totalDuration(clipsRef.current));
        }
        return;
      }
      const t = clip.start + (sourceTime - clip.sourceIn) / clip.speed;
      setPlayhead(t);
      let opacity = 1;
      if (clip.fadeIn > 0 && t - clip.start < clip.fadeIn) {
        opacity = Math.max(0, (t - clip.start) / clip.fadeIn);
      }
      if (clip.fadeOut > 0 && clip.start + clipDuration(clip) - t < clip.fadeOut) {
        opacity = Math.min(opacity, Math.max(0, (clip.start + clipDuration(clip) - t) / clip.fadeOut));
      }
      video.style.opacity = String(opacity);
      video.play().catch(() => {});
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // A snapshot of the edit as it is right now, for undo history.
  function snapshotEdit() {
    return snapshotState({
      clips: clipsRef.current,
      overlays: overlaysRef.current,
      captions: captionsRef.current,
      audioClips: audioClipsRef.current,
      music: musicRef.current,
    });
  }

  // Save the current edit before changing it, so undo can bring it
  // back. Call this before the setState calls that make the change.
  function recordHistory() {
    historyRef.current = pushHistory(historyRef.current, snapshotEdit());
    setHistoryVersion((v) => v + 1);
  }

  // Sliders fire on every tiny move, so one drag would fill the
  // history with dozens of near-identical entries. This version only
  // records when the last entry is more than a moment old, so a drag
  // is one undo step and a fresh drag is another.
  function recordSliderHistory() {
    const now = Date.now();
    if (now - lastPushRef.current < 800) return;
    lastPushRef.current = now;
    recordHistory();
  }

  function applySnapshot(state) {
    setClips(state.clips);
    setOverlays(state.overlays);
    setCaptions(state.captions);
    setAudioClips(state.audioClips || []);
    setMusic(state.music);
    setSelectedId((prev) => (state.clips.some((c) => c.id === prev) ? prev : null));
    setSelectedAudioId((prev) => ((state.audioClips || []).some((c) => c.id === prev) ? prev : null));
    setPlayhead((prev) => Math.min(prev, totalDuration(state.clips)));
    setPlaying(false);
  }

  function doUndo() {
    const result = undoHistory(historyRef.current, snapshotEdit());
    if (!result) return;
    historyRef.current = result.history;
    applySnapshot(result.state);
    setHistoryVersion((v) => v + 1);
    setAgentSay("Undid that.");
  }

  function doRedo() {
    const result = redoHistory(historyRef.current, snapshotEdit());
    if (!result) return;
    historyRef.current = result.history;
    applySnapshot(result.state);
    setHistoryVersion((v) => v + 1);
    setAgentSay("Redid that.");
  }

  function updateClip(id, patch) {
    recordSliderHistory();
    if (patch.speed !== undefined) {
      // A clip's own speed moves the audio track with it, the same
      // way the whole-edit speed change does, so a voiceover stays
      // lined up with the video after one clip speeds up or slows
      // down. Every other patch leaves the track where it is.
      const oldClips = clipsRef.current;
      const next = oldClips.map((c) => (c.id === id ? { ...c, ...patch } : c));
      setClips(next);
      setAudioClips((prev) => respeedAudioClips(prev, oldClips, next));
      return;
    }
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Keyboard shortcuts live in a ref so the listener below never
  // goes stale, it always calls the latest version of each action.
  const actionsRef = useRef({});
  actionsRef.current = {
    togglePlay: () => setPlaying((p) => !p),
    splitAtPlayhead,
    deleteSelected,
    doUndo,
    doRedo,
  };

  useEffect(() => {
    const onKey = (e) => {
      const action = shortcutForEvent(e);
      if (!action) return;
      e.preventDefault();
      if (action === "play") actionsRef.current.togglePlay();
      else if (action === "split") actionsRef.current.splitAtPlayhead();
      else if (action === "delete") actionsRef.current.deleteSelected();
      else if (action === "undo") actionsRef.current.doUndo();
      else if (action === "redo") actionsRef.current.doRedo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function seek(time) {
    const t = Math.max(0, Math.min(total, time));
    setPlayhead(t);
    if (videoRef.current) videoRef.current.style.opacity = "1";
    const audio = musicAudioRef.current;
    if (audio && musicRef.current) {
      audio.currentTime =
        musicRef.current.duration > 0 ? t % musicRef.current.duration : t;
    }
  }

  async function importFiles(files) {
    const videos = Array.from(files).filter((f) => f.type.startsWith("video/"));
    if (!videos.length) {
      setAgentSay("Those files are not video. Try an mp4, mov or webm file.");
      return;
    }
    recordHistory();
    for (const file of videos) {
      const url = URL.createObjectURL(file);
      const duration = await new Promise((resolve) => {
        const probe = document.createElement("video");
        probe.preload = "metadata";
        probe.onloadedmetadata = () => resolve(probe.duration || 0);
        probe.onerror = () => resolve(0);
        probe.src = url;
      });
      if (!duration) {
        setAgentSay(`I could not read ${file.name}. It may be a format this browser cannot play.`);
        continue;
      }
      const clip = makeClip(newId("clip"), file.name, url, duration);
      clip.file = file;
      setClips((prev) => [...prev, clip]);
      setSelectedId(clip.id);
    }
    setAgentSay(`Imported ${videos.length} clip${videos.length > 1 ? "s" : ""}. Press play to watch, or drag the clip edges to trim.`);
  }

  async function importMusic(files) {
    const file = Array.from(files).find((f) => f.type.startsWith("audio/"));
    if (!file) {
      setAgentSay("That file is not audio. Try an mp3, wav or ogg file.");
      return;
    }
    const url = URL.createObjectURL(file);
    const duration = await new Promise((resolve) => {
      const probe = document.createElement("audio");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => resolve(probe.duration || 0);
      probe.onerror = () => resolve(0);
      probe.src = url;
    });
    if (!duration) {
      setAgentSay(`I could not read ${file.name}. It may be a format this browser cannot play.`);
      return;
    }
    recordHistory();
    setMusic({ name: file.name, url, volume: 0.5, duration, file });
    setAgentSay(`Added ${file.name} as background music. It will loop under your video.`);
  }

  function removeMusic() {
    if (!music) {
      setAgentSay("There is no music yet. Add some first and then I can take it out.");
      return;
    }
    recordHistory();
    setMusic(null);
    setAgentSay("Removed the music.");
  }

  // Add one or more audio files to the audio track. Each clip lands
  // at the playhead, or at the start when the playhead is past the
  // end of the video.
  async function importAudio(files) {
    const audios = Array.from(files).filter((f) => f.type.startsWith("audio/"));
    if (!audios.length) {
      setAgentSay("Those files are not audio. Try an mp3, wav or ogg file.");
      return;
    }
    recordHistory();
    for (const file of audios) {
      const url = URL.createObjectURL(file);
      const duration = await new Promise((resolve) => {
        const probe = document.createElement("audio");
        probe.preload = "metadata";
        probe.onloadedmetadata = () => resolve(probe.duration || 0);
        probe.onerror = () => resolve(0);
        probe.src = url;
      });
      if (!duration) {
        setAgentSay(`I could not read ${file.name}. It may be a format this browser cannot play.`);
        continue;
      }
      const start = playheadRef.current < total ? playheadRef.current : 0;
      const clip = makeAudioClip(newId("audio"), file.name, url, start, duration);
      clip.file = file;
      setAudioClips((prev) => addAudioClip(prev, clip));
      setSelectedAudioId(clip.id);
      setSelectedId(null);
    }
    setAgentSay(
      `Added ${audios.length} audio ${audios.length > 1 ? "clips" : "clip"} to the audio track. Click one on the track to change its volume or mute it.`,
    );
  }

  function removeSelectedAudio() {
    if (!selectedAudio) return;
    recordHistory();
    setAudioClips(removeAudioClip(audioClips, selectedAudio.id));
    setSelectedAudioId(null);
    setAgentSay(`Removed ${selectedAudio.name} from the audio track.`);
  }

  function splitAtPlayhead() {
    if (!currentClip) return;
    const out = splitClip(clips, currentClip.id, playhead);
    if (!out) {
      setAgentSay("Move the playhead inside a clip to split it.");
      return;
    }
    recordHistory();
    setClips(out);
    setAgentSay(`Split ${currentClip.name} at ${formatTime(playhead)}.`);
  }

  function deleteSelected() {
    if (!selected) return;
    recordHistory();
    setClips(deleteClip(clips, selected.id));
    setSelectedId(null);
    setAgentSay(`Deleted ${selected.name}.`);
  }

  function moveSelected(direction) {
    if (!selected) return;
    const idx = packed.findIndex((c) => c.id === selected.id);
    const next = moveClip(clips, selected.id, idx + direction);
    if (next === clips) return;
    recordHistory();
    setClips(next);
  }

  function startTrim(e, clip, edge) {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track || total <= 0) return;
    // One undo step for the whole drag, recorded before it starts.
    recordHistory();
    const rect = track.getBoundingClientRect();
    const startX = e.clientX;
    const origIn = clip.sourceIn;
    const origOut = clip.sourceOut;
    const pxPerSecond = rect.width / total;
    const onMove = (ev) => {
      const deltaSeconds = (ev.clientX - startX) / pxPerSecond;
      if (edge === "left") {
        const nextIn = Math.min(origIn + deltaSeconds, origOut - 0.1);
        setClips((prev) => trimClip(prev, clip.id, Math.max(0, nextIn), origOut));
      } else {
        const nextOut = Math.max(origOut + deltaSeconds, origIn + 0.1);
        setClips((prev) => trimClip(prev, clip.id, origIn, Math.min(clip.sourceDuration, nextOut)));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function removeSilences() {
    if (!clips.length) {
      setAgentSay("Import a video first, then I can remove the silences.");
      return;
    }
    setBusy("Listening for silences");
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const allRanges = [];
      for (const clip of packed) {
        if (!clip.file) continue;
        const buffer = await clip.file.arrayBuffer();
        let decoded;
        try {
          decoded = await audioCtx.decodeAudioData(buffer);
        } catch {
          continue;
        }
        const data = decoded.getChannelData(0);
        const rate = 100;
        const step = Math.max(1, Math.floor(decoded.sampleRate / rate));
        const amps = new Float32Array(Math.ceil(data.length / step));
        for (let i = 0; i < amps.length; i += 1) {
          let peak = 0;
          const from = i * step;
          for (let j = from; j < Math.min(from + step, data.length); j += 1) {
            peak = Math.max(peak, Math.abs(data[j]));
          }
          amps[i] = peak;
        }
        let ranges;
        if (wasmRef.current) {
          ranges = JSON.parse(wasmRef.current.wasm_detect_silence(amps, rate, 0.05, 500));
        } else {
          ranges = detectSilence(amps, rate, 0.05, 500);
        }
        for (const r of ranges) {
          const timelineStart = clip.start + Math.max(0, r.start - clip.sourceIn) / clip.speed;
          const timelineEnd = clip.start + Math.min(clipDuration(clip), (r.end - clip.sourceIn) / clip.speed);
          if (timelineEnd > timelineStart) {
            allRanges.push({ start: timelineStart, end: timelineEnd });
          }
        }
      }
      await audioCtx.close();
      if (!allRanges.length) {
        setAgentSay("I listened through the whole edit and found no silence longer than half a second.");
        return;
      }
      const removed = allRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
      let next = clips;
      const sorted = [...allRanges].sort((a, b) => b.start - a.start);
      for (const r of sorted) next = cutRange(next, r.start, r.end);
      recordHistory();
      setClips(next);
      // The audio track moves with the cuts, the same as the captions
      // and text do, so a voiceover stays lined up with the video.
      setAudioClips((prev) => shiftAudioClips(prev, allRanges));
      seek(0);
      const audioNote = audioClipsRef.current.length ? " The audio track moved with the cuts." : "";
      setAgentSay(`Removed ${allRanges.length} silent ${allRanges.length === 1 ? "stretch" : "stretches"}, ${removed.toFixed(1)} seconds in total. The edit is tighter now.${audioNote}`);
    } catch (err) {
      setAgentSay("I could not read the audio in this clip, so I left the timeline alone.");
    } finally {
      setBusy("");
    }
  }

  // Cut the boring parts: the long gaps between captions where
  // nobody says anything. It needs captions to know where those
  // gaps are, and the captions and text overlays move with the cuts.
  function cutBoringParts() {
    if (!clips.length) {
      setAgentSay("Import a video first, then I can cut the boring parts.");
      return;
    }
    if (!captions.length) {
      setAgentSay(
        "I need captions to know where the boring parts are. Add captions first, or say \"remove the silences\" and I will listen to the audio instead.",
      );
      return;
    }
    const ranges = boringRanges(captions, total);
    if (!ranges.length) {
      setAgentSay("I checked the gaps between your captions and found nothing longer than 3 seconds. It is already tight.");
      return;
    }
    const removed = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
    let next = clips;
    const sorted = [...ranges].sort((a, b) => b.start - a.start);
    for (const r of sorted) next = cutRange(next, r.start, r.end);
    recordHistory();
    setClips(next);
    setCaptions((prev) => shiftTimedItems(prev, ranges));
    setOverlays((prev) => shiftTimedItems(prev, ranges));
    setAudioClips((prev) => shiftAudioClips(prev, ranges));
    seek(0);
    const audioNote = audioClipsRef.current.length ? " The audio track moved with the cuts." : "";
    setAgentSay(
      `Cut ${ranges.length} boring ${ranges.length === 1 ? "stretch" : "stretches"}, ${removed.toFixed(1)} seconds in total. The captions and text moved with the cuts.${audioNote}`,
    );
  }

  function addCaptions() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setAgentSay("This browser cannot transcribe audio, so type the captions below and I will place them on the timeline for you.");
      document.getElementById("caption-text")?.focus();
      return;
    }
    if (!clips.length) {
      setAgentSay("Import a video first, then I can listen and add captions.");
      return;
    }
    setAgentSay("Listening now. I will add captions as the words come in. Press stop when you are done.");
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result.isFinal) return;
      const text = result[0].transcript.trim();
      if (!text) return;
      const t = playheadRef.current;
      recordHistory();
      setCaptions((prev) => [...prev, { text, start: t, end: t + 2.5 }]);
    };
    rec.onend = () => {
      setAgentSay("Done listening. The captions are on the timeline, drag them in the captions panel if the timing is off.");
    };
    rec.onerror = () => {
      setAgentSay("The microphone did not work, so no captions were added. You can still type them below.");
    };
    try {
      rec.start();
      window.__reelcutRec = rec;
      if (!playing) setPlaying(true);
    } catch {
      setAgentSay("The microphone did not work, so no captions were added. You can still type them below.");
    }
  }

  function stopListening() {
    window.__reelcutRec?.stop();
    window.__reelcutRec = null;
  }

  // Find the clip an agent command means: by number when one is
  // given, the selected clip otherwise. Returns the clip, or the
  // message to say when there is none.
  function resolveCommandClip(index, verb) {
    const clip = index >= 0 ? packed[index] : packed.find((c) => c.id === selectedId);
    if (clip) return { clip };
    return {
      error:
        index >= 0
          ? `There is no clip ${index + 1}. You have ${packed.length}.`
          : `Select a clip first, then tell me to ${verb}.`,
    };
  }

  async function runCommand(text) {
    const parsed = parseCommand(text, {
      clipCount: clips.length,
      duration: total,
      selectedIndex: packed.findIndex((c) => c.id === selectedId),
    });
    switch (parsed.kind) {
      case "remove-silences":
        await removeSilences();
        return;
      case "cut-boring-parts":
        cutBoringParts();
        return;
      case "add-captions":
        addCaptions();
        return;
      case "cut-first": {
        if (!clips.length) return setAgentSay("Import a video first.");
        const seconds = Math.min(parsed.seconds, total);
        recordHistory();
        setClips(cutRange(clips, 0, seconds));
        setAudioClips((prev) => shiftAudioClips(prev, [{ start: 0, end: seconds }]));
        seek(0);
        setAgentSay(`Cut the first ${seconds} seconds.`);
        return;
      }
      case "cutdown": {
        if (!clips.length) return setAgentSay("Import a video first.");
        if (total <= parsed.seconds) {
          setAgentSay(`It already runs ${total.toFixed(1)} seconds, shorter than ${parsed.seconds}. Nothing to cut.`);
          return;
        }
        recordHistory();
        setClips(cutdown(clips, parsed.seconds));
        setAudioClips((prev) => cutdownAudioClips(prev, parsed.seconds));
        setOverlays((prev) =>
          prev
            .filter((o) => o.start < parsed.seconds)
            .map((o) => (o.end > parsed.seconds ? { ...o, end: parsed.seconds } : o)),
        );
        seek(0);
        setAgentSay(`Cut it down to a ${parsed.seconds} second version.`);
        return;
      }
      case "make-vertical":
        setVertical(true);
        setAgentSay("Done, it is vertical now, 9 by 16, ready for TikTok or Reels.");
        return;
      case "make-horizontal":
        setVertical(false);
        setAgentSay("Done, it is horizontal now, 16 by 9.");
        return;
      case "speed-all": {
        if (!clips.length) return setAgentSay("Import a video first.");
        recordHistory();
        const next = clips.map((c) => ({ ...c, speed: parsed.factor }));
        setClips(next);
        // The audio track moves with the speed change, through the
        // same time mapping as the video, so a voiceover stays
        // lined up with the video.
        setAudioClips((prev) => respeedAudioClips(prev, clips, next));
        const audioNote = audioClipsRef.current.length ? " The audio track moved with it." : "";
        const verb = parsed.factor >= 1 ? "Sped the whole thing up" : "Slowed the whole thing down";
        setAgentSay(`${verb} to ${parsed.factor}x. It now runs ${totalDuration(next).toFixed(1)} seconds.${audioNote}`);
        return;
      }
      case "split-at": {
        const clip = clipAtTime(packed, parsed.seconds);
        if (!clip) return setAgentSay(`There is no clip at ${parsed.seconds} seconds.`);
        const out = splitClip(clips, clip.id, parsed.seconds);
        if (!out) return setAgentSay("I could not split there.");
        recordHistory();
        setClips(out);
        setAgentSay(`Split ${clip.name} at ${formatTime(parsed.seconds)}.`);
        return;
      }
      case "delete-clip": {
        const clip = packed[parsed.index];
        if (!clip) return setAgentSay(`There is no clip ${parsed.index + 1}. You have ${packed.length}.`);
        recordHistory();
        setClips(deleteClip(clips, clip.id));
        setAgentSay(`Deleted clip ${parsed.index + 1}, ${clip.name}.`);
        return;
      }
      case "add-text": {
        const end = parsed.end ?? Math.min(total || 3, parsed.start + 3);
        const overlay = {
          id: newId("text"),
          text: parsed.text,
          start: parsed.start,
          end,
          x: 0.5,
          y: 0.85,
          size: 64,
        };
        recordHistory();
        setOverlays((prev) => [...prev, overlay]);
        setAgentSay(`Added "${parsed.text}" from ${formatTime(parsed.start)} to ${formatTime(end)}.`);
        return;
      }
      case "mute":
        if (!clips.length) return setAgentSay("Import a video first.");
        recordHistory();
        setClips(clips.map((c) => ({ ...c, muted: true })));
        setAgentSay("Muted everything. Each clip keeps its volume, so unmuting brings it back.");
        return;
      case "mute-clip": {
        const { clip, error } = resolveCommandClip(parsed.index, "mute it");
        if (error) return setAgentSay(error);
        recordHistory();
        setClips(setClipMuted(clips, clip.id, true));
        setAgentSay(`Muted ${clip.name}. Its volume is saved, so unmuting brings it back.`);
        return;
      }
      case "unmute-clip": {
        const { clip, error } = resolveCommandClip(parsed.index, "unmute it");
        if (error) return setAgentSay(error);
        recordHistory();
        setClips(setClipMuted(clips, clip.id, false));
        setAgentSay(`Unmuted ${clip.name}.`);
        return;
      }
      case "set-clip-volume": {
        const { clip, error } = resolveCommandClip(parsed.index, "set its volume");
        if (error) return setAgentSay(error);
        recordHistory();
        setClips(setClipVolume(clips, clip.id, parsed.volume));
        setAgentSay(`Volume on ${clip.name} is now ${Math.round(parsed.volume * 100)} percent.`);
        return;
      }
      case "adjust-clip-volume": {
        const { clip, error } = resolveCommandClip(parsed.index, "turn it up or down");
        if (error) return setAgentSay(error);
        recordHistory();
        const next = adjustClipVolume(clips, clip.id, parsed.delta);
        setClips(next);
        const after = next.find((c) => c.id === clip.id);
        setAgentSay(`Volume on ${clip.name} is now ${Math.round(effectiveVolume(after) * 100)} percent.`);
        return;
      }
      case "set-volume":
        if (!clips.length) return setAgentSay("Import a video first.");
        recordHistory();
        setClips(clips.map((c) => ({ ...c, volume: parsed.volume, muted: false })));
        setAgentSay(`Volume set to ${Math.round(parsed.volume * 100)} percent.`);
        return;
      case "fade-all":
        recordHistory();
        setClips(clips.map((c) => ({ ...c, fadeIn: parsed.seconds, fadeOut: parsed.seconds })));
        setAgentSay(`Added a ${parsed.seconds} second fade at the start and end of every clip.`);
        return;
      case "set-effect": {
        if (!clips.length) return setAgentSay("Import a video first.");
        const targets = parsed.scope === "all" || !selected ? packed.map((c) => c.id) : [selected.id];
        let next = clips;
        for (const id of targets) {
          next =
            parsed.mode === "set"
              ? setClipEffects(next, id, { [parsed.effect]: parsed.value })
              : adjustClipEffect(next, id, parsed.effect, parsed.value);
        }
        recordHistory();
        setClips(next);
        const first = next.find((c) => c.id === targets[0]);
        const value = first ? normaliseEffects(first.effects)[parsed.effect] : 100;
        const label = parsed.effect.charAt(0).toUpperCase() + parsed.effect.slice(1);
        setAgentSay(
          targets.length > 1
            ? `${label} is now ${value}% on every clip.`
            : `${label} on ${selected.name} is now ${value}%.`,
        );
        return;
      }
      case "reset-effects": {
        if (!clips.length) return setAgentSay("Import a video first.");
        const targets = parsed.scope === "all" || !selected ? packed.map((c) => c.id) : [selected.id];
        let next = clips;
        for (const id of targets) {
          next = setClipEffects(next, id, { brightness: 100, contrast: 100, saturation: 100 });
        }
        recordHistory();
        setClips(next);
        setAgentSay(targets.length > 1 ? "Colours back to normal on every clip." : `Colours back to normal on ${selected.name}.`);
        return;
      }
      case "add-music":
        musicInputRef.current?.click();
        setAgentSay("Pick a music file and I will add it under your video.");
        return;
      case "remove-music":
        removeMusic();
        return;
      case "set-music-volume":
        if (!music) {
          setAgentSay("There is no music yet, so there is no music volume to change. Add some music first.");
          return;
        }
        recordHistory();
        setMusic({ ...music, volume: parsed.volume });
        setAgentSay(`Music volume set to ${Math.round(parsed.volume * 100)} percent.`);
        return;
      case "mute-audio-track":
        if (!audioClips.length) {
          setAgentSay("There is no audio track yet. Add an audio clip first and then I can mute it.");
          return;
        }
        recordHistory();
        setAudioClips(audioClips.map((c) => ({ ...c, muted: true })));
        setAgentSay("Muted the audio track. Each clip keeps its volume, so unmuting brings it back.");
        return;
      case "unmute-audio-track":
        if (!audioClips.length) {
          setAgentSay("There is no audio track yet, so there is nothing to unmute.");
          return;
        }
        recordHistory();
        setAudioClips(audioClips.map((c) => ({ ...c, muted: false })));
        setAgentSay("Unmuted the audio track.");
        return;
      case "set-audio-track-volume":
        if (!audioClips.length) {
          setAgentSay("There is no audio track yet. Add an audio clip first and then I can change its volume.");
          return;
        }
        recordHistory();
        setAudioClips(audioClips.map((c) => ({ ...c, volume: parsed.volume, muted: false })));
        setAgentSay(`Audio track volume set to ${Math.round(parsed.volume * 100)} percent.`);
        return;
      case "remove-audio-track":
        if (!audioClips.length) {
          setAgentSay("There is no audio track yet, so there is nothing to remove.");
          return;
        }
        recordHistory();
        setAudioClips([]);
        setSelectedAudioId(null);
        setAgentSay("Removed the audio track.");
        return;
      default:
        setAgentSay(`I did not understand "${text}". Try one of these: ${EXAMPLE_COMMANDS.slice(0, 4).join(", ")}.`);
    }
  }

  async function exportVideo() {
    if (!packed.length) {
      setAgentSay("Import a video first, then export.");
      return;
    }
    setExportProgress(0);
    setPlaying(false);
    const width = vertical ? 1080 : 1920;
    const height = vertical ? 1920 : 1080;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const video = document.createElement("video");
    video.muted = false;
    video.crossOrigin = "anonymous";
    // Build the export audio mix: the clip sound runs through a gain
    // that follows each clip's volume and mute, the audio track mixes
    // in beside it, and the music mixes in when there is any. Without
    // music the mix is still built, so the export is no longer silent.
    let mix = null;
    try {
      mix = await buildExportAudio({
        createAudioContext: () => new (window.AudioContext || window.webkitAudioContext)(),
        video,
        music,
        firstClip: packed[0],
        audioClips,
        clips: packed,
      });
    } catch {
      mix = null;
    }
    if (mix && mix.track) {
      stream.addTrack(mix.track);
    }
    if (!mix) {
      // Last resort for a browser with no AudioContext: take the audio
      // straight from a probe element. It is silent in most browsers,
      // the mix above is the real fix.
      let audioTrack = null;
      try {
        const probe = document.createElement("video");
        probe.src = packed[0].url;
        probe.muted = false;
        await new Promise((resolve) => {
          probe.onloadedmetadata = resolve;
          probe.onerror = resolve;
        });
        const tracks = probe.captureStream ? probe.captureStream().getAudioTracks() : [];
        audioTrack = tracks[0] || null;
      } catch {
        audioTrack = null;
      }
      if (audioTrack) stream.addTrack(audioTrack);
    }
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start(250);
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
    const waitFor = (el, event) =>
      new Promise((resolve) => {
        el.addEventListener(event, resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    try {
      let elapsed = 0;
      for (const clip of packed) {
        video.src = clip.url;
        video.playbackRate = clip.speed;
        video.volume = mix ? 1 : effectiveVolume(clip);
        setExportClipVolume(mix, clip);
        await waitFor(video, "loadedmetadata");
        video.currentTime = clip.sourceIn;
        await waitFor(video, "seeked");
        await video.play().catch(() => {});
        const clipLen = clipDuration(clip);
        const clipStart = clip.start;
        while (video.currentTime < clip.sourceOut - 0.05) {
          const t = clipStart + (video.currentTime - clip.sourceIn) / clip.speed;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          const vw = video.videoWidth || width;
          const vh = video.videoHeight || height;
          const scale = Math.max(width / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          let alpha = 1;
          if (clip.fadeIn > 0 && t - clipStart < clip.fadeIn) alpha = Math.max(0, (t - clipStart) / clip.fadeIn);
          if (clip.fadeOut > 0 && clipStart + clipLen - t < clip.fadeOut) {
            alpha = Math.min(alpha, Math.max(0, (clipStart + clipLen - t) / clip.fadeOut));
          }
          ctx.globalAlpha = alpha;
          ctx.filter = clipFilter(clip);
          ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
          ctx.filter = "none";
          ctx.globalAlpha = 1;
          for (const o of overlays) {
            if (t < o.start || t >= o.end) continue;
            ctx.font = `700 ${Math.round(o.size * (height / 1080))}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = "#fff";
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 6;
            ctx.fillText(o.text, o.x * width, o.y * height);
            ctx.shadowBlur = 0;
          }
          const cap = captions.find((c) => t >= c.start && t < c.end);
          if (cap) {
            ctx.font = `400 ${Math.round(36 * (height / 1080))}px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            const tw = ctx.measureText(cap.text).width;
            ctx.fillStyle = "rgba(0,0,0,0.75)";
            ctx.fillRect(width / 2 - tw / 2 - 14, height * 0.88, tw + 28, 52);
            ctx.fillStyle = "#fff";
            ctx.fillText(cap.text, width / 2, height * 0.88 + 36);
          }
          elapsed = t;
          setExportProgress(Math.min(100, Math.round((elapsed / total) * 100)));
          await nextFrame();
        }
        video.pause();
      }
    } finally {
      recorder.stop();
      video.pause();
      stopExportAudio(mix);
    }
    await done;
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reelcut-export.webm";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setExportProgress(null);
    setAgentSay(`Exported your video as a webm file, ${(blob.size / 1_000_000).toFixed(1)} MB. It should be downloading now.`);
  }

  return (
    <div className="app">
      <header className="top">
        <h1>
          reel<mark>cut</mark>
        </h1>
        <p>The video editor that edits itself. Free, no account, nothing behind a paywall.</p>
      </header>

      <form
        className="agent-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!command.trim()) return;
          runCommand(command);
          setCommand("");
        }}
      >
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Tell me what to do, like remove the silences"
          aria-label="Agent command"
        />
        <button className="primary" type="submit" disabled={!!busy}>
          {busy ? busy : "Do it"}
        </button>
      </form>
      <p className="agent-say">
        {agentSay ? <strong>{agentSay}</strong> : "Type a plain sentence and I will edit the timeline for you."}
        {wasmReady ? " The Rust core is running in this page." : ""}
      </p>
      <div className="examples">
        {EXAMPLE_COMMANDS.map((example) => (
          <button key={example} type="button" onClick={() => runCommand(example)}>
            {example}
          </button>
        ))}
      </div>

      <div className="workspace">
        <div>
          <div className={`preview-wrap ${vertical ? "vertical" : ""}`}>
            {currentClip ? (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  preload="auto"
                  style={{ filter: currentClip ? clipFilter(currentClip) : "none" }}
                />
                {activeOverlays.map((o) => (
                  <div
                    key={o.id}
                    className="overlay-text"
                    style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, fontSize: `${Math.max(14, o.size * 0.45)}px` }}
                  >
                    {o.text}
                  </div>
                ))}
                {activeCaption && <div className="caption-line">{activeCaption.text}</div>}
              </>
            ) : (
              <div className="preview-empty">
                <p>No video yet.</p>
                <label>
                  <input
                    type="file"
                    accept="video/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => importFiles(e.target.files)}
                  />
                  <span className="primary" style={{ padding: "10px 18px", borderRadius: 8, background: "#f5c518", color: "#111212", fontWeight: 600, cursor: "pointer" }}>
                    Import video
                  </span>
                </label>
                <p style={{ fontSize: 13, opacity: 0.8 }}>Your files stay on your computer. Nothing is uploaded.</p>
              </div>
            )}
          </div>

          <div className="preview-controls">
            <button type="button" onClick={() => (playing ? setPlaying(false) : setPlaying(true))} disabled={!currentClip}>
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={total || 0}
              step={0.1}
              value={playhead}
              onChange={(e) => seek(parseFloat(e.target.value))}
              disabled={!clips.length}
              aria-label="Playhead"
            />
            <span className="time-readout">
              {formatTime(playhead)} / {formatTime(total)}
            </span>
            <label>
              <input
                type="file"
                accept="video/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => importFiles(e.target.files)}
              />
              <span style={{ padding: "7px 12px", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer" }}>
                Add clips
              </span>
            </label>
            <button type="button" className="primary" onClick={exportVideo} disabled={!clips.length || exportProgress !== null}>
              {exportProgress !== null ? `Exporting ${exportProgress}%` : "Export video"}
            </button>
          </div>
          {exportProgress !== null && (
            <div className="progress">
              <div style={{ width: `${exportProgress}%` }} />
            </div>
          )}

          <div className="timeline">
            <h2>Timeline</h2>
            <div className="track" ref={trackRef}>
              {packed.length === 0 && <p className="track-empty">Clips you import will show up here.</p>}
              {packed.map((clip) => (
                <div
                  key={clip.id}
                  className={`clip-block ${selectedId === clip.id ? "selected" : ""}`}
                  style={{ width: `${total > 0 ? (clipDuration(clip) / total) * 100 : 0}%` }}
                  onClick={() => setSelectedId(clip.id)}
                >
                  <div className="clip-edge left" onPointerDown={(e) => startTrim(e, clip, "left")} />
                  <div className="clip-name">{clip.name}</div>
                  <div className="clip-meta">
                    {formatTime(clipDuration(clip))} · {clip.speed}x ·{" "}
                    {clip.muted ? "muted" : `${Math.round(clip.volume * 100)}%`}
                  </div>
                  <div className="clip-edge right" onPointerDown={(e) => startTrim(e, clip, "right")} />
                </div>
              ))}
              {total > 0 && (
                <div className="playhead" style={{ left: `calc(6px + (100% - 12px) * ${playhead / total})` }} />
              )}
            </div>
            <p className="track-label">Audio</p>
            <div className="audio-track">
              {audioClips.length === 0 && <p className="track-empty">Audio clips you add will show up here.</p>}
              {audioClips.map((clip) => (
                <div
                  key={clip.id}
                  className={`audio-block ${selectedAudioId === clip.id ? "selected" : ""}`}
                  style={{
                    left: total > 0 ? `calc(6px + (100% - 12px) * ${clip.start / total})` : "6px",
                    width: total > 0 ? `calc((100% - 12px) * ${clip.duration / total})` : "0px",
                  }}
                  onClick={() => {
                    setSelectedAudioId(clip.id);
                    setSelectedId(null);
                  }}
                >
                  <div className="clip-name">{clip.name}</div>
                  <div className="clip-meta">
                    {formatTime(clip.duration)} · {clip.muted ? "muted" : `${Math.round(clip.volume * 100)}%`}
                  </div>
                </div>
              ))}
              {total > 0 && (
                <div className="playhead" style={{ left: `calc(6px + (100% - 12px) * ${playhead / total})` }} />
              )}
            </div>
            <input
              type="file"
              accept="audio/*"
              multiple
              ref={audioInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                importAudio(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="clip-actions">
              <button type="button" onClick={doUndo} disabled={!canUndo(historyRef.current)}>
                Undo
              </button>
              <button type="button" onClick={doRedo} disabled={!canRedo(historyRef.current)}>
                Redo
              </button>
              <button type="button" onClick={splitAtPlayhead} disabled={!currentClip}>
                Split at playhead
              </button>
              <button type="button" onClick={deleteSelected} disabled={!selected}>
                Delete selected
              </button>
              <button type="button" onClick={() => moveSelected(-1)} disabled={!selected}>
                Move left
              </button>
              <button type="button" onClick={() => moveSelected(1)} disabled={!selected}>
                Move right
              </button>
              <button type="button" onClick={() => audioInputRef.current?.click()}>
                Add audio
              </button>
              <button type="button" onClick={() => setVertical(!vertical)}>
                {vertical ? "Make horizontal" : "Make vertical"}
              </button>
              <button type="button" onClick={stopListening}>
                Stop listening
              </button>
            </div>
            <p className="hint">
              Shortcuts: Space plays or pauses, S splits at the playhead, Delete removes the selected clip, Ctrl+Z undoes,
              Ctrl+Shift+Z redoes. Shortcuts stay quiet while you type.
            </p>
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Selected clip</h2>
            {selected ? (
              <>
                <p>
                  <strong>{selected.name}</strong>
                </p>
                <label>
                  Speed: {selected.speed.toFixed(2)}x
                  <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.25}
                    value={selected.speed}
                    onChange={(e) => updateClip(selected.id, { speed: parseFloat(e.target.value) })}
                  />
                </label>
                <label>
                  Volume: {selected.muted ? "muted" : `${Math.round(selected.volume * 100)}%`}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selected.volume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      updateClip(selected.id, { volume: v, muted: v > 0 ? false : selected.muted });
                    }}
                  />
                </label>
                <div className="row">
                  <button type="button" onClick={() => updateClip(selected.id, { muted: !selected.muted })}>
                    {selected.muted ? "Unmute clip" : "Mute clip"}
                  </button>
                </div>
                <label>
                  Fade in: {selected.fadeIn.toFixed(1)}s
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={selected.fadeIn}
                    onChange={(e) => updateClip(selected.id, { fadeIn: parseFloat(e.target.value) })}
                  />
                </label>
                <label>
                  Fade out: {selected.fadeOut.toFixed(1)}s
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={selected.fadeOut}
                    onChange={(e) => updateClip(selected.id, { fadeOut: parseFloat(e.target.value) })}
                  />
                </label>
                <label>
                  Brightness: {normaliseEffects(selected.effects).brightness}%
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={normaliseEffects(selected.effects).brightness}
                    onChange={(e) =>
                      updateClip(selected.id, {
                        effects: { ...normaliseEffects(selected.effects), brightness: parseFloat(e.target.value) },
                      })
                    }
                  />
                </label>
                <label>
                  Contrast: {normaliseEffects(selected.effects).contrast}%
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={normaliseEffects(selected.effects).contrast}
                    onChange={(e) =>
                      updateClip(selected.id, {
                        effects: { ...normaliseEffects(selected.effects), contrast: parseFloat(e.target.value) },
                      })
                    }
                  />
                </label>
                <label>
                  Saturation: {normaliseEffects(selected.effects).saturation}%
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={normaliseEffects(selected.effects).saturation}
                    onChange={(e) =>
                      updateClip(selected.id, {
                        effects: { ...normaliseEffects(selected.effects), saturation: parseFloat(e.target.value) },
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <p className="hint">Click a clip on the timeline to change its speed, volume, mute, fades and colours.</p>
            )}
          </div>

          <div className="panel">
            <h2>Music</h2>
            <input
              type="file"
              accept="audio/*"
              ref={musicInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                importMusic(e.target.files);
                e.target.value = "";
              }}
            />
            {music ? (
              <>
                <p>
                  <strong>{music.name}</strong>
                </p>
                <p className="hint">
                  {formatTime(music.duration)} long. It loops to fill the whole edit, and the export mixes it in.
                </p>
                <label>
                  Volume: {Math.round(music.volume * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={music.volume}
                    onChange={(e) => {
                      recordSliderHistory();
                      setMusic({ ...music, volume: parseFloat(e.target.value) });
                    }}
                  />
                </label>
                <div className="row">
                  <button type="button" onClick={() => musicInputRef.current?.click()}>
                    Change music
                  </button>
                  <button type="button" onClick={removeMusic}>
                    Remove music
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="hint">Add a song and it will play under your video, looping to fill the edit.</p>
                <button type="button" className="primary" onClick={() => musicInputRef.current?.click()}>
                  Add music
                </button>
              </>
            )}
          </div>

          <div className="panel">
            <h2>Audio track</h2>
            {audioClips.length ? (
              <>
                <p className="hint">
                  Voiceover, sound effects or a second music bed. Each clip plays where it sits on the timeline.
                </p>
                {selectedAudio ? (
                  <>
                    <p>
                      <strong>{selectedAudio.name}</strong>
                    </p>
                    <p className="hint">
                      {formatTime(selectedAudio.start)} to {formatTime(selectedAudio.start + selectedAudio.duration)} on
                      the timeline.
                    </p>
                    <label>
                      Volume: {selectedAudio.muted ? "muted" : `${Math.round(selectedAudio.volume * 100)}%`}
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedAudio.volume}
                        onChange={(e) => {
                          recordSliderHistory();
                          setAudioClips((prev) => setAudioClipVolume(prev, selectedAudio.id, parseFloat(e.target.value)));
                        }}
                      />
                    </label>
                    <div className="row">
                      <button
                        type="button"
                        onClick={() => {
                          recordHistory();
                          setAudioClips((prev) => toggleAudioClipMuted(prev, selectedAudio.id));
                        }}
                      >
                        {selectedAudio.muted ? "Unmute clip" : "Mute clip"}
                      </button>
                      <button type="button" onClick={removeSelectedAudio}>
                        Remove clip
                      </button>
                      <button type="button" onClick={() => audioInputRef.current?.click()}>
                        Add audio
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="hint">Click a clip on the audio track to change its volume or mute it.</p>
                )}
                {audioClips.map((c) => (
                  <div className="overlay-row" key={c.id}>
                    <span>
                      {c.name} · {formatTime(c.start)} to {formatTime(c.start + c.duration)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        recordHistory();
                        setAudioClips(removeAudioClip(audioClips, c.id));
                        if (selectedAudioId === c.id) setSelectedAudioId(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="hint">
                  Add a voiceover or a sound effect and it will sit on its own track under the video, playing in time
                  with the preview and mixed into the export.
                </p>
                <button type="button" className="primary" onClick={() => audioInputRef.current?.click()}>
                  Add audio
                </button>
              </>
            )}
          </div>

          <div className="panel">
            <h2>Text overlays</h2>
            <label>
              Text
              <input
                type="text"
                value={overlayDraft.text}
                onChange={(e) => setOverlayDraft({ ...overlayDraft, text: e.target.value })}
                placeholder="What should it say?"
              />
            </label>
            <div className="row">
              <label>
                From (s)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={overlayDraft.start}
                  onChange={(e) => setOverlayDraft({ ...overlayDraft, start: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label>
                To (s)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={overlayDraft.end}
                  onChange={(e) => setOverlayDraft({ ...overlayDraft, end: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label>
                Place
                <select
                  value={overlayDraft.position}
                  onChange={(e) => setOverlayDraft({ ...overlayDraft, position: e.target.value })}
                >
                  {Object.keys(POSITIONS).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!overlayDraft.text.trim()}
                onClick={() => {
                  recordHistory();
                  const pos = POSITIONS[overlayDraft.position];
                  setOverlays((prev) => [
                    ...prev,
                    { id: newId("text"), text: overlayDraft.text.trim(), start: overlayDraft.start, end: Math.max(overlayDraft.end, overlayDraft.start + 0.5), x: pos.x, y: pos.y, size: 64 },
                  ]);
                  setOverlayDraft({ ...overlayDraft, text: "" });
                }}
              >
                Add text
              </button>
            </div>
            {overlays.map((o) => (
              <div className="overlay-row" key={o.id}>
                <span>
                  "{o.text}" · {formatTime(o.start)} to {formatTime(o.end)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    recordHistory();
                    setOverlays(overlays.filter((x) => x.id !== o.id));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Captions</h2>
            <p className="hint">
              Type captions here, or tell the agent "add captions" and it will listen while the video plays (Chrome only).
            </p>
            <label>
              Caption
              <input
                id="caption-text"
                type="text"
                value={captionDraft.text}
                onChange={(e) => setCaptionDraft({ ...captionDraft, text: e.target.value })}
                placeholder="What is being said?"
              />
            </label>
            <div className="row">
              <label>
                From (s)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={captionDraft.start}
                  onChange={(e) => setCaptionDraft({ ...captionDraft, start: parseFloat(e.target.value) || 0 })}
                />
              </label>
              <label>
                To (s)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={captionDraft.end}
                  onChange={(e) => setCaptionDraft({ ...captionDraft, end: parseFloat(e.target.value) || 0 })}
                />
              </label>
            </div>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!captionDraft.text.trim()}
                onClick={() => {
                  recordHistory();
                  setCaptions((prev) => [...prev, { text: captionDraft.text.trim(), start: captionDraft.start, end: Math.max(captionDraft.end, captionDraft.start + 0.5) }]);
                  setCaptionDraft({ ...captionDraft, text: "" });
                }}
              >
                Add caption
              </button>
            </div>
            {captions.map((c, i) => (
              <div className="overlay-row" key={`${c.start}-${i}`}>
                <span>
                  "{c.text}" · {formatTime(c.start)} to {formatTime(c.end)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    recordHistory();
                    setCaptions(captions.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer>
        <p>
          reelcut is free and open source. Your videos never leave your computer. The timeline engine is Rust, compiled to
          WebAssembly for the browser and ready for native apps later.
        </p>
      </footer>
    </div>
  );
}
