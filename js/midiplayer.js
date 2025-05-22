// scrolling-midiplayer.js - 配合滾動窗口的 MIDI 播放器
import {
  playSound,
  stopSound,
  soundSettings,
  stopPolyCelloNote,
  loadAudioFilesForSound,
} from "./audiomanager.js";

import { availableSounds } from "./utils/constants.js";

// 導入滾動窗口視覺化系統
import {
  preloadNotes,
  triggerNextTime,
  resetToStart,
  seekToProgress,
  setAnalysisData,
  WINDOW_SIZE,
} from "./visualizer.js";

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

// 手動播放模式變數
let manualPlayMode = false;
let manualTimeIndex = 0;
let manualTimeList = [];

// 當前分析數據
let currentAnalysisData = null;

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

  // 🌟 新增：自動播放時重置視覺化到開始位置
  manualTimeIndex = 0;
  resetToStart();

  scheduleAllNotes();
}

function scheduleAllNotes() {
  const whenStart = startTime;

  currentMidi.tracks.forEach((track) => {
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound =
      availableSounds.find((s) => inst.includes(s.toLowerCase())) || "piano";

    track.notes.forEach((note) => {
      const noteStart = note.time + whenStart;
      const noteEnd = note.time + note.duration + whenStart;
      const midiNumber = note.midi;
      const velocity = note.velocity * 127;
      const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);

      const onId = scheduleAt(noteStart, () => {
        if (!isPlaying) return;

        // 🌟 新增：自動播放時也觸發視覺化效果
        const currentPlayTime = audioCtx.currentTime - startTime;
        triggerVisualizationAtTime(currentPlayTime);

        stopSound(midiNumber, pianoTarget, matchedSound);
        playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
        activeNotes.add(midiNumber);

        const keyEl = document.querySelector(
          `#${pianoTarget} [data-number="${midiNumber}"]`
        );
        if (keyEl) keyEl.classList.add("pressed");
      });

      const offId = scheduleAt(noteEnd, () => {
        stopSound(midiNumber, pianoTarget, matchedSound);
        activeNotes.delete(midiNumber);
        const keyEl = document.querySelector(
          `#${pianoTarget} [data-number="${midiNumber}"]`
        );
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

function stopMidiPlayback() {
  isPlaying = false;
  scheduledEvents.forEach(clearTimeout);
  scheduledEvents = [];

  for (const note of activeNotes) {
    ["piano", "violin", "cello", "Trombone"].forEach((sound) => {
      const sustain = ["cello", "violin", "Trombone"].includes(sound);
      if (sustain) {
        stopPolyCelloNote(note, pianoTarget);
      } else {
        stopSound(note, pianoTarget, sound);
      }
    });
    const keyEl = document.querySelector(
      `#${pianoTarget} [data-number="${note}"]`
    );
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

function scheduleRemainingNotes() {
  const now = audioCtx.currentTime;
  const whenStart = startTime;

  currentMidi.tracks.forEach((track) => {
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound =
      availableSounds.find((s) => inst.includes(s.toLowerCase())) || "piano";

    track.notes.forEach((note) => {
      const noteStart = note.time + whenStart;
      const noteEnd = note.time + note.duration + whenStart;

      if (noteEnd <= now || noteStart < now) return;

      const midiNumber = note.midi;
      const velocity = note.velocity * 127;
      const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);

      const onId = scheduleAt(noteStart, () => {
        if (!isPlaying) return;

        // 🌟 新增：自動播放時也觸發視覺化效果
        const currentPlayTime = audioCtx.currentTime - startTime;
        triggerVisualizationAtTime(currentPlayTime);

        stopSound(midiNumber, pianoTarget, matchedSound);
        playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
        activeNotes.add(midiNumber);

        const keyEl = document.querySelector(
          `#${pianoTarget} [data-number="${midiNumber}"]`
        );
        if (keyEl) keyEl.classList.add("pressed");
      });

      const offId = scheduleAt(noteEnd, () => {
        stopSound(midiNumber, pianoTarget, matchedSound);
        activeNotes.delete(midiNumber);
        const keyEl = document.querySelector(
          `#${pianoTarget} [data-number="${midiNumber}"]`
        );
        if (keyEl) keyEl.classList.remove("pressed");
      });

      scheduledEvents.push(onId, offId);
    });
  });
}

// 觸發視覺化效果的函數
function triggerVisualizationAtTime(currentPlayTime) {
  if (!manualTimeList || manualTimeList.length === 0) return;

  // 找到最接近當前播放時間的時間點索引
  let closestIndex = -1;
  let minDistance = Infinity;

  for (let i = 0; i < manualTimeList.length; i++) {
    const distance = Math.abs(manualTimeList[i] - currentPlayTime);
    if (distance < minDistance && distance < 0.1) {
      // 容忍0.1秒的誤差
      minDistance = distance;
      closestIndex = i;
    }
  }

  // 如果找到匹配的時間點，且還沒被觸發過
  if (closestIndex >= 0 && closestIndex >= manualTimeIndex) {
    // 觸發視覺化效果
    while (manualTimeIndex <= closestIndex) {
      const success = triggerNextTime();
      if (!success) break;
      manualTimeIndex++;
    }
  }
}

function setGlobalVelocityMultiplier(multiplier) {
  globalVelocityMultiplier = multiplier;
}

function setMidiProgress(percent) {
  if (!currentMidi) return;
  const maxTime = Math.max(
    ...currentMidi.tracks.flatMap((t) =>
      t.notes.map((n) => n.time + n.duration)
    )
  );
  pauseTime = maxTime * percent;

  // 同步視覺化進度
  if (manualPlayMode) {
    seekToProgress(percent);
  } else {
    // 🌟 新增：自動播放模式下也同步視覺化進度
    syncVisualizationProgress(percent);
  }

  resumeMidiPlayback();
}

// 同步視覺化進度的函數
function syncVisualizationProgress(percent) {
  if (manualTimeList.length === 0) return;

  const targetTimeIndex = Math.floor(manualTimeList.length * percent);
  manualTimeIndex = Math.max(
    0,
    Math.min(targetTimeIndex, manualTimeList.length - 1)
  );

  // 同步滾動窗口位置
  seekToProgress(percent);
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

  console.log(`🎵 手動播放模式：共 ${manualTimeList.length} 個時間點`);
}

function manualPlayNextNote(velocity, triggeringNote) {
  if (!currentMidi || !pianoTarget) return;

  if (manualTimeList.length === 0) prepareManualTimeList();

  // 檢查是否已播放完畢
  if (manualTimeIndex >= manualTimeList.length) {
    console.log("🎵 手動播放完成，重新開始");
    manualTimeIndex = 0;
    resetToStart(); // 重置視覺化窗口

    // 清除所有音符
    for (let midiNumber = 21; midiNumber <= 108; midiNumber++) {
      ["piano", "violin", "cello", "Trombone"].forEach((sound) => {
        const sustain = ["cello", "violin", "Trombone"].includes(sound);
        if (sustain) {
          stopPolyCelloNote(midiNumber, pianoTarget);
        } else {
          stopSound(midiNumber, pianoTarget, sound);
        }
        const keyEl = document.querySelector(
          `#${pianoTarget} [data-number="${midiNumber}"]`
        );
        if (keyEl) keyEl.classList.remove("pressed");
      });
    }
    return;
  }

  const targetTime = manualTimeList[manualTimeIndex];
  const previousTime = manualTimeList[manualTimeIndex - 1];

  console.log(
    `🎵 手動播放時間點: ${targetTime.toFixed(3)}s (${manualTimeIndex + 1}/${
      manualTimeList.length
    })`
  );

  // 🌟 關鍵：觸發滾動窗口的下一個時間點
  const success = triggerNextTime();
  if (!success) {
    console.log("🎵 滾動窗口播放完成");
    return;
  }

  manualTimeIndex++;

  const notesToPlay = [],
    notesToEnd = [];
  currentMidi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      if (Math.abs(note.time - targetTime) < 0.001) {
        notesToPlay.push({ note, track });
      }
      if (
        previousTime !== undefined &&
        note.time + note.duration <= targetTime &&
        note.time + note.duration >= previousTime
      ) {
        notesToEnd.push({ note, track });
      }
    });
  });

  // 停止上一拍的音符
  notesToEnd.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound =
      availableSounds.find((s) => inst.includes(s.toLowerCase())) || "piano";
    const sustain = ["cello", "violin", "Trombone"].includes(matchedSound);
    if (sustain) {
      stopPolyCelloNote(midiNumber, pianoTarget);
    } else {
      stopSound(midiNumber, pianoTarget, matchedSound);
    }
    const keyEl = document.querySelector(
      `#${pianoTarget} [data-number="${midiNumber}"]`
    );
    if (keyEl) keyEl.classList.remove("pressed");
  });

  // 播放這一拍的音符
  notesToPlay.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound =
      availableSounds.find((s) => inst.includes(s.toLowerCase())) || "piano";
    const actualVelocity = Math.min(velocity * globalVelocityMultiplier, 127);
    playSound(midiNumber, pianoTarget, actualVelocity, matchedSound);
    const keyEl = document.querySelector(
      `#${pianoTarget} [data-number="${midiNumber}"]`
    );
    if (keyEl) keyEl.classList.add("pressed");
  });

  previousTriggerKey = triggeringNote;
}

