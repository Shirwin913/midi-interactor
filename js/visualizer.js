// scrolling-window-visualizer.js - 滾動窗口式 MIDI 視覺化系統
import * as PIXI from "https://cdn.jsdelivr.net/npm/pixi.js@7.3.2/dist/pixi.min.mjs";

export let noteMap = new Map(); // time → array of graphics
export let connectionMap = new Map(); // time → array of connection graphics
export let currentTimeIndex = 0;
export let timeList = []; // 所有時間點的有序列表

let app;
let backgroundLayer;
let connectionLayer;
let noteLayer;
let effectLayer;
let uiLayer;

// 滾動窗口設定
const WINDOW_SIZE = 4; // 一次顯示 4 個時間點
const TIME_SLOT_WIDTH = 200; // 每個時間點的寬度
const CANVAS_WIDTH = WINDOW_SIZE * TIME_SLOT_WIDTH; // 固定畫布寬度

// 視覺化設定
const NOTE_HEIGHT = 8;
const MIDI_MIN = 21;
const MIDI_MAX = 108;

// 動態音符範圍 - 固定設定，不再動態改變
let currentMidiMin = MIDI_MIN;
let currentMidiMax = MIDI_MAX;
let currentTotalNotes = MIDI_MAX - MIDI_MIN + 1;

// 顏色設定
const OCTAVE_COLORS = [
  0xff6b6b, 0x4ecdc4, 0x45b7d1, 0x96ceb4, 0xffeaa7, 0xdda0dd, 0xf4a261,
  0xe76f51, 0x2a9d8f,
];

const CHORD_COLORS = {
  major: 0x4ecdc4,
  minor: 0xff6b6b,
  diminished: 0x9b59b6,
  augmented: 0xf39c12,
  seventh: 0xe67e22,
  default: 0x95a5a6,
};

export function initVisualizer(containerId = "pixi-container") {
  const height = 400;

  app = new PIXI.Application({
    width: CANVAS_WIDTH,
    height,
    backgroundColor: 0x0a0a0a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  document.getElementById(containerId).appendChild(app.view);

  // 建立分層系統
  backgroundLayer = new PIXI.Container();
  connectionLayer = new PIXI.Container();
  noteLayer = new PIXI.Container();
  effectLayer = new PIXI.Container();
  uiLayer = new PIXI.Container();

  app.stage.addChild(backgroundLayer);
  app.stage.addChild(connectionLayer);
  app.stage.addChild(noteLayer);
  app.stage.addChild(effectLayer);
  app.stage.addChild(uiLayer);

  createBackgroundGrid();
  createProgressIndicator();

  console.log(`🎨 滾動窗口視覺化系統已初始化 (窗口大小: ${WINDOW_SIZE})`);
}

function createBackgroundGrid() {
  const graphics = new PIXI.Graphics();
  graphics.name = "backgroundGrid";
  backgroundLayer.addChild(graphics);
}

function updateBackgroundGrid() {
  const graphics = backgroundLayer.getChildByName("backgroundGrid");
  if (!graphics) return;

  graphics.clear();

  // 水平線（音高）
  for (let i = 0; i <= currentTotalNotes; i++) {
    const y = i * NOTE_HEIGHT;
    const midiNote = currentMidiMax - i;
    const isOctaveStart = midiNote % 12 === 0;
    const isWhiteKey = [0, 2, 4, 5, 7, 9, 11].includes(midiNote % 12);

    graphics.lineStyle(
      isOctaveStart ? 2 : isWhiteKey ? 1 : 0.5,
      isOctaveStart ? 0x444444 : isWhiteKey ? 0x222222 : 0x111111,
      isOctaveStart ? 0.8 : isWhiteKey ? 0.4 : 0.2
    );
    graphics.moveTo(0, y);
    graphics.lineTo(CANVAS_WIDTH, y);
  }

  // 垂直分隔線（時間槽）
  for (let i = 0; i <= WINDOW_SIZE; i++) {
    const x = i * TIME_SLOT_WIDTH;
    graphics.lineStyle(i === 0 ? 3 : 2, i === 0 ? 0xff4757 : 0x555555, 0.8);
    graphics.moveTo(x, 0);
    graphics.lineTo(x, currentTotalNotes * NOTE_HEIGHT);
  }
}

function createProgressIndicator() {
  // 當前播放指示器
  const playIndicator = new PIXI.Graphics();
  playIndicator.name = "playIndicator";
  playIndicator.lineStyle(4, 0xff4757, 1);
  playIndicator.moveTo(0, 0);
  playIndicator.lineTo(0, 400); // 初始高度，會動態調整

  uiLayer.addChild(playIndicator);
}

function updateProgressIndicatorSize() {
  const playIndicator = uiLayer.getChildByName("playIndicator");

  if (playIndicator) {
    playIndicator.clear();
    playIndicator.lineStyle(4, 0xff4757, 1);
    playIndicator.moveTo(0, 0);
    playIndicator.lineTo(0, currentTotalNotes * NOTE_HEIGHT);
  }
}

export function preloadNotes(midi) {
  // 清除現有內容
  noteLayer.removeChildren();
  connectionLayer.removeChildren();
  effectLayer.removeChildren();
  noteMap.clear();
  connectionMap.clear();
  currentTimeIndex = 0;

  // 分析 MIDI 結構並建立時間列表
  const analysis = analyzeMidiStructure(midi);
  timeList = Array.from(analysis.notesByTime.keys()).sort((a, b) => a - b);

  // 一次性計算整個 MIDI 檔案的音符範圍
  calculateGlobalNoteRange(midi);

  // 設定固定的畫布大小
  setupFixedCanvasSize();

  console.log(`🎵 共找到 ${timeList.length} 個時間點`);
  console.log(
    `🎯 固定音符範圍: ${midiToNoteName(currentMidiMin)} - ${midiToNoteName(
      currentMidiMax
    )} (${currentTotalNotes} 個音符)`
  );

  // 初始渲染前 WINDOW_SIZE 個時間點
  renderWindow();
  updateProgressIndicator();
}

// 計算整個 MIDI 檔案的音符範圍（一次性計算，不再動態改變）
function calculateGlobalNoteRange(midi) {
  let minMidi = MIDI_MAX;
  let maxMidi = MIDI_MIN;

  // 檢查整個 MIDI 檔案中的所有音符
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      minMidi = Math.min(minMidi, note.midi);
      maxMidi = Math.max(maxMidi, note.midi);
    });
  });

  // 如果沒有音符，使用預設範圍
  if (minMidi > maxMidi) {
    minMidi = 60; // C4
    maxMidi = 72; // C5
  }

  // 添加邊距（在實際音符範圍上下各保留 3 個音符的空間）
  const marginNotes = 3;
  currentMidiMin = Math.max(MIDI_MIN, minMidi - marginNotes);
  currentMidiMax = Math.min(MIDI_MAX, maxMidi + marginNotes);
  currentTotalNotes = currentMidiMax - currentMidiMin + 1;
}

