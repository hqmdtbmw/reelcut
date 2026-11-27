# reelcut

The video editor that edits itself.

I kept watching friends open a video editor, stare at the timeline, and close it again. The tools are powerful but they ask a lot from you before you get anything done. reelcut is my answer to that: import a video, tell it what you want in plain words, and it does the edit. No account, no subscription, no feature locked behind a paywall. Everything CapCut charges for is in here for free: silence removal, captions, speed, fades, text, vertical export.

## What it is

- A web app you open in your browser. Import clips, preview, trim, split, reorder, add text and captions, change speed and volume, add fades, fix the colours, then export a video file.
- An agent bar. Type "remove the silences" or "make it vertical" and the timeline changes. It tells you what it did in plain words.
- A Rust core (`core/`) that holds the timeline engine: trim, split, delete, reorder, speed, silence detection, caption timing. The same core is compiled to WebAssembly for the browser and will drive the Linux, Windows and iOS shells later.

## How to run it

You need Node 20 or newer and a Rust toolchain.

```bash
# web app
cd web
npm install
npm run dev
```

Open http://localhost:5173. Import a video file and start editing. To build the production version:

```bash
cd web
npm run build
npm run preview
```

To run the Rust core tests:

```bash
cd core
cargo test
```

To rebuild the WebAssembly module after changing the Rust code:

```bash
cd core
wasm-pack build --target web --out-dir ../web/src/wasm --out-name reelcut-core
```

## What works now

- Import one or more video files, preview with play and pause.
- Timeline with trim by dragging clip edges, split at the playhead, delete, reorder, speed, volume, fade in and out. Every clip has its own volume from 0 to 100 percent and a mute toggle in the clip panel, and muting keeps the volume so unmuting brings it straight back. The timeline shows "muted" on a muted clip.
- Undo and redo for every timeline edit, with buttons by the timeline and keyboard shortcuts: Space plays or pauses, S splits at the playhead, Delete removes the selected clip, Ctrl+Z undoes, Ctrl+Shift+Z redoes. The shortcuts stay quiet while you type in a field.
- Text overlays with position and timing, captions you can type or dictate while the video plays (Chrome only).
- Agent bar: remove the silences, cut the boring parts, add captions, cut the first seconds, make a 30 second cutdown, make it vertical or horizontal, speed the whole thing up or down, split at a time, delete a clip, add text, mute, set volume, add fades, add music. Volume and mute work per clip too: "mute this clip", "unmute clip 2", "set the volume to 50%", "turn the volume down". A plain "mute it" or "set volume to 50%" still hits every clip. The audio track has its own commands too: "mute the audio track", "unmute the audio track", "set the audio track volume to 50%", "remove the audio track".
- Background music: pick an audio file and it plays under your video while you preview, looping to fill the edit. You can change its volume or take it out, and the export mixes it in with the clip audio.
- A separate audio track under the video track. Add voiceover, sound effects or a second music bed, each clip landing at the playhead. Click a clip on the track to change its volume or mute it. The clips play in time with the preview and the export mixes them in with the clip audio and the background music. When you remove silences, cut the boring parts, make a cutdown or speed the whole edit up or down, the audio track moves with the edit, so a voiceover stays lined up with the video. I move it the same way when you change one clip's speed. The voiceover also plays at the speed of the video clip under the playhead, in preview and in export, so speeding a clip up no longer cuts the words off halfway through. A short clip loops to fill its slot when the stretch under it is sped up, so it keeps playing for its full length instead of going quiet. A clip trimmed from the left picks up partway through its file now, instead of starting over from the beginning. When a cut lands in the middle of a voiceover clip, the clip splits there too, so the part after the cut picks up where the words left off instead of playing straight across the join.
- Colour controls on every clip: brightness, contrast and saturation from 0 to 200 percent, 100 is untouched. You see them live in the preview and they are baked into the export. Tell the agent "make it brighter" or "turn the saturation down" and it changes the selected clip, or all of them if you say so.
- Silence removal reads the real audio of your clips, finds the quiet stretches with the Rust core (WebAssembly when it loads, JavaScript mirror otherwise), and cuts them out.
- Cutting the boring parts uses your captions: it finds the gaps longer than 3 seconds where nobody says anything and cuts them out, leaving half a second of breathing room on each side. Your captions and text overlays move with the cuts.
- Export renders the full sequence to a webm file through canvas and MediaRecorder, with overlays, captions, fades, per-clip volume and mute, and audio. The clip audio is in the export whether or not you added background music.
- Vertical 9:16 and horizontal 16:9 output.

## What is next

- Auto captions from the audio itself, on device, instead of dictation.
- Native shells for Linux, Windows and iOS using the same Rust core.
- A second video track, so you can layer picture in picture on top of the main track. The audio track is in, the video track is still to come.

## What it can't do yet

- Export is webm (VP9/Opus). MP4 export needs a native encoder and comes with the desktop shell.
- Caption dictation listens through your microphone while the video plays, so it needs a quiet room and only works in Chrome. Typed captions work everywhere.
- Silence removal needs an audio track in the clip. A clip with no audio has nothing to remove.
- Cutting the boring parts needs captions, so it knows where nobody is talking. Without captions, remove the silences works from the audio instead.
- Everything runs on your machine. Large files use a lot of memory while exporting.
- Background music plays at normal speed even when a clip is sped up, since it is a bed under the edit, not a voice tied to a clip.
- The editor is a first version. It handles one video track and one audio track, which is enough for most short videos, but it is not a replacement for a full multi-track suite yet.

## Contributing

See CONTRIBUTING.md. Short version: fork it, make the change, add a test, open a pull request. Every change gets reviewed by a human.

## License

MIT. See LICENSE.
