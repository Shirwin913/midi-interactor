// scrolling-main.js：滾動窗口系統的主控制文件
import {
  parseMidiFile,
  setCurrentMidiAndTarget,
  manualPlayNextNote,
  setManualPlayMode,
  isManualPlayMode,
  setManualTriggerKey,
  getManualTriggerKey,
  stopManualNotes,
  playMidi,
  stopMidiPlayback,
  pauseMidiPlayback,
  resumeMidiPlayback,
  setMidiProgress,
} from "./midiplayer.js";

import {
  loadAudioFilesForSound,
  stopSound,
  soundSettings,
} from "./audiomanager.js";

import {
  initVisualizer,
  resetToStart,
  seekToProgress,
  getCurrentTimeIndex,
  getTimeList,
  getTotalTimePoints,
  getCurrentProgress,
  WINDOW_SIZE,
} from "./visualizer.js";

// 初始化滾動窗口視覺化系統
window.addEventListener("DOMContentLoaded", () => {
  console.log("🎨 初始化滾動窗口視覺化系統...");
  initVisualizer("pixi-container");
});

// DOM 元素
const uploadBtn = document.getElementById("midi-upload");
const soundSelect = document.getElementById("sound-select");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const resumeBtn = document.getElementById("resume");
const stopBtn = document.getElementById("stop");

// 狀態變數
let currentMidi = null;
let defaultSound = "piano";
let isAutoPlaying = false;

// 音色切換
soundSelect.addEventListener("change", async (e) => {
  defaultSound = e.target.value;

  if (!soundSettings["piano"]) {
    soundSettings["piano"] = {
      sound: defaultSound,
      volume: 1.5,
      sustain: ["cello", "violin", "Trombone"].includes(defaultSound),
    };
  } else {
    soundSettings["piano"].sound = defaultSound;
    soundSettings["piano"].sustain = ["cello", "violin", "Trombone"].includes(
      defaultSound
    );
  }

  await loadAudioFilesForSound("piano", defaultSound);
  showMessage(`✅ 音色切換為：${defaultSound}`, "success");
});

// MIDI 檔案上傳
uploadBtn.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showMessage("🔄 正在載入 MIDI 檔案...", "info");
    showLoadingOverlay(true);

    currentMidi = await parseMidiFile(file);
    await setCurrentMidiAndTarget(currentMidi, "piano");

    // 預設啟用手動播放模式
    setManualPlayMode(true);
    isAutoPlaying = false;

    // 更新 UI 狀態
    updateUIState();

    showLoadingOverlay(false);
    showMessage(`✅ MIDI 載入完成！檔案：${file.name}`, "success");
    showMessage(`🎹 滾動窗口已準備就緒，顯示 ${WINDOW_SIZE} 個時間點`, "info");

    // 顯示統計資訊
    setTimeout(() => {
      const totalPoints = getTotalTimePoints();
      const windowSize = Math.min(WINDOW_SIZE, totalPoints);
      showMessage(
        `📊 共 ${totalPoints} 個時間點，當前窗口: ${windowSize}`,
        "info"
      );
    }, 2000);
  } catch (err) {
    console.error("MIDI 載入錯誤:", err);
    showLoadingOverlay(false);
    showMessage(`❌ 載入失敗：${err.message}`, "error");
  }
});

// 播放控制按鈕
playBtn.addEventListener("click", () => {
  if (!currentMidi) {
    showMessage("❌ 請先載入 MIDI 檔案", "error");
    return;
  }

  if (isManualPlayMode()) {
    setManualPlayMode(false);
    isAutoPlaying = true;
    playMidi(currentMidi, "piano");
    showMessage("▶️ 切換到自動播放模式", "success");
  } else {
    isAutoPlaying = true;
    playMidi(currentMidi, "piano");
    showMessage("▶️ 開始播放", "success");
  }

  updateUIState();
});

pauseBtn.addEventListener("click", () => {
  if (isAutoPlaying) {
    pauseMidiPlayback();
    isAutoPlaying = false;
    showMessage("⏸️ 播放暫停", "info");
    updateUIState();
  }
});