function stopManualNotes() {
  if (manualTimeIndex === 0) return;

  const currentTime = manualTimeList[manualTimeIndex - 1];
  const notesToEnd = [];

  currentMidi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      if (note.time <= currentTime && note.time + note.duration > currentTime) {
        notesToEnd.push({ note, track });
      }
    });
  });

  notesToEnd.forEach(({ note, track }) => {
    const midiNumber = note.midi;
    const inst = track.instrument?.name?.toLowerCase() || "";
    const matchedSound =
      availableSounds.find((s) => inst.includes(s.toLowerCase())) || "piano";
    const sustain = ["cello", "violin", "Trombone"].includes(matchedSound);
    if (sustain) {
      stopPolyCelloNote(midiNumber, pianoTarget);
    } else {
      stopSound(midiNumber, pianoTarget, matchedSound);
    }
    const keyEl = document.querySelector(
      `#${pianoTarget} [data-number="${midiNumber}"]`
    );
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
  if (manualPlayMode && currentMidi) {
    prepareManualTimeList();
    resetToStart(); // 重置滾動窗口
  }
}

function isManualPlayMode() {
  return manualPlayMode;
}

async function setCurrentMidiAndTarget(midi, pianoId) {
  currentMidi = midi;
  pianoTarget = pianoId;
  prepareManualTimeList();

  // 分析 MIDI 結構
  const analysis = analyzeMidiStructure(midi);
  currentAnalysisData = analysis;

  // 設定分析數據到視覺化系統
  setAnalysisData(analysis);

  // 預載視覺化內容（滾動窗口）
  preloadNotes(midi);

  const instrumentToSound = new Map();
  const soundsToLoad = new Set();

  midi.tracks.forEach((track) => {
    const instName = track.instrument?.name?.toLowerCase() || "";
    const matched =
      availableSounds.find((s) => instName.includes(s.toLowerCase())) ||
      "piano";
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
    soundSettings[pianoId].sustain = ["cello", "violin", "Trombone"].includes(
      firstSound
    );
  }

  const selectEl = document.getElementById(`sound-select-${pianoId}`);
  if (selectEl) selectEl.value = firstSound;

  // 計算總時長
  const totalDuration = Math.max(
    ...midi.tracks.flatMap((t) => t.notes.map((n) => n.time + n.duration))
  );

  console.log(`🎵 已載入以下音色: ${Array.from(soundsToLoad).join(", ")}`);
  console.log(`🎨 滾動窗口視覺化系統已準備完成`);
  console.log(
    `⏱️ 總時長: ${Math.floor(totalDuration / 60)}:${Math.floor(
      totalDuration % 60
    )
      .toString()
      .padStart(2, "0")}`
  );
  console.log(`🔢 滾動窗口大小: ${WINDOW_SIZE} 個時間點`);
  console.log(`📊 共找到 ${analysis.notesByTime.size} 個不同時間點`);
}

function analyzeMidiStructure(midi) {
  const analysis = {
    notesByTime: new Map(),
    chords: [],
    melodyLine: [],
  };

  // 收集所有音符按時間分組
  midi.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((note) => {
      const time = Math.round(note.time * 1000) / 1000; // 四捨五入到毫秒
      if (!analysis.notesByTime.has(time)) {
        analysis.notesByTime.set(time, []);
      }
      analysis.notesByTime.get(time).push({
        ...note,
        trackIndex,
        noteName: midiToNoteName(note.midi),
      });
    });
  });

  // 分析和弦
  analysis.notesByTime.forEach((notes, time) => {
    if (notes.length >= 3) {
      const chordType = analyzeChord(notes.map((n) => n.midi));
      analysis.chords.push({
        time,
        notes: notes.map((n) => n.midi),
        type: chordType,
        root: notes[0].midi,
      });
    }
  });

  return analysis;
}

function midiToNoteName(midi) {
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midi / 12) - 1;
  const note = noteNames[midi % 12];
  return `${note}${octave}`;
}

function analyzeChord(midiNotes) {
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i] - sorted[0]);
  }

  const intervalString = intervals.join(",");

  switch (intervalString) {
    case "4,7":
      return "major";
    case "3,7":
      return "minor";
    case "3,6":
      return "diminished";
    case "4,8":
      return "augmented";
    case "4,7,10":
      return "seventh";
    case "4,7,11":
      return "major7";
    case "3,7,10":
      return "minor7";
    default:
      return "complex";
  }
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
