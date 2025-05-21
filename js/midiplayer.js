import {
  playSound,
  stopSound,
  soundSettings,
  stopPolyCelloNote,
  loadAudioFilesForSound,
} from "./audiomanager.js";

import { availableSounds } from "./utils/constants.js";

let previousTriggerKey = null;

let currentMidi = null;
let pianoTarget = null;
let startTime = 0;
let pauseTime = 0;
let isPlaying = false;

let scheduledEvents = [];
let activeNotes = new Set();

let audioCtx = null;
let globalVelocityMultiplier = 1.0;

let manualPlayMode = false;
let manualTimeIndex = 0;
let manualTimeList = [];

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function parseMidiFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const data = new Uint8Array(e.target.result);
      const midi = new Midi(data);
      resolve(midi);
    };
    reader.readAsArrayBuffer(file);
  });
}

function playMidi(midi, pianoId) {
  stopMidiPlayback();
  initAudioContext();

  currentMidi = midi;
  pianoTarget = pianoId;
  isPlaying = true;
  startTime = audioCtx.currentTime;
  pauseTime = 0;

  scheduledEvents = [];
  activeNotes.clear();

  prepareManualTimeList();
  scheduleAllNotes();
}

function scheduleAllNotes() {
  const whenStart = startTime;

  currentMidi.tracks.forEach((track) => {
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound = availableSounds.find(s => inst.includes(s.toLowerCase())) || "piano";

    track.notes.forEach((note) => {
      const noteStart = note.time + whenStart;
      const noteEnd = note.time + note.duration + whenStart;
      const midiNumber = note.midi;
      const velocity = note.velocity * 127;
      const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);

      const onId = scheduleAt(noteStart, () => {
        if (!isPlaying) return;
        stopSound(midiNumber, pianoTarget, matchedSound);
        playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
        activeNotes.add(midiNumber);
        const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
        if (keyEl) keyEl.classList.add("pressed");
      });

      const offId = scheduleAt(noteEnd, () => {
        stopSound(midiNumber, pianoTarget, matchedSound);
        activeNotes.delete(midiNumber);
        const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
        if (keyEl) keyEl.classList.remove("pressed");
      });

      scheduledEvents.push(onId, offId);
    });
  });
}

function scheduleAt(timeInAudioCtx, callback) {
  const delay = Math.max(0, (timeInAudioCtx - audioCtx.currentTime) * 1000);
  return setTimeout(callback, delay);
}

function scheduleRemainingNotes() {
  const now = audioCtx.currentTime;
  const whenStart = startTime;

  currentMidi.tracks.forEach((track) => {
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound = availableSounds.find(s => inst.includes(s.toLowerCase())) || "piano";

    track.notes.forEach((note) => {
      const noteStart = note.time + whenStart;
      const noteEnd = note.time + note.duration + whenStart;

      if (noteEnd <= now || noteStart < now) return;

      const midiNumber = note.midi;
      const velocity = note.velocity * 127;
      const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);

      const onId = scheduleAt(noteStart, () => {
        if (!isPlaying) return;
        stopSound(midiNumber, pianoTarget, matchedSound);
        playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
        activeNotes.add(midiNumber);
        const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
        if (keyEl) keyEl.classList.add("pressed");
      });

      const offId = scheduleAt(noteEnd, () => {
        stopSound(midiNumber, pianoTarget, matchedSound);
        activeNotes.delete(midiNumber);
        const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
        if (keyEl) keyEl.classList.remove("pressed");
      });

      scheduledEvents.push(onId, offId);
    });
  });
}

function stopMidiPlayback() {
  isPlaying = false;
  scheduledEvents.forEach(clearTimeout);
  scheduledEvents = [];

  for (const note of activeNotes) {
    ["piano", "violin", "cello", "Trombone"].forEach(sound => {
      const sustain = ["cello", "violin", "Trombone"].includes(sound);
      if (sustain) {
        stopPolyCelloNote(note, pianoTarget);
      } else {
        stopSound(note, pianoTarget, sound);
      }
    });
    const keyEl = document.querySelector(`#${pianoTarget} [data-number="${note}"]`);
    if (keyEl) keyEl.classList.remove("pressed");
  }
  activeNotes.clear();
}

function pauseMidiPlayback() {
  if (!isPlaying) return;
  pauseTime = audioCtx.currentTime - startTime;
  stopMidiPlayback();
}

function resumeMidiPlayback() {
  if (!currentMidi || isPlaying) return;
  isPlaying = true;
  startTime = audioCtx.currentTime - pauseTime;
  scheduledEvents = [];
  activeNotes.clear();
  scheduleRemainingNotes();
}

function setGlobalVelocityMultiplier(multiplier) {
  globalVelocityMultiplier = multiplier;
}

function setMidiProgress(percent) {
  if (!currentMidi) return;
  const maxTime = Math.max(
    ...currentMidi.tracks.flatMap((t) => t.notes.map((n) => n.time + n.duration))
  );
  pauseTime = maxTime * percent;
  resumeMidiPlayback();
}

function prepareManualTimeList() {
  if (!currentMidi) return;
  manualTimeIndex = 0;
  manualTimeList = [];
  const times = new Set();
  currentMidi.tracks.forEach((track) => {
    track.notes.forEach((note) => times.add(note.time));
  });
  manualTimeList = Array.from(times).sort((a, b) => a - b);
}