// 設定固定的畫布大小
function setupFixedCanvasSize() {
  const newHeight = currentTotalNotes * NOTE_HEIGHT + 60;
  app.renderer.resize(CANVAS_WIDTH, newHeight);

  // 更新容器大小
  const container = document.getElementById("pixi-container");
  if (container) {
    container.style.height = `${newHeight}px`;
  }

  // 一次性更新背景網格和進度指示器
  updateBackgroundGrid();
  updateProgressIndicatorSize();
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

function renderWindow() {
  // 清除當前渲染內容
  noteLayer.removeChildren();
  connectionLayer.removeChildren();

  // 渲染當前窗口內的時間點
  for (let i = 0; i < WINDOW_SIZE; i++) {
    const timeIndex = currentTimeIndex + i;
    if (timeIndex >= timeList.length) break;

    const time = timeList[timeIndex];
    const slotX = i * TIME_SLOT_WIDTH;

    renderTimeSlot(time, slotX, i);
  }
}

function renderTimeSlot(time, slotX, slotIndex) {
  // 獲取這個時間點的所有音符
  const analysis = getCurrentAnalysis();
  const notes = analysis.notesByTime.get(time) || [];

  if (notes.length === 0) return;

  // 建立時間槽容器
  const slotContainer = new PIXI.Container();
  slotContainer.x = slotX;
  slotContainer.name = `timeSlot_${time}`;

  // 添加時間標籤
  createTimeLabel(slotContainer, time, slotIndex);

  // 渲染音符
  const noteGraphics = [];
  notes.forEach((note, noteIndex) => {
    const noteGraphic = createEnhancedNote(note, noteIndex, notes.length);
    slotContainer.addChild(noteGraphic);
    noteGraphics.push(noteGraphic);
  });

  // 添加和弦標記
  const chord = analysis.chords.find((c) => Math.abs(c.time - time) < 0.1);
  if (chord) {
    createChordIndicator(slotContainer, chord);
  }

  noteLayer.addChild(slotContainer);

  // 存儲到 noteMap
  if (!noteMap.has(time)) noteMap.set(time, []);
  noteMap.get(time).push(...noteGraphics);
}

function createTimeLabel(container, time, slotIndex) {
  const minutes = Math.floor(time / 60);
  const seconds = (time % 60).toFixed(1);
  const timeText = `${minutes}:${seconds.padStart(4, "0")}`;

  const label = new PIXI.Text(timeText, {
    fontFamily: "Arial",
    fontSize: 10,
    fill: slotIndex === 0 ? 0xff4757 : 0xaaaaaa,
    align: "center",
    fontWeight: slotIndex === 0 ? "bold" : "normal",
  });

  label.x = TIME_SLOT_WIDTH / 2 - label.width / 2;
  label.y = -20;

  container.addChild(label);
}

function createEnhancedNote(note, noteIndex, totalNotes) {
  const midiNum = note.midi;
  const velocity = note.velocity;

  // 計算音符在固定範圍內的位置
  const noteWidth = Math.max(TIME_SLOT_WIDTH / Math.max(totalNotes, 1) - 4, 8);
  const x = noteIndex * (TIME_SLOT_WIDTH / totalNotes) + 10;
  const y = (currentMidiMax - midiNum) * NOTE_HEIGHT;
  const height = NOTE_HEIGHT - 1;

  const container = new PIXI.Container();
  container.x = x;
  container.y = y;

  // 主音符圖形
  const noteGraphic = new PIXI.Graphics();
  const color = getNoteColor(midiNum, velocity);
  const alpha = 0.7 + velocity * 0.3;

  noteGraphic.beginFill(color, alpha);
  noteGraphic.drawRoundedRect(0, 0, noteWidth, height, 3);
  noteGraphic.endFill();

  // 添加光暈效果
  const glow = new PIXI.Graphics();
  glow.beginFill(color, 0.2);
  glow.drawRoundedRect(-2, -2, noteWidth + 4, height + 4, 5);
  glow.endFill();
  glow.filters = [new PIXI.filters.BlurFilter(1)];

  container.addChild(glow);
  container.addChild(noteGraphic);

  // 添加力度指示器
  if (velocity > 0.8) {
    const accent = new PIXI.Graphics();
    accent.lineStyle(2, 0xffffff, 0.8);
    accent.drawRect(0, 0, noteWidth, height);
    container.addChild(accent);
  }

  // 添加呼吸動畫
  const breatheAnimation = () => {
    const scale = 1 + Math.sin(Date.now() * 0.002 + midiNum * 0.1) * 0.03;
    container.scale.set(scale, 1);
  };

  app.ticker.add(breatheAnimation);

  // 存儲清理函數
  container.cleanupAnimation = () => {
    app.ticker.remove(breatheAnimation);
  };

  return container;
}

function createChordIndicator(container, chord) {
  const chordGraphic = new PIXI.Graphics();
  const color = CHORD_COLORS[chord.type] || CHORD_COLORS.default;

  chordGraphic.beginFill(color, 0.3);
  chordGraphic.drawRoundedRect(10, -35, TIME_SLOT_WIDTH - 20, 20, 6);
  chordGraphic.endFill();

  chordGraphic.lineStyle(1, color, 0.8);
  chordGraphic.drawRoundedRect(10, -35, TIME_SLOT_WIDTH - 20, 20, 6);

  const chordText = new PIXI.Text(`${chord.type.toUpperCase()}`, {
    fontFamily: "Arial",
    fontSize: 8,
    fill: 0xffffff,
    align: "center",
  });
  chordText.x = TIME_SLOT_WIDTH / 2 - chordText.width / 2;
  chordText.y = -30;

  container.addChild(chordGraphic);
  container.addChild(chordText);
}

// 觸發下一個時間點
export function triggerNextTime() {
  if (currentTimeIndex >= timeList.length) {
    console.log("🎵 演奏完成！");
    return false;
  }

  const currentTime = timeList[currentTimeIndex];
  console.log(
    `🎵 觸發時間點: ${currentTime.toFixed(3)}s (${currentTimeIndex + 1}/${
      timeList.length
    })`
  );

  // 觸發消失特效
  triggerDisappearEffect(currentTime);

  // 移動到下一個時間點
  currentTimeIndex++;

  // 移動窗口內容（向左滑動效果）
  slideWindow();

  // 更新進度指示器
  updateProgressIndicator();

  return true;
}

function triggerDisappearEffect(time) {
  const notes = noteMap.get(time);
  if (notes) {
    notes.forEach((note) => {
      createDisappearEffect(note);
    });
    noteMap.delete(time);
  }
}

function slideWindow() {
  // 創建滑動動畫
  const slideAnimation = () => {
    let progress = 0;
    const duration = 300; // 300ms 滑動時間
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      progress = Math.min(elapsed / duration, 1);

      // 使用緩動函數
      const easeProgress = easeOutCubic(progress);

      // 移動所有時間槽
      noteLayer.children.forEach((child, index) => {
        if (child.name && child.name.startsWith("timeSlot_")) {
          const targetX = (index - 1) * TIME_SLOT_WIDTH;
          const startX = index * TIME_SLOT_WIDTH;
          child.x = startX + (targetX - startX) * easeProgress;
        }
      });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // 動畫完成，重新渲染窗口
        renderWindow();
      }
    };

    requestAnimationFrame(animate);
  };

  slideAnimation();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function updateProgressIndicator() {
  // 只在控制台顯示進度，不顯示UI文字
  console.log(
    `🎵 進度: ${currentTimeIndex}/${timeList.length} (${(
      (currentTimeIndex / timeList.length) *
      100
    ).toFixed(0)}%)`
  );
}