resumeBtn.addEventListener("click", () => {
  if (!isAutoPlaying && !isManualPlayMode()) {
    resumeMidiPlayback();
    isAutoPlaying = true;
    showMessage("⏵️ 繼續播放", "success");
    updateUIState();
  }
});

stopBtn.addEventListener("click", () => {
  if (isAutoPlaying) {
    stopMidiPlayback();
    isAutoPlaying = false;
  }

  if (currentMidi) {
    setManualPlayMode(true);
    resetToStart();
    showMessage("🔄 已重置到手動播放模式", "info");
  }

  updateUIState();
});

// 鍵盤控制
const pressedKeys = new Set();

window.addEventListener("keydown", (e) => {
  const preventKeys = [
    " ",
    "tab",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "enter",
    "escape",
  ];
  if (preventKeys.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }

  const key = e.key.toLowerCase();

  // 特殊功能鍵
  if (key === " ") {
    if (isManualPlayMode()) {
      if (!pressedKeys.has(key)) {
        manualPlayNextNote(127, key);
        setManualTriggerKey(key);
        pressedKeys.add(key);
      }
    } else {
      if (isAutoPlaying) {
        pauseBtn.click();
      } else {
        playBtn.click();
      }
    }
    return;
  }

  if (key === "escape") {
    stopBtn.click();
    return;
  }

  if (key === "r" && e.ctrlKey) {
    e.preventDefault();
    if (currentMidi) {
      resetToStart();
      showMessage("🔄 已重置到開始位置", "info");
    }
    return;
  }

  // 數字鍵快速跳轉
  if (key >= "1" && key <= "9") {
    const percent = parseInt(key) * 0.1;
    if (currentMidi) {
      if (isManualPlayMode()) {
        seekToProgress(percent);
        showMessage(`⏩ 跳轉到 ${(percent * 100).toFixed(0)}%`, "info");
      } else if (!isAutoPlaying) {
        setMidiProgress(percent);
        showMessage(`⏩ 跳轉到 ${(percent * 100).toFixed(0)}%`, "info");
      }
    }
    return;
  }

  // 手動播放模式的按鍵觸發
  if (isManualPlayMode() && !pressedKeys.has(key)) {
    manualPlayNextNote(127, key);
    setManualTriggerKey(key);
    pressedKeys.add(key);
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  pressedKeys.delete(key);

  if (isManualPlayMode() && key === getManualTriggerKey()) {
    stopManualNotes();
    setManualTriggerKey(null);
  }
});

// 滑鼠控制
let mouseDown = false;

window.addEventListener("mousedown", (e) => {
  if (!isManualPlayMode()) return;

  const tag = (e.target.tagName || "").toLowerCase();
  if (["button", "select", "input", "label", "canvas"].includes(tag)) return;

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

// UI 狀態管理
function updateUIState() {
  if (!playBtn || !pauseBtn || !resumeBtn || !stopBtn) return;

  const hasFile = !!currentMidi;
  const manual = isManualPlayMode();
  const playing = isAutoPlaying;

  playBtn.disabled = !hasFile;
  pauseBtn.disabled = !playing;
  resumeBtn.disabled = playing || manual;
  stopBtn.disabled = !hasFile;

  playBtn.title = manual ? "切換到自動播放" : "開始播放";
  pauseBtn.title = "暫停播放";
  resumeBtn.title = "繼續播放";
  stopBtn.title = "停止並重置到手動模式";

  updateModeIndicator(manual, playing);
}

function updateModeIndicator(manual, playing) {
  let modeText = document.getElementById("mode-indicator");
  if (!modeText) {
    modeText = document.createElement("div");
    modeText.id = "mode-indicator";
    modeText.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 15px;
      border-radius: 8px;
      font-weight: bold;
      font-size: 14px;
      z-index: 1000;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    document.body.appendChild(modeText);
  }

  if (manual) {
    const totalPoints = getTotalTimePoints();
    const currentIndex = getCurrentTimeIndex();
    const progress =
      totalPoints > 0
        ? `${currentIndex}/${totalPoints} (${(
            (currentIndex / totalPoints) *
            100
          ).toFixed(0)}%)`
        : "0/0";
    modeText.innerHTML = `🎹 手動播放模式<br><small>進度: ${progress}</small>`;
    modeText.style.backgroundColor = "rgba(46, 204, 113, 0.9)";
    modeText.style.color = "white";
  } else if (playing) {
    modeText.textContent = "▶️ 自動播放中";
    modeText.style.backgroundColor = "rgba(52, 152, 219, 0.9)";
    modeText.style.color = "white";
  } else {
    modeText.textContent = "⏸️ 自動播放暫停";
    modeText.style.backgroundColor = "rgba(243, 156, 18, 0.9)";
    modeText.style.color = "white";
  }
}

function showMessage(text, type = "info") {
  const existing = document.getElementById("message-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "message-toast";
  toast.textContent = text;

  const colors = {
    success: "rgba(46, 204, 113, 0.95)",
    error: "rgba(231, 76, 60, 0.95)",
    info: "rgba(52, 152, 219, 0.95)",
    warning: "rgba(243, 156, 18, 0.95)",
  };

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    border-radius: 8px;
    background: ${colors[type] || colors.info};
    color: white;
    font-weight: bold;
    z-index: 1001;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    transition: all 0.3s ease;
    max-width: 90%;
    text-align: center;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(20px)";
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
}

function showLoadingOverlay(show) {
  let overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">正在處理 MIDI 檔案...</div>
    `;
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(5px);
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      z-index: 2000;
    `;
    document.body.appendChild(overlay);
  }

  overlay.style.display = show ? "flex" : "none";
}

function showKeyboardHelp() {
  const helpText = `
🎹 滾動窗口 MIDI 播放器快捷鍵：

⌨️ 基本操作：
• 任意鍵：觸發下一個時間點（手動模式）
• 空白鍵：播放下一個時間點 / 播放暫停切換
• ESC：停止播放並重置到手動模式
• Ctrl+R：重置到開始位置

🔢 快速跳轉（數字鍵）：
• 1-9：跳轉到對應百分比位置
  例如：按 5 = 跳轉到 50%

🖱️ 滑鼠操作：
• 點擊（非UI區域）：觸發時間點（手動模式）

🎵 滾動窗口特色：
• 一次顯示 ${WINDOW_SIZE} 個時間點
• 觸發後自動滾動到下一組
• 優化效能，流暢體驗

📊 當前狀態：
• 總時間點：${getTotalTimePoints()}
• 當前進度：${getCurrentTimeIndex()}/${getTotalTimePoints()}
• 窗口大小：${WINDOW_SIZE}
  `;

  alert(helpText);
}

// 添加說明按鈕和統計面板
document.addEventListener("DOMContentLoaded", () => {
  // 說明按鈕
  if (!document.getElementById("help-btn")) {
    const helpBtn = document.createElement("button");
    helpBtn.id = "help-btn";
    helpBtn.textContent = "❓ 使用說明";
    helpBtn.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      padding: 8px 12px;
      border: none;
      border-radius: 8px;
      background: rgba(149, 165, 166, 0.9);
      color: white;
      cursor: pointer;
      font-size: 12px;
      z-index: 1000;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: all 0.3s ease;
    `;
    helpBtn.addEventListener("click", showKeyboardHelp);
    helpBtn.addEventListener("mouseenter", () => {
      helpBtn.style.background = "rgba(149, 165, 166, 1)";
      helpBtn.style.transform = "scale(1.05)";
    });
    helpBtn.addEventListener("mouseleave", () => {
      helpBtn.style.background = "rgba(149, 165, 166, 0.9)";
      helpBtn.style.transform = "scale(1)";
    });
    document.body.appendChild(helpBtn);
  }

  updateUIState();
});

// 定期更新進度顯示
setInterval(() => {
  if (isManualPlayMode()) {
    updateModeIndicator(true, false);
  }
}, 1000);

console.log("🎵 滾動窗口 MIDI 播放系統已載入完成！");
console.log(`🎨 滾動窗口大小: ${WINDOW_SIZE} 個時間點`);
console.log("🎯 效能優化：只渲染可見的時間點，大幅提升效能！");