function manualPlayNextNote(velocity, triggeringNote) {
  if (!currentMidi || !pianoTarget) return;

  if (manualTimeList.length === 0) prepareManualTimeList();

  if (manualTimeIndex >= manualTimeList.length) {
    manualTimeIndex = 0;
    for (let midiNumber = 21; midiNumber <= 108; midiNumber++) {
      ["piano", "violin", "cello", "Trombone"].forEach(sound => {
        const sustain = ["cello", "violin", "Trombone"].includes(sound);
        if (sustain) {
          stopPolyCelloNote(midiNumber, pianoTarget);
        } else {
          stopSound(midiNumber, pianoTarget, sound);
        }
        const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
        if (keyEl) keyEl.classList.remove("pressed");
      });
    }
  }

  const targetTime = manualTimeList[manualTimeIndex];
  const previousTime = manualTimeList[manualTimeIndex - 1];
  manualTimeIndex++;

  const notesToPlay = [], notesToEnd = [];
  currentMidi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      if (note.time === targetTime) notesToPlay.push({ note, track });
      if ((note.time + note.duration) <= targetTime && (note.time + note.duration) >= previousTime) notesToEnd.push({ note, track });
    });
  });

  notesToEnd.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound = availableSounds.find(s => inst.includes(s.toLowerCase())) || "piano";
    const sustain = ["cello", "violin", "Trombone"].includes(matchedSound);
    if (sustain) {
      stopPolyCelloNote(midiNumber, pianoTarget);
    } else {
      stopSound(midiNumber, pianoTarget, matchedSound);
    }
    const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
    if (keyEl) keyEl.classList.remove("pressed");
  });

  notesToPlay.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound = availableSounds.find(s => inst.includes(s.toLowerCase())) || "piano";
    const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);
    playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
    const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
    if (keyEl) keyEl.classList.add("pressed");
  });

  previousTriggerKey = triggeringNote;
}

function stopManualNotes() {
  const targetTime = manualTimeList[manualTimeIndex];
  const previousTime = manualTimeList[manualTimeIndex - 1];
  const notesToEnd = [];
  currentMidi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      if ((note.time + note.duration) <= targetTime && (note.time + note.duration) >= previousTime) notesToEnd.push({ note, track });
    });
  });

  notesToEnd.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound = availableSounds.find(s => inst.includes(s.toLowerCase())) || "piano";
    const sustain = ["cello", "violin", "Trombone"].includes(matchedSound);
    if (sustain) {
      stopPolyCelloNote(midiNumber, pianoTarget);
    } else {
      stopSound(midiNumber, pianoTarget, matchedSound);
    }
    const keyEl = document.querySelector(`#${pianoTarget} [data-number="${midiNumber}"]`);
    if (keyEl) keyEl.classList.remove("pressed");
  });
}

function setManualTriggerKey(note) {
  previousTriggerKey = note;
}
function getManualTriggerKey() {
  return previousTriggerKey;
}
function setManualPlayMode(mode) {
  manualPlayMode = mode;
  if (manualPlayMode && currentMidi) prepareManualTimeList();
}
function isManualPlayMode() {
  return manualPlayMode;
}

async function setCurrentMidiAndTarget(midi, pianoId) {
  currentMidi = midi;
  pianoTarget = pianoId;
  prepareManualTimeList();

  const instrumentToSound = new Map();
  const soundsToLoad = new Set();

  midi.tracks.forEach((track) => {
    const instName = track.instrument?.name?.toLowerCase() || "";
    const matched = availableSounds.find(s => instName.includes(s.toLowerCase())) || "piano";
    instrumentToSound.set(instName, matched);
    soundsToLoad.add(matched);
  });

  for (const sound of soundsToLoad) {
    await loadAudioFilesForSound(pianoId, sound);
  }

  const firstTrack = midi.tracks[0];
  const firstInst = firstTrack.instrument?.name?.toLowerCase() || "";
  const firstSound = instrumentToSound.get(firstInst) || "piano";

  if (!soundSettings[pianoId]) {
    soundSettings[pianoId] = {
      sound: firstSound,
      volume: 1.5,
      sustain: ["cello", "violin", "Trombone"].includes(firstSound),
    };
  } else {
    soundSettings[pianoId].sound = firstSound;
    soundSettings[pianoId].sustain = ["cello", "violin", "Trombone"].includes(firstSound);
  }

  const selectEl = document.getElementById(`sound-select-${pianoId}`);
  if (selectEl) selectEl.value = firstSound;

  console.log(`🎵 已載入以下音色: ${Array.from(soundsToLoad).join(", ")}`);
}

export {
  parseMidiFile,
  playMidi,
  stopMidiPlayback,
  pauseMidiPlayback,
  resumeMidiPlayback,
  setMidiProgress,
  setGlobalVelocityMultiplier,
  manualPlayNextNote,
  setManualPlayMode,
  isManualPlayMode,
  setCurrentMidiAndTarget,
  stopManualNotes,
  setManualTriggerKey,
  getManualTriggerKey,
  stopPolyCelloNote,
};