function createDisappearEffect(noteContainer) {
  // 簡化的粒子效果
  const particleCount = 4;
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    const particle = new PIXI.Graphics();
    const color = 0xffffff;
    const size = 1 + Math.random() * 2;

    particle.beginFill(color, 0.8);
    particle.drawCircle(0, 0, size);
    particle.endFill();

    particle.x = noteContainer.x + Math.random() * 20;
    particle.y = noteContainer.y + Math.random() * NOTE_HEIGHT;

    particle.vx = (Math.random() - 0.5) * 6;
    particle.vy = (Math.random() - 0.5) * 6;
    particle.life = 1.0;
    particle.decay = 0.03 + Math.random() * 0.02;

    particles.push(particle);
    effectLayer.addChild(particle);
  }

  // 粒子動畫
  const animateParticles = () => {
    particles.forEach((particle, index) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life -= particle.decay;
      particle.alpha = particle.life;
      particle.scale.set(particle.life);

      if (particle.life <= 0) {
        effectLayer.removeChild(particle);
        particles.splice(index, 1);
      }
    });

    if (particles.length === 0) {
      app.ticker.remove(animateParticles);
    }
  };

  app.ticker.add(animateParticles);

  // 音符淡出
  const fadeOut = () => {
    noteContainer.alpha -= 0.08;
    if (noteContainer.alpha <= 0) {
      if (noteContainer.cleanupAnimation) {
        noteContainer.cleanupAnimation();
      }
      if (noteContainer.parent) {
        noteContainer.parent.removeChild(noteContainer);
      }
      app.ticker.remove(fadeOut);
    }
  };

  app.ticker.add(fadeOut);
}

