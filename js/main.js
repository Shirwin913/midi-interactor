// ✅ main.js：加入鍵盤抬起（keyup）立即停音邏輯，對應真實演奏需求
import {
  parseMidiFile,
  setCurrentMidiAndTarget,
  manualPlayNextNote,
  setManualPlayMode,
  isManualPlayMode,
  setManualTriggerKey,
  getManualTriggerKey,
  stopManualNotes,
} from "./midiplayer.js";

import {
  loadAudioFilesForSound,
  stopSound,
  soundSettings,
} from "./audiomanager.js";

const uploadBtn = document.getElementById("midi-upload");
const soundSelect = document.getElementById("sound-select");

let currentMidi = null;
let defaultSound = "piano";

soundSelect.addEventListener("change", async (e) => {
  defaultSound = e.target.value;
  soundSettings["piano"].sound = defaultSound;
  await loadAudioFilesForSound("piano", defaultSound);
  alert("✅ 音色切換為：" + defaultSound);
});

uploadBtn.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    currentMidi = await parseMidiFile(file);
    await setCurrentMidiAndTarget(currentMidi, "piano");
    setManualPlayMode(true);
    alert("✅ MIDI 載入完成，手動播放模式已啟用");
  } catch (err) {
    alert("❌ 載入失敗：" + err.message);
  }
});

const pressedKeys = new Set();

window.addEventListener("keydown", (e) => {
  const preventKeys = [" ", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  if (preventKeys.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }

  const key = e.key.toLowerCase();
  if (isManualPlayMode() && !pressedKeys.has(key)) {
    manualPlayNextNote(127, key);
    setManualTriggerKey(key);
    pressedKeys.add(key);
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (!isManualPlayMode()) return;

  pressedKeys.delete(key);

  // 🎯 加入：若放開的是觸發鍵，則執行立即停音
  if (key === getManualTriggerKey()) {
    stopManualNotes();
    setManualTriggerKey(null);
  }
});

let mouseDown = false;
window.addEventListener("mousedown", (e) => {
  if (!isManualPlayMode()) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (["button", "select", "input", "label"].includes(tag)) return;
  if (!mouseDown) {
    manualPlayNextNote(127, "mouse");
    setManualTriggerKey("mouse");
    mouseDown = true;
  }
});

window.addEventListener("mouseup", () => {
  if (mouseDown && isManualPlayMode()) {
    stopManualNotes();
    setManualTriggerKey(null);
    mouseDown = false;
  }
});