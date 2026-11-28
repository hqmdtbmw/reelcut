import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CROSSFADE_DEFAULT,
  addAudioClip,
  adjustClipEffect,
  adjustClipVolume,
  audioFileOffset,
  audioRateAtTime,
  boringRanges,
  canRedo,
  canUndo,
  clearAllTransitionsIn,
  clampMusicVolume,
  clipAtTime,
  clipDuration,
  clipFadeOpacity,
  clipFilter,
  crossfadeAtTime,
  cutRange,
  cutdown,
  cutdownAudioClips,
  deleteClip,
  detectSilence,
  effectiveVolume,
  followSelection,
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
  respeedPips,
  setAllTransitionsIn,
  setAudioClipVolume,
  setClipEffects,
  setClipMuted,
  setClipVolume,
  setTransitionIn,
  shiftAudioClips,
  shiftTimedItems,
  shortcutForEvent,
  snapshotState,
  splitAudioClips,
  splitClip,
  toggleAudioClipMuted,
  totalDuration,
  transitionDuration,
  trimClip,
  undoHistory,
} from "./timeline.js";
import { EXAMPLE_COMMANDS, parseCommand } from "./agent.js";
import { buildExportAudio, setExportClipVolume, stopExportAudio } from "./exportAudio.js";
import {
  PIP_POSITIONS,
  PIP_SIZES,
  addPipClip,
  clampPipClip,
  cutdownPips,
  makePipClip,
  pipFileOffset,
  pipRect,
  pipsFromState,
  removePipClip,
  setPipClipVolume,
  shiftPips,
  splitPips,
  togglePipClipMuted,
  updatePipClip,
  visiblePipsAtTime,
} from "./pip.js";

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
  const [pips, setPips] = useState([]);
  const [selectedPipId, setSelectedPipId] = useState(null);

  const videoRef = useRef(null);
  const transitionVideoRef = useRef(null);
  const pipVideoElsRef = useRef(new Map());
  const pipInputRef = useRef(null);
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
  const pipsRef = useRef(pips);
  pipsRef.current = pips;
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
  const selectedIndex = packed.findIndex((c) => c.id === selectedId);
  const nextClip = selectedIndex >= 0 ? packed[selectedIndex + 1] || null : null;
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId) || null;
  const currentClip = clipAtTime(packed, playhead);
  const activeOverlays = overlays.filter((o) => playhead >= o.start && playhead < o.end);
  const activeCaption = captions.find((c) => playhead >= c.start && playhead < c.end);
  // The overlays on screen right now, and the one the panel is
  // editing. With only one overlay it is the selected one, so the
  // panel and the agent commands just work without clicking it.
  const visiblePips = visiblePipsAtTime(pips, playhead);
  const selectedPip = pips.find((c) => c.id === selectedPipId) || (pips.length === 1 ? pips[0] : null);
  function pipStyleFor(clip) {
    const rect = pipRect(clip, 1920, 1080);
    return {
      left: `${(rect.x / 1920) * 100}%`,
      top: `${(rect.y / 1080) * 100}%`,
      width: `${(rect.width / 1920) * 100}%`,
    };
  }

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
  // that are gone get paused and dropped. Each element loops, so a
  // short clip keeps playing over a sped up stretch instead of
  // running out and going quiet.
  useEffect(() => {
    const els = audioElsRef.current;
    for (const clip of audioClips) {
      let el = els.get(clip.id);
      if (!el) {
        el = new Audio();
        el.loop = true;
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
  // clip trimmed from the left starts from its source offset in
  // the file, not from the beginning. When the file runs out over
  // a sped up stretch the offset wraps back to the start of the
  // file, so the clip loops and keeps playing for its full length
  // instead of going quiet.
  useEffect(() => {
    for (const clip of audioClips) {
      const el = audioElsRef.current.get(clip.id);
      if (!el) continue;
      const offset = playhead - clip.start;
      const active = offset >= 0 && offset < clip.duration;
      const rate = audioRateAtTime(packed, playhead);
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const fileDuration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
      const fileOffset = audioFileOffset(clip, packed, playhead, fileDuration);
      const seekTo = fileDuration ? Math.min(fileOffset, Math.max(0, fileDuration - 0.05)) : fileOffset;
      if (playing && active) {
        if (Math.abs(el.currentTime - seekTo) > 0.3) el.currentTime = seekTo;
        if (el.paused) el.play().catch(() => {});
      } else {
        el.pause();
        if (!playing && active && Math.abs(el.currentTime - seekTo) > 0.3) {
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

  // Scrubbing into a dissolve while paused shows the same blend as
  // playback does: the main video at its share of the dissolve and
  // the second video frozen on the other clip's edge frame. The
  // tick above owns this while the video plays.
  useEffect(() => {
    if (playing) return;
    const video = videoRef.current;
    const blendVideo = transitionVideoRef.current;
    if (!video || !currentClip) {
      if (blendVideo) blendVideo.style.opacity = "0";
      return;
    }
    const blend = crossfadeAtTime(packed, playhead);
    if (blend) {
      const incomingIsCurrent = playhead >= blend.join;
      video.style.opacity = String(
        clipFadeOpacity(currentClip, playhead) * (incomingIsCurrent ? blend.progress : 1 - blend.progress),
      );
      if (blendVideo) {
        const other = incomingIsCurrent ? blend.left : blend.right;
        const frozen = incomingIsCurrent ? other.sourceOut - 0.05 : other.sourceIn;
        if (blendVideo.dataset.clip !== other.id) {
          blendVideo.dataset.clip = other.id;
          blendVideo.src = other.url;
        }
        if (Math.abs(blendVideo.currentTime - frozen) > 0.3) {
          blendVideo.currentTime = Math.max(0, frozen);
        }
        blendVideo.style.opacity = String(incomingIsCurrent ? 1 - blend.progress : blend.progress);
      }
    } else {
      video.style.opacity = String(clipFadeOpacity(currentClip, playhead));
      if (blendVideo) blendVideo.style.opacity = "0";
    }
  }, [playing, playhead, packed, currentClip]);

  // Keep every picture in picture video in step with the
  // playhead. Each one plays at the speed of the video clip
  // underneath, and loops when its file runs out before the
  // overlay ends. Their sound plays too, at each overlay volume,
  // so muting one in the panel quiets the preview. While paused
  // they seek to the right spot, so pressing play picks them up
  // from there. An overlay off screen is paused and left alone.
  useEffect(() => {
    for (const pip of pips) {
      const el = pipVideoElsRef.current.get(pip.id);
      if (!el) continue;
      if (el.dataset.track !== pip.url) {
        el.dataset.track = pip.url;
        el.src = pip.url;
      }
      el.volume = effectiveVolume(pip);
      const rate = currentClip ? currentClip.speed : 1;
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const fileDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
      const offset = pipFileOffset(pip, playhead, fileDuration, packed);
      const seekTo = fileDuration ? Math.min(offset, Math.max(0, fileDuration - 0.05)) : offset;
      const visible = playhead >= pip.start && playhead < pip.start + pip.duration;
      if (playing && visible) {
        if (Math.abs(el.currentTime - seekTo) > 0.3) el.currentTime = seekTo;
        if (el.paused) el.play().catch(() => {});
      } else {
        el.pause();
        if (!playing && visible && Math.abs(el.currentTime - seekTo) > 0.3) {
          el.currentTime = seekTo;
        }
      }
    }
  }, [playing, playhead, pips, currentClip, packed]);

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
      // The dissolve over a join: the main video shows the clip
      // under the playhead, and a second video stacked over it
      // shows the other clip in the join, frozen on its first
      // frame before the cut and its last frame after it, since
      // the clips sit back to back with no spare frames. Their
      // opacities add up to the full picture, so one dissolves
      // into the other across the join.
      const blend = crossfadeAtTime(packClips(clipsRef.current), t);
      const blendVideo = transitionVideoRef.current;
      if (blend) {
        const incomingIsCurrent = t >= blend.join;
        video.style.opacity = String(
          clipFadeOpacity(clip, t) * (incomingIsCurrent ? blend.progress : 1 - blend.progress),
        );
        if (blendVideo) {
          const other = incomingIsCurrent ? blend.left : blend.right;
          const frozen = incomingIsCurrent ? other.sourceOut - 0.05 : other.sourceIn;
          if (blendVideo.dataset.clip !== other.id) {
            blendVideo.dataset.clip = other.id;
            blendVideo.src = other.url;
          }
          if (Math.abs(blendVideo.currentTime - frozen) > 0.3) {
            blendVideo.currentTime = Math.max(0, frozen);
          }
          blendVideo.style.opacity = String(incomingIsCurrent ? 1 - blend.progress : blend.progress);
        }
      } else {
        video.style.opacity = String(clipFadeOpacity(clip, t));
        if (blendVideo) {
          blendVideo.style.opacity = "0";
          blendVideo.pause();
        }
      }
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
      pips: pipsRef.current,
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
    setPips(pipsFromState(state));
    setSelectedId((prev) => (state.clips.some((c) => c.id === prev) ? prev : null));
    setSelectedAudioId((prev) => ((state.audioClips || []).some((c) => c.id === prev) ? prev : null));
    setSelectedPipId((prev) => (pipsFromState(state).some((c) => c.id === prev) ? prev : null));
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
      // A clip's own speed moves the audio track and the overlays
      // with it, the same way the whole-edit speed change does, so
      // a voiceover and each overlay stay lined up with the video
      // after one clip speeds up or slows down. Every other patch
      // leaves them where they are.
      const oldClips = clipsRef.current;
      const next = oldClips.map((c) => (c.id === id ? { ...c, ...patch } : c));
      setClips(next);
      setAudioClips((prev) => respeedAudioClips(prev, oldClips, next));
      setPips((prev) => respeedPips(prev, oldClips, next));
      return;
    }
    if (patch.transitionIn !== undefined) {
      // The crossfade slider writes through here. Clamping on
      // write keeps the stored length inside what the two clips
      // allow, so the slider, its label and the stored value agree.
      setClips((prev) => setTransitionIn(prev, id, patch.transitionIn));
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

  // Add a video file as picture in picture. It lands at the
  // playhead, in the bottom right corner at medium size, and plays
  // for as long as its file lasts or until the edit ends, whichever
  // comes first. Adding another one keeps the ones already there,
  // each overlay has its own place on the timeline.
  async function importPip(files) {
    const file = Array.from(files).find((f) => f.type.startsWith("video/"));
    if (!file) {
      setAgentSay("That file is not video. Try an mp4, mov or webm file.");
      return;
    }
    if (!clips.length) {
      setAgentSay("Import a main video first, then I can add picture in picture on top of it.");
      return;
    }
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
      return;
    }
    const start = playheadRef.current < total ? playheadRef.current : 0;
    const clip = clampPipClip(
      makePipClip(newId("pip"), file.name, url, start, duration, "bottom-right", "medium", duration),
      total,
    );
    clip.file = file;
    if (clip.duration < 0.5) {
      setAgentSay("There is less than half a second left in the edit at the playhead, so the overlay would have nowhere to sit. Move the playhead earlier and try again.");
      return;
    }
    recordHistory();
    setPips((prev) => addPipClip(prev, clip));
    setSelectedPipId(clip.id);
    setAgentSay(
      `Added ${file.name} as picture in picture at ${formatTime(clip.start)}, bottom right, medium size. Change the corner or size in the picture in picture panel.`,
    );
  }

  function removePip() {
    if (!selectedPip) {
      if (!pips.length) {
        setAgentSay("There is no picture in picture yet. Add one first and then I can take it out.");
      } else {
        setAgentSay("You have more than one picture in picture. Click the one you want to remove first.");
      }
      return;
    }
    recordHistory();
    setPips((prev) => removePipClip(prev, selectedPip.id));
    if (selectedPipId === selectedPip.id) setSelectedPipId(null);
    setAgentSay(`Removed ${selectedPip.name} from the picture in picture track.`);
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
    setSelectedId(followSelection(clips, out, selectedId, playhead));
    // The audio track splits at the same point, so a voiceover
    // straddling the cut becomes two clips and the second half
    // picks up where the words left off. The overlays split too,
    // so one sitting across the cut becomes two and the second
    // half picks up partway through its own video. The selection
    // follows the piece under the playhead on each track, so the
    // panel never goes blank on a clip that just got split.
    const nextAudio = splitAudioClips(audioClipsRef.current, playhead, clips);
    setAudioClips(nextAudio);
    setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playhead));
    const nextPips = splitPips(pipsRef.current, playhead, clips);
    setPips(nextPips);
    setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playhead));
    setAgentSay(`Split ${currentClip.name} at ${formatTime(playhead)}.`);
  }

  function deleteSelected() {
    if (!selected) return;
    recordHistory();
    const range = [{ start: selected.start, end: selected.start + clipDuration(selected) }];
    setClips(deleteClip(clips, selected.id));
    // Deleting a clip closes the timeline up, so the captions, the
    // text overlays, the audio track and the overlays shift with it,
    // the same as they do for the other cuts. An audio clip or an
    // overlay that only survives as its right hand piece keeps the
    // selection on that piece, and one that is gone clears it.
    setCaptions((prev) => shiftTimedItems(prev, range));
    setOverlays((prev) => shiftTimedItems(prev, range));
    const nextAudio = shiftAudioClips(audioClipsRef.current, range, clips);
    setAudioClips(nextAudio);
    setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playhead));
    const nextPips = shiftPips(pipsRef.current, range, clips);
    setPips(nextPips);
    setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playhead));
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

  // Turn the crossfade on a join on or off. The marker between two
  // clips on the timeline calls this, so does the panel slider's
  // neighbour. A fresh crossfade starts at half a second.
  function toggleJoin(left, right) {
    const d = transitionDuration(left, right);
    recordHistory();
    setClips((prev) => setTransitionIn(prev, right.id, d > 0 ? 0 : CROSSFADE_DEFAULT));
    setAgentSay(
      d > 0
        ? `Took the crossfade out between ${left.name} and ${right.name}.`
        : `Added a ${CROSSFADE_DEFAULT} second crossfade between ${left.name} and ${right.name}.`,
    );
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
      setSelectedId(followSelection(clips, next, selectedId, playheadRef.current));
      // The audio track moves with the cuts, the same as the captions
      // and text do, so a voiceover stays lined up with the video.
      // The selection follows the surviving piece on each track, so
      // the panel never goes blank on a clip a cut just split.
      const nextAudio = shiftAudioClips(audioClipsRef.current, allRanges, clips);
      setAudioClips(nextAudio);
      setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playheadRef.current));
      const nextPips = shiftPips(pipsRef.current, allRanges, clips);
      setPips(nextPips);
      setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playheadRef.current));
      seek(0);
      const audioNote = audioClipsRef.current.length ? " The audio track moved with the cuts." : "";
      const pipNote = pipsRef.current.length ? " The overlays moved with the cuts." : "";
      setAgentSay(`Removed ${allRanges.length} silent ${allRanges.length === 1 ? "stretch" : "stretches"}, ${removed.toFixed(1)} seconds in total. The edit is tighter now.${audioNote}${pipNote}`);
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
    setSelectedId(followSelection(clips, next, selectedId, playheadRef.current));
    setCaptions((prev) => shiftTimedItems(prev, ranges));
    setOverlays((prev) => shiftTimedItems(prev, ranges));
    const nextAudio = shiftAudioClips(audioClipsRef.current, ranges, clips);
    setAudioClips(nextAudio);
    setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playheadRef.current));
    const nextPips = shiftPips(pipsRef.current, ranges, clips);
    setPips(nextPips);
    setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playheadRef.current));
    seek(0);
    const audioNote = audioClipsRef.current.length ? " The audio track moved with the cuts." : "";
    const pipNote = pipsRef.current.length ? " The overlays moved with the cuts." : "";
    setAgentSay(
      `Cut ${ranges.length} boring ${ranges.length === 1 ? "stretch" : "stretches"}, ${removed.toFixed(1)} seconds in total. The captions and text moved with the cuts.${audioNote}${pipNote}`,
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
        const next = cutRange(clips, 0, seconds);
        setClips(next);
        setSelectedId(followSelection(clips, next, selectedId, playhead));
        const nextAudio = shiftAudioClips(audioClipsRef.current, [{ start: 0, end: seconds }], clips);
        setAudioClips(nextAudio);
        setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playhead));
        const nextPips = shiftPips(pipsRef.current, [{ start: 0, end: seconds }], clips);
        setPips(nextPips);
        setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playhead));
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
        const next = cutdown(clips, parsed.seconds);
        setClips(next);
        setSelectedId(followSelection(clips, next, selectedId, playhead));
        const nextAudio = cutdownAudioClips(audioClipsRef.current, parsed.seconds);
        setAudioClips(nextAudio);
        setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playhead));
        const nextPips = cutdownPips(pipsRef.current, parsed.seconds);
        setPips(nextPips);
        setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playhead));
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
        // The audio track and the overlays move with the speed
        // change, through the same time mapping as the video, so a
        // voiceover and each overlay stay lined up with the video.
        setAudioClips((prev) => respeedAudioClips(prev, clips, next));
        setPips((prev) => respeedPips(prev, clips, next));
        const audioNote = audioClipsRef.current.length ? " The audio track moved with it." : "";
        const pipNote = pipsRef.current.length ? " The overlays moved with it." : "";
        const verb = parsed.factor >= 1 ? "Sped the whole thing up" : "Slowed the whole thing down";
        setAgentSay(`${verb} to ${parsed.factor}x. It now runs ${totalDuration(next).toFixed(1)} seconds.${audioNote}${pipNote}`);
        return;
      }
      case "split-at": {
        const clip = clipAtTime(packed, parsed.seconds);
        if (!clip) return setAgentSay(`There is no clip at ${parsed.seconds} seconds.`);
        const out = splitClip(clips, clip.id, parsed.seconds);
        if (!out) return setAgentSay("I could not split there.");
        recordHistory();
        setClips(out);
        setSelectedId(followSelection(clips, out, selectedId, parsed.seconds));
        const nextAudio = splitAudioClips(audioClipsRef.current, parsed.seconds, clips);
        setAudioClips(nextAudio);
        setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, parsed.seconds));
        const nextPips = splitPips(pipsRef.current, parsed.seconds, clips);
        setPips(nextPips);
        setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, parsed.seconds));
        setAgentSay(`Split ${clip.name} at ${formatTime(parsed.seconds)}.`);
        return;
      }
      case "delete-clip": {
        const clip = packed[parsed.index];
        if (!clip) return setAgentSay(`There is no clip ${parsed.index + 1}. You have ${packed.length}.`);
        recordHistory();
        const range = [{ start: clip.start, end: clip.start + clipDuration(clip) }];
        const next = deleteClip(clips, clip.id);
        setClips(next);
        // Deleting a clip used to leave the selection pointing at
        // the clip that just went away, so the panel went blank.
        setSelectedId(followSelection(clips, next, selectedId, playhead));
        // Deleting a clip closes the timeline up, so the captions,
        // the text overlays, the audio track and the overlays shift
        // with it, the same as they do for the other cuts.
        setCaptions((prev) => shiftTimedItems(prev, range));
        setOverlays((prev) => shiftTimedItems(prev, range));
        const nextAudio = shiftAudioClips(audioClipsRef.current, range, clips);
        setAudioClips(nextAudio);
        setSelectedAudioId(followSelection(audioClipsRef.current, nextAudio, selectedAudioId, playhead));
        const nextPips = shiftPips(pipsRef.current, range, clips);
        setPips(nextPips);
        setSelectedPipId(followSelection(pipsRef.current, nextPips, selectedPipId, playhead));
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
      case "add-crossfade": {
        if (clips.length < 2) return setAgentSay("I need at least two clips to put a crossfade between them.");
        const { clip: left, error } = resolveCommandClip(parsed.index, "add a crossfade after it");
        if (error) return setAgentSay(error);
        const right = packed[packed.findIndex((c) => c.id === left.id) + 1];
        if (!right) return setAgentSay(`${left.name} is the last clip, so there is no next clip to fade into.`);
        if (parsed.rightIndex !== undefined && parsed.rightIndex !== packed.findIndex((c) => c.id === right.id)) {
          return setAgentSay(
            `Clip ${parsed.index + 1} and clip ${parsed.rightIndex + 1} are not next to each other, so there is no join between them.`,
          );
        }
        recordHistory();
        setClips(setTransitionIn(clips, right.id, parsed.seconds));
        const seconds = transitionDuration(left, { ...right, transitionIn: parsed.seconds });
        setAgentSay(`Added a ${seconds} second crossfade between ${left.name} and ${right.name}.`);
        return;
      }
      case "add-crossfade-all": {
        if (clips.length < 2) return setAgentSay("I need at least two clips to put crossfades between them.");
        recordHistory();
        setClips(setAllTransitionsIn(clips, parsed.seconds));
        setAgentSay(`Added a ${parsed.seconds} second crossfade between every clip.`);
        return;
      }
      case "remove-crossfade": {
        if (clips.length < 2) return setAgentSay("There is no crossfade to remove yet.");
        const { clip: left, error } = resolveCommandClip(parsed.index, "remove the crossfade after it");
        if (error) return setAgentSay(error);
        const right = packed[packed.findIndex((c) => c.id === left.id) + 1];
        if (!right) return setAgentSay(`${left.name} is the last clip, so there is no crossfade after it.`);
        if (parsed.rightIndex !== undefined && parsed.rightIndex !== packed.findIndex((c) => c.id === right.id)) {
          return setAgentSay(
            `Clip ${parsed.index + 1} and clip ${parsed.rightIndex + 1} are not next to each other, so there is no join between them.`,
          );
        }
        if (!transitionDuration(left, right)) {
          return setAgentSay(`There is no crossfade between ${left.name} and ${right.name}.`);
        }
        recordHistory();
        setClips(setTransitionIn(clips, right.id, 0));
        setAgentSay(`Took the crossfade out between ${left.name} and ${right.name}.`);
        return;
      }
      case "remove-crossfade-all": {
        if (!clips.some((c) => c.transitionIn > 0)) {
          return setAgentSay("There are no crossfades to remove.");
        }
        recordHistory();
        setClips(clearAllTransitionsIn(clips));
        setAgentSay("Took all the crossfades out. The joins are straight cuts again.");
        return;
      }
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
      case "add-pip":
        pipInputRef.current?.click();
        setAgentSay("Pick a video file and I will add it as picture in picture at the playhead.");
        return;
      case "remove-pip":
        removePip();
        return;
      case "move-pip": {
        if (!selectedPip) {
          setAgentSay(
            pips.length
              ? "You have more than one picture in picture. Click the one you want to move first."
              : "There is no picture in picture yet. Add one first and then I can move it.",
          );
          return;
        }
        recordHistory();
        setPips((prev) => updatePipClip(prev, selectedPip.id, { position: parsed.position }));
        setAgentSay(
          pips.length > 1
            ? `Moved ${selectedPip.name} to the ${parsed.position.replace("-", " ")}.`
            : `Moved the picture in picture to the ${parsed.position.replace("-", " ")}.`,
        );
        return;
      }
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
    // The second video for the dissolve: it holds the other clip
    // in a join, frozen on its first or last frame, so the export
    // can blend the two pictures. It stays muted, the sound still
    // cuts at the join and only the picture dissolves.
    const blendVideo = document.createElement("video");
    blendVideo.muted = true;
    blendVideo.crossOrigin = "anonymous";
    // The picture in picture overlays, drawn on top of each frame
    // while they are on screen. Each one plays at the speed of
    // the clip underneath, the same as in the preview, and loops
    // when its file runs out before the overlay ends. These
    // elements stay muted: their sound comes through the export
    // audio mix, not through them.
    const pipVideos = pips.map((pip) => {
      const el = document.createElement("video");
      el.muted = true;
      el.loop = true;
      el.crossOrigin = "anonymous";
      el.src = pip.url;
      return el;
    });
    // Build the export audio mix: the clip sound runs through a gain
    // that follows each clip's volume and mute, the audio track mixes
    // in beside it, the picture in picture sound mixes in beside
    // that, and the music mixes in when there is any. Without
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
        pips,
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
    // Know each overlay file length before the frames start, so
    // the offset math can wrap when an overlay loops. Waiting
    // here costs nothing, the recording has not started yet.
    await Promise.all(pipVideos.map((el) => waitFor(el, "loadedmetadata")));
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
        // Line each overlay up with this clip before the frames
        // start, so the first frame it appears in is already the
        // right one. Each one plays from the offset the clip
        // starts at, at the clip speed, so it stays in step with
        // the main video through the clip. Waiting for the seek
        // to land first means the export never shows the frame
        // from before the seek.
        for (let i = 0; i < pips.length; i += 1) {
          const pip = pips[i];
          const pipVideo = pipVideos[i];
          if (pip.start < clipStart + clipLen && pip.start + pip.duration > clipStart) {
            const fileDuration =
              Number.isFinite(pipVideo.duration) && pipVideo.duration > 0 ? pipVideo.duration : undefined;
            const offset = pipFileOffset(pip, Math.max(clipStart, pip.start), fileDuration, packed);
            pipVideo.currentTime = fileDuration ? Math.min(offset, Math.max(0, fileDuration - 0.05)) : offset;
            await waitFor(pipVideo, "seeked");
            pipVideo.playbackRate = clip.speed;
            pipVideo.play().catch(() => {});
          } else {
            pipVideo.pause();
          }
        }
        // Line the dissolve up too. A clip on the left of a join
        // needs the next clip's first frame, a clip on the right
        // needs the previous clip's last frame. A clip in the
        // middle with a crossfade on both sides starts with the
        // next clip's frame and swaps to the previous one when
        // the second window opens, the frame loop below re-seeks
        // it then.
        const joinIndex = packed.findIndex((c) => c.id === clip.id);
        const leftNeighbour = joinIndex > 0 ? packed[joinIndex - 1] : null;
        const rightNeighbour = joinIndex < packed.length - 1 ? packed[joinIndex + 1] : null;
        const dissolveRight =
          rightNeighbour && transitionDuration(clip, rightNeighbour) > 0 ? rightNeighbour : null;
        const dissolveLeft =
          leftNeighbour && transitionDuration(leftNeighbour, clip) > 0 ? leftNeighbour : null;
        if (dissolveRight || dissolveLeft) {
          const other = dissolveRight || dissolveLeft;
          const frozen = dissolveRight ? other.sourceIn : other.sourceOut - 0.05;
          if (blendVideo.dataset.clip !== other.id) {
            blendVideo.dataset.clip = other.id;
            blendVideo.src = other.url;
            await waitFor(blendVideo, "loadedmetadata");
          }
          blendVideo.currentTime = Math.max(0, frozen);
          await waitFor(blendVideo, "seeked");
        }
        while (video.currentTime < clip.sourceOut - 0.05) {
          const t = clipStart + (video.currentTime - clip.sourceIn) / clip.speed;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          const vw = video.videoWidth || width;
          const vh = video.videoHeight || height;
          const scale = Math.max(width / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          // The dissolve over a join: draw the other clip in the
          // join first, frozen on its edge frame, then this clip
          // over it at its share of the dissolve. The other clip
          // gets its own colour effects, the same as the main one.
          let alpha = clipFadeOpacity(clip, t);
          const blend = crossfadeAtTime(packed, t);
          if (blend) {
            const other = clip.id === blend.left.id ? blend.right : blend.left;
            const frozen = clip.id === blend.left.id ? other.sourceIn : other.sourceOut - 0.05;
            if (blendVideo.dataset.clip !== other.id) {
              blendVideo.dataset.clip = other.id;
              blendVideo.src = other.url;
            }
            if (Math.abs(blendVideo.currentTime - frozen) > 0.3) {
              blendVideo.currentTime = Math.max(0, frozen);
            }
            const ow = blendVideo.videoWidth || width;
            const oh = blendVideo.videoHeight || height;
            const oscale = Math.max(width / ow, height / oh);
            const odw = ow * oscale;
            const odh = oh * oscale;
            const p = blend.progress;
            ctx.globalAlpha = clip.id === blend.left.id ? p : 1 - p;
            ctx.filter = clipFilter(other);
            ctx.drawImage(blendVideo, (width - odw) / 2, (height - odh) / 2, odw, odh);
            ctx.filter = "none";
            alpha = alpha * (clip.id === blend.left.id ? 1 - p : p);
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
          // Draw each picture in picture frame on top, when the
          // overlay is on screen at this point in the edit. If
          // one drifted from where it should be, seek it back,
          // the same way the preview does.
          for (let i = 0; i < pips.length; i += 1) {
            const pip = pips[i];
            const pipVideo = pipVideos[i];
            if (t >= pip.start && t < pip.start + pip.duration) {
              const fileDuration =
                Number.isFinite(pipVideo.duration) && pipVideo.duration > 0 ? pipVideo.duration : undefined;
              const offset = pipFileOffset(pip, t, fileDuration, packed);
              const seekTo = fileDuration ? Math.min(offset, Math.max(0, fileDuration - 0.05)) : offset;
              if (Math.abs(pipVideo.currentTime - seekTo) > 0.3) pipVideo.currentTime = seekTo;
              if (pipVideo.paused) {
                pipVideo.playbackRate = clip.speed;
                pipVideo.play().catch(() => {});
              }
              const rect = pipRect(pip, width, height);
              ctx.drawImage(pipVideo, rect.x, rect.y, rect.width, rect.height);
            } else if (!pipVideo.paused) {
              pipVideo.pause();
            }
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
      blendVideo.pause();
      for (const pipVideo of pipVideos) pipVideo.pause();
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
                <video
                  ref={transitionVideoRef}
                  className="transition-video"
                  muted
                  playsInline
                  preload="auto"
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
                {visiblePips.map((pip) => (
                  <video
                    key={pip.id}
                    ref={(el) => {
                      if (el) pipVideoElsRef.current.set(pip.id, el);
                      else pipVideoElsRef.current.delete(pip.id);
                    }}
                    className="pip-video"
                    loop
                    playsInline
                    preload="auto"
                    style={pipStyleFor(pip)}
                  />
                ))}
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
              {packed.map((clip, i) => (
                <Fragment key={clip.id}>
                  {i > 0 && (
                    <button
                      type="button"
                      className={`join-marker ${transitionDuration(packed[i - 1], clip) > 0 ? "on" : ""}`}
                      title={
                        transitionDuration(packed[i - 1], clip) > 0
                          ? `Crossfade of ${transitionDuration(packed[i - 1], clip)} seconds between ${packed[i - 1].name} and ${clip.name}. Click to take it out.`
                          : `Straight cut between ${packed[i - 1].name} and ${clip.name}. Click to add a crossfade.`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleJoin(packed[i - 1], clip);
                      }}
                    >
                      {transitionDuration(packed[i - 1], clip) > 0
                        ? `${transitionDuration(packed[i - 1], clip).toFixed(1)}s`
                        : "+"}
                    </button>
                  )}
                  <div
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
                </Fragment>
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
            <p className="track-label">Picture in picture</p>
            <div className="pip-track">
              {pips.length === 0 && <p className="track-empty">Add a second video and it will show up here.</p>}
              {pips.map((pip) => (
                <div
                  key={pip.id}
                  className={`pip-block ${selectedPipId === pip.id ? "selected" : ""}`}
                  style={{
                    left: total > 0 ? `calc(6px + (100% - 12px) * ${pip.start / total})` : "6px",
                    width: total > 0 ? `calc((100% - 12px) * ${pip.duration / total})` : "0px",
                  }}
                  onClick={() => {
                    setSelectedPipId(pip.id);
                    seek(pip.start);
                  }}
                >
                  <div className="clip-name">{pip.name}</div>
                  <div className="clip-meta">
                    {formatTime(pip.duration)} · {pip.position.replace("-", " ")} · {pip.size}
                    {pip.muted ? " · muted" : ""}
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
                {nextClip && (
                  <>
                    <label>
                      Crossfade to the next clip:{" "}
                      {transitionDuration(selected, nextClip) > 0
                        ? `${transitionDuration(selected, nextClip).toFixed(1)}s`
                        : "off"}
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={transitionDuration(selected, nextClip)}
                        onChange={(e) => updateClip(nextClip.id, { transitionIn: parseFloat(e.target.value) })}
                      />
                    </label>
                    <p className="hint">
                      0 is a straight cut. The dissolve never runs longer than the shorter of the two clips.
                    </p>
                  </>
                )}
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
            <h2>Picture in picture</h2>
            <input
              type="file"
              accept="video/*"
              ref={pipInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                importPip(e.target.files);
                e.target.value = "";
              }}
            />
            {pips.length ? (
              <>
                <p className="hint">
                  {pips.length === 1
                    ? "One overlay on the timeline. Add another and they stack, each in its own corner."
                    : `${pips.length} overlays on the timeline. Click one below to change it.`}
                </p>
                {pips.map((pip) => (
                  <div className="overlay-row" key={pip.id}>
                    <span>
                      {pip.name} · {formatTime(pip.start)} to {formatTime(pip.start + pip.duration)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPipId(pip.id);
                        seek(pip.start);
                      }}
                    >
                      {selectedPipId === pip.id ? "Selected" : "Select"}
                    </button>
                  </div>
                ))}
                {selectedPip ? (
                  <>
                    <p>
                      <strong>{selectedPip.name}</strong>
                    </p>
                    <p className="hint">
                      {formatTime(selectedPip.start)} to {formatTime(selectedPip.start + selectedPip.duration)} on
                      the timeline. Click the clip on the picture in picture track to jump to it.
                    </p>
                    <label>
                      Corner
                      <select
                        value={selectedPip.position}
                        onChange={(e) => {
                          recordHistory();
                          setPips((prev) => updatePipClip(prev, selectedPip.id, { position: e.target.value }));
                        }}
                      >
                        {PIP_POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {p.replace("-", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Size
                      <select
                        value={selectedPip.size}
                        onChange={(e) => {
                          recordHistory();
                          setPips((prev) => updatePipClip(prev, selectedPip.id, { size: e.target.value }));
                        }}
                      >
                        {Object.keys(PIP_SIZES).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Volume: {selectedPip.muted ? "muted" : `${Math.round(selectedPip.volume * 100)}%`}
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedPip.volume}
                        onChange={(e) => {
                          recordSliderHistory();
                          setPips((prev) => setPipClipVolume(prev, selectedPip.id, parseFloat(e.target.value)));
                        }}
                      />
                    </label>
                    <div className="row">
                      <button
                        type="button"
                        onClick={() => {
                          recordHistory();
                          setPips((prev) => togglePipClipMuted(prev, selectedPip.id));
                        }}
                      >
                        {selectedPip.muted ? "Unmute overlay" : "Mute overlay"}
                      </button>
                      <button type="button" onClick={() => pipInputRef.current?.click()}>
                        Add another video
                      </button>
                      <button type="button" onClick={removePip}>
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="hint">Click an overlay above to change its corner, size or volume.</p>
                )}
              </>
            ) : (
              <>
                <p className="hint">
                  Add a second video and it will sit in a corner of the frame, in time with the preview and baked into
                  the export. Add as many as you like, each one keeps its own corner.
                </p>
                <button type="button" className="primary" onClick={() => pipInputRef.current?.click()}>
                  Add picture in picture
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