// 重置到開始
export function resetToStart() {
  currentTimeIndex = 0;
  renderWindow();
  updateProgressIndicator();
  console.log("🔄 已重置到開始位置");
}

// 跳轉到指定進度
export function seekToProgress(percent) {
  const targetIndex = Math.floor(timeList.length * percent);
  currentTimeIndex = Math.max(0, Math.min(targetIndex, timeList.length - 1));
  renderWindow();
  updateProgressIndicator();
  console.log(`⏩ 跳轉到進度 ${(percent * 100).toFixed(1)}%`);
}

// 獲取當前分析數據（需要從外部傳入）
let currentAnalysisData = null;
export function setAnalysisData(analysis) {
  currentAnalysisData = analysis;
}

function getCurrentAnalysis() {
  return currentAnalysisData || { notesByTime: new Map(), chords: [] };
}

// 獲取當前狀態的函數
export function getCurrentTimeIndex() {
  return currentTimeIndex;
}

export function getTimeList() {
  return timeList;
}

export function getTotalTimePoints() {
  return timeList.length;
}

export function getCurrentProgress() {
  return timeList.length > 0 ? currentTimeIndex / timeList.length : 0;
}

export function getCurrentMidiRange() {
  return {
    min: currentMidiMin,
    max: currentMidiMax,
    total: currentTotalNotes,
  };
}

// 輔助函數
function getNoteColor(midiNum, velocity) {
  const octave = Math.floor(midiNum / 12);
  return OCTAVE_COLORS[octave % OCTAVE_COLORS.length];
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
    default:
      return "complex";
  }
}

export { WINDOW_SIZE };
