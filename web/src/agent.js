// agent.js: the agent bar. Rule-based intent parsing, no keys, no
// backend. Every command returns a plain description of the edit it
// wants, and the app applies it to the real timeline.
//
// parseCommand(text, context) returns one of:
//   { kind: "remove-silences" }
//   { kind: "cut-boring-parts" }
//   { kind: "add-captions" }
//   { kind: "cut-first", seconds }
//   { kind: "cutdown", seconds }
//   { kind: "make-vertical" } | { kind: "make-horizontal" }
//   { kind: "speed-all", factor }
//   { kind: "split-at", seconds }
//   { kind: "delete-clip", index }
//   { kind: "add-text", text, start, end }
//   { kind: "mute" } | { kind: "set-volume", volume }
//   { kind: "mute-clip", index } | { kind: "unmute-clip", index }
//   { kind: "set-clip-volume", volume, index }
//   { kind: "adjust-clip-volume", delta, index }
// "mute this clip" and "set the volume to 50%" act on one clip:
// the selected clip, or "clip 2" when a number is given. A plain
// "mute it" or "set volume to 50%" still hits every clip.
//   { kind: "fade-all", seconds }
//   { kind: "add-music" }
//   { kind: "remove-music" }
//   { kind: "set-music-volume", volume }
//   { kind: "mute-audio-track" } | { kind: "unmute-audio-track" }
//   { kind: "set-audio-track-volume", volume }
//   { kind: "remove-audio-track" }
//   { kind: "set-effect", effect, mode, value, scope }
//   { kind: "reset-effects", scope }
//   { kind: "add-pip" }
//   { kind: "remove-pip" }
//   { kind: "move-pip", position }
// "add picture in picture" opens the file picker, since the app
// needs a video file to use as the overlay. "move the picture in
// picture to the top left" takes one of the four corners.
//   { kind: "unknown", text }
//
// context is { clipCount, duration } so the parser can sanity check
// numbers before the app does any work.

