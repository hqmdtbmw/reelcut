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
//   { kind: "fade-all", seconds }
//   { kind: "add-music" }
//   { kind: "remove-music" }
//   { kind: "set-music-volume", volume }
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
  "add music",
];