function num(text) {
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function parseCommand(rawText, context = {}) {
  const text = rawText.trim().toLowerCase();
  if (!text) return { kind: "unknown", text: rawText };

  if (/silence/.test(text) && /remov|cut|delete|drop|get rid/.test(text)) {
    return { kind: "remove-silences" };
  }

  // "cut the boring parts", "remove the boring bits",
  // "cut out the dead air", "tighten it up".
  if (/boring|dead air|tighten/.test(text) && /cut|remov|drop|get rid|tighten/.test(text)) {
    return { kind: "cut-boring-parts" };
  }

  if (/caption/.test(text) && /add|generate|create|transcri/.test(text)) {
    return { kind: "add-captions" };
  }

  if (/vertical/.test(text) || /9:16/.test(text) || /portrait/.test(text) || /for (tiktok|reels|shorts)/.test(text)) {
    return { kind: "make-vertical" };
  }
  if (/horizontal/.test(text) || /16:9/.test(text) || /landscape/.test(text) || /for youtube/.test(text)) {
    return { kind: "make-horizontal" };
  }

  // "make a 30 second cutdown", "make a 60 second version",
  // "cut it down to 30 seconds".
  const cutdownMatch =
    text.match(/make (?:a )?(\d+(?:\.\d+)?)\s*(?:second|sec|s)\b.{0,12}(?:cutdown|cut|version|clip)/) ||
    text.match(/cut (?:it |this |the video )?down to (\d+(?:\.\d+)?)\s*(?:second|sec|s)/);
  if (cutdownMatch) {
    return { kind: "cutdown", seconds: parseFloat(cutdownMatch[1]) };
  }

  const cutFirst = text.match(/cut (?:the )?first (\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s\b)/);
  if (cutFirst) {
    return { kind: "cut-first", seconds: parseFloat(cutFirst[1]) };
  }

  const speedUp = text.match(/speed (?:it |the (?:whole )?(?:thing|video) )?up/);
  const speedDown = text.match(/slow (?:it |the (?:whole )?(?:thing|video) )?down/);
  const speedTo = text.match(/speed (?:it |the (?:whole )?(?:thing|video) )?(?:to|at) (\d+(?:\.\d+)?)x/);
  if (speedTo) {
    return { kind: "speed-all", factor: parseFloat(speedTo[1]) };
  }
  if (speedUp) {
    const f = num(text.replace(/speed (?:it |the (?:whole )?(?:thing|video) )?up/, ""));
    return { kind: "speed-all", factor: f || 1.5 };
  }
  if (speedDown) {
    return { kind: "speed-all", factor: 0.75 };
  }

  const splitAt = text.match(/split (?:at|around) (\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s\b)?/);
  if (splitAt) {
    return { kind: "split-at", seconds: parseFloat(splitAt[1]) };
  }

  const deleteClip = text.match(/delete clip (\d+)/);
  if (deleteClip) {
    return { kind: "delete-clip", index: parseInt(deleteClip[1], 10) - 1 };
  }
  if (/delete (?:this|the) clip/.test(text)) {
    return { kind: "delete-clip", index: context.selectedIndex ?? 0 };
  }

  const addText = rawText.match(/add (?:text|title|words?)[ "“'](.+?)[ "”']?(?: from (\d+(?:\.\d+)?) ?(?:s|seconds?)? ?(?:to|-) ?(\d+(?:\.\d+)?))?\s*$/i);
  if (addText) {
    return {
      kind: "add-text",
      text: addText[1].trim(),
      start: addText[2] ? parseFloat(addText[2]) : 0,
      end: addText[3] ? parseFloat(addText[3]) : null,
    };
  }

  if (/picture in picture/.test(text)) {
    if (/remov|delete|drop|get rid|take .* out/.test(text)) {
      return { kind: "remove-pip" };
    }
    const move = text.match(/to the (top left|top right|bottom left|bottom right)/);
    if (/move/.test(text) && move) {
      return { kind: "move-pip", position: move[1].replace(" ", "-") };
    }
    if (/add/.test(text)) {
      return { kind: "add-pip" };
    }
  }

  if (/add (?:some |a |the )?music/.test(text) || /add (?:a |some )?song/.test(text)) {
    return { kind: "add-music" };
  }

  if (/music/.test(text) && /remov|take .* out|delete|drop|get rid/.test(text)) {
    return { kind: "remove-music" };
  }

  const musicVolume = text.match(/music volume (?:to )?(\d{1,3})\s*(?:%|percent)?/);
  if (musicVolume) {
    return { kind: "set-music-volume", volume: Math.min(100, parseInt(musicVolume[1], 10)) / 100 };
  }
  if (/turn the music down/.test(text) || /music (?:quieter|down)/.test(text)) {
    return { kind: "set-music-volume", volume: 0.25 };
  }
  if (/turn the music up/.test(text) || /music (?:louder|up)/.test(text)) {
    return { kind: "set-music-volume", volume: 0.75 };
  }

  // The audio track: "mute the audio track", "unmute the audio
  // track", "set the audio track volume to 50%", "remove the audio
  // track". These come before the clip mute rules below, so "mute
  // the audio track" does not read as muting a video clip. Unmute
  // is checked first because it contains "mute".
  if (/audio track/.test(text)) {
    if (/unmute/.test(text)) {
      return { kind: "unmute-audio-track" };
    }
    if (/mute/.test(text)) {
      return { kind: "mute-audio-track" };
    }
    if (/remov|delete|drop|get rid|take .* out/.test(text)) {
      return { kind: "remove-audio-track" };
    }
    const audioVolume = text.match(/volume (?:to )?(\d{1,3})\s*(?:%|percent)?/);
    if (audioVolume) {
      return { kind: "set-audio-track-volume", volume: Math.min(100, parseInt(audioVolume[1], 10)) / 100 };
    }
  }

  // Per-clip mute and volume. "mute this clip", "unmute clip 2",
  // "set the volume to 50%", "turn the volume down". With no clip
  // named, the selected clip is the target, so index -1 means
  // "whichever clip is selected" and the app sorts it out.
  const clipTarget = text.match(/(?:this|the selected|that) clip/) ||
    text.match(/clip (\d+)/);
  const clipIndex = clipTarget
    ? clipTarget[1]
      ? parseInt(clipTarget[1], 10) - 1
      : context.selectedIndex ?? -1
    : null;
  if (/unmute/.test(text) && clipIndex !== null) {
    return { kind: "unmute-clip", index: clipIndex };
  }
  if (/mute/.test(text) && clipIndex !== null) {
    return { kind: "mute-clip", index: clipIndex };
  }
  const clipVolume = text.match(
    /set (?:the volume|this clip'?s volume|the volume of (?:this|the selected|that) clip|clip (\d+) volume|the volume of clip (\d+)) to (\d{1,3})\s*(?:%|percent)?/,
  );
  if (clipVolume) {
    const named = clipVolume[1] ? parseInt(clipVolume[1], 10) - 1 : clipVolume[2] ? parseInt(clipVolume[2], 10) - 1 : null;
    return {
      kind: "set-clip-volume",
      volume: Math.min(100, parseInt(clipVolume[3], 10)) / 100,
      index: named ?? context.selectedIndex ?? -1,
    };
  }
  const turnVolume = text.match(/turn (?:the volume|this clip'?s volume|the volume of (?:this|the selected|that) clip) (up|down)(?: (\d{1,3})\s*(?:%|percent)?)?/);
  if (turnVolume) {
    const step = turnVolume[2] ? parseInt(turnVolume[2], 10) / 100 : 0.25;
    return {
      kind: "adjust-clip-volume",
      delta: turnVolume[1] === "down" ? -step : step,
      index: context.selectedIndex ?? -1,
    };
  }

  // A bare "unmute it" means the selected clip, not every clip.
  if (/unmute/.test(text)) {
    return { kind: "unmute-clip", index: clipIndex ?? context.selectedIndex ?? -1 };
  }

  if (/mute/.test(text)) {
    return { kind: "mute" };
  }
  const volume = text.match(/(?:set |turn )?volume (?:to )?(\d{1,3})\s*(?:%|percent)?/);
  if (volume) {
    return { kind: "set-volume", volume: Math.min(100, parseInt(volume[1], 10)) / 100 };
  }

  const fade = text.match(/add (?:a )?fade(?:s)?(?: of (\d+(?:\.\d+)?) ?(?:s|seconds?)?)?/);
  if (fade) {
    return { kind: "fade-all", seconds: fade[1] ? parseFloat(fade[1]) : 0.5 };
  }

  // Colour effects: "make it brighter", "more contrast",
  // "turn the saturation down", "set brightness to 150%".
  // A plain word moves the value 20 points, a number sets the step.
  // "all clips", "every clip" or "the whole thing" targets every
  // clip, otherwise the selected one.
  const scope = /all clips|every clip|the whole (?:thing|video)|everything/.test(text) ? "all" : "selected";
  if (/reset (?:the )?(colou?rs?|effects?)/.test(text)) {
    return { kind: "reset-effects", scope };
  }
  let effect = null;
  if (/bright|dark/.test(text)) effect = "brightness";
  else if (/contrast/.test(text)) effect = "contrast";
  else if (/saturat/.test(text)) effect = "saturation";
  if (effect) {
    const setMatch = text.match(/(?:set|make) (?:the )?(\w+)(?: to)? (\d+)\s*(?:%|percent)?/);
    if (setMatch && setMatch[1] === effect) {
      return { kind: "set-effect", effect, mode: "set", value: Math.min(200, parseInt(setMatch[2], 10)), scope };
    }
    const down = /darker|dimmer|\bdown\b|less|lower|decreas|reduc/.test(text);
    const stepMatch = text.match(/(\d+)\s*(?:%|percent)/);
    const step = stepMatch ? parseInt(stepMatch[1], 10) : 20;
    return { kind: "set-effect", effect, mode: "delta", value: down ? -step : step, scope };
  }

  return { kind: "unknown", text: rawText };
}

// One line of help the bar can show when it does not understand.
export const EXAMPLE_COMMANDS = [
  "remove the silences",
  "cut the boring parts",
  "add captions",
  "cut the first 5 seconds",
  "make a 30 second cutdown",
  "make it vertical",
  "speed the whole thing up",
  "split at 10 seconds",
  "add text hello world from 2 to 5",
  "mute it",
  "mute this clip",
  "set the volume to 50%",
  "mute the audio track",
  "make it brighter",
  "add music",
  "add picture in picture",
];
