import { noteMapping, availableSounds } from "./utils/constants.js";

let audioCtx = null;

const audioBuffers = {}; // pid -> sound -> Map(note number -> AudioBuffer)
const playingSources = {}; // pid -> sound -> note -> {src, gainNode}
const polySources = {}; // pid -> note -> { A:{src,gain}, B:{src,gain} }

const soundSettings = {};
const sharedBuffers = {}; // sound -> Map(note number -> AudioBuffer)
const allAudioLoaded = {}; // pid -> sound -> boolean

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

async function loadAudioFilesForSound(pid, sound) {
  initAudioContext();
  if (allAudioLoaded[pid]?.[sound]) return;

  if (!audioBuffers[pid]) audioBuffers[pid] = {};
  if (!playingSources[pid]) playingSources[pid] = {};
  if (!polySources[pid]) polySources[pid] = {};
  if (!allAudioLoaded[pid]) allAudioLoaded[pid] = {};

  if (!sharedBuffers[sound]) {
    sharedBuffers[sound] = new Map();
    const promises = Object.entries(noteMapping).map(async ([note, num]) => {
      const ext = "mp3";
      try {
        const res = await fetch(`./samples/${sound}/piano_${note}.${ext}`);
        if (!res.ok) throw new Error(`找不到檔案 piano_${note}.${ext}`);
        const ab = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(ab);
        sharedBuffers[sound].set(num, buf);
      } catch (e) {
        console.warn(`載入 ${sound} 的 piano_${note}.${ext} 失敗：`, e);
      }
    });
    await Promise.all(promises);
  }

  audioBuffers[pid][sound] = new Map();
  sharedBuffers[sound].forEach((buf, num) => {
    audioBuffers[pid][sound].set(num, buf);
  });

  allAudioLoaded[pid][sound] = true;
}

function mapVelocityToFrequency(velocity) {
  const minFreq = 500;
  const maxFreq = 16000;
  const clampedVel = Math.max(1, Math.min(velocity, 127));
  const norm = (clampedVel - 1) / 126;
  return minFreq * Math.pow(maxFreq / minFreq, norm);
}

function playSound(note, pid, velocity, customSound) {
  initAudioContext();
  const sound = customSound || soundSettings[pid]?.sound;
  if (!sound || !allAudioLoaded[pid]?.[sound]) return;

  if ((sound === "cello" || sound === "violin" || sound === "Trombone") && soundSettings[pid].sustain) {
    playPolyCelloNote(note, pid, velocity);
    return;
  }

  stopSound(note, pid, sound);

  const buffer = audioBuffers[pid][sound]?.get(note);
  if (!buffer) return;

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = mapVelocityToFrequency(velocity);

  const gainNode = audioCtx.createGain();
  const baseVolume = (velocity / 127) * soundSettings[pid].volume;
  const volume = Math.min(baseVolume, 1);

  const now = audioCtx.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.03);

  src.connect(filter).connect(gainNode).connect(audioCtx.destination);
  src.start();

  if (!playingSources[pid]) playingSources[pid] = {};
  if (!playingSources[pid][sound]) playingSources[pid][sound] = {};
  playingSources[pid][sound][note] = { src, gainNode };
}

function stopSound(note, pid, customSound) {
  const sound = customSound || soundSettings[pid]?.sound;

  if ((sound === "cello" || sound === "violin" || sound === "Trombone") && soundSettings[pid].sustain) {
    stopPolyCelloNote(note, pid);
    return;
  }

  const obj = playingSources[pid]?.[sound]?.[note];
  if (obj) {
    const { src, gainNode } = obj;

    try {
      const fadeTime = 0.3;
      const now = audioCtx.currentTime;

      if (gainNode) {
        const startGain = Math.max(gainNode.gain.value, 0.0001);
        gainNode.gain.setValueAtTime(startGain, now);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + fadeTime);
        src.stop(now + fadeTime + 0.02);
      } else {
        src.stop();
      }
    } catch {}

    delete playingSources[pid][sound][note];
  }
}

function stopPolyCelloNote(note, pid) {
  const nodes = polySources[pid]?.[note];
  if (!nodes) return;

  const now = audioCtx.currentTime;

  ["A", "B"].forEach((k) => {
    const entry = nodes[k];
    if (!entry) return;

    const { src, gain } = entry;

    try {
      gain.gain.cancelScheduledValues(now);
      const fadeOutTime = k === "B" ? 0.15 : 0.08;
      const currentGain = gain.gain.value;
      gain.gain.setValueAtTime(Math.max(currentGain, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeOutTime);
      src.stop(now + fadeOutTime + 0.01);
    } catch (e) {
      console.warn("停止音符时出错", e);
      try { src.stop(); } catch {}
    }

    nodes[k] = null;
  });
}

function unloadAudioForPiano(pid) {
  if (playingSources[pid]) {
    Object.values(playingSources[pid]).forEach((soundMap) => {
      Object.values(soundMap).forEach((obj) => {
        try {
          obj.src.stop();
        } catch {}
      });
    });
    delete playingSources[pid];
  }

  if (polySources[pid]) {
    Object.entries(polySources[pid]).forEach(([note, nodes]) => {
      ["A", "B"].forEach((k) => {
        if (nodes[k]) {
          try {
            nodes[k].src.stop();
          } catch {}
        }
      });
    });
    delete polySources[pid];
  }

  if (audioBuffers[pid]) delete audioBuffers[pid];
  delete soundSettings[pid];
  delete allAudioLoaded[pid];
}

function playPolyCelloNote(note, pid, velocity) {
  stopPolyCelloNote(note, pid); // 先停止舊的

  const sound = soundSettings[pid]?.sound;
  const buffer = audioBuffers[pid][sound]?.get(note);
  if (!buffer) return;

  if (!polySources[pid][note]) {
    polySources[pid][note] = { A: null, B: null };
  }

  const nodes = polySources[pid][note];

  const attackDuration = analyzeBestAttackDuration(buffer);
  const { bestLoopStart, bestLoopEnd } = findOptimalLoopPoints(buffer, attackDuration);
  const hasSufficientLength = (bestLoopEnd - bestLoopStart) > 1.5;

  const volume = Math.min((velocity / 127) * soundSettings[pid].volume, 1);
  const cutoff = mapVelocityToFrequency(velocity);
  const now = audioCtx.currentTime;

  const randomSeed = Math.random();
  const pitchVariation = 1.0 + (randomSeed * 0.0008 - 0.0004);

  // === A (起音)
  const srcA = audioCtx.createBufferSource();
  srcA.buffer = buffer;
  srcA.playbackRate.value = pitchVariation;

  const filterA = audioCtx.createBiquadFilter();
  filterA.type = "lowpass";
  filterA.frequency.value = cutoff;

  const gainA = audioCtx.createGain();
  gainA.gain.value = volume;

  srcA.connect(filterA).connect(gainA).connect(audioCtx.destination);
  srcA.start(now);

  if (!hasSufficientLength) {
    nodes.A = { src: srcA, gain: gainA };
    return;
  }

  // === B (循環)
  const srcB = audioCtx.createBufferSource();
  srcB.buffer = buffer;
  srcB.loop = true;
  srcB.loopStart = bestLoopStart;
  srcB.loopEnd = bestLoopEnd;

  const loopPitchVariation = pitchVariation * (1 + (Math.random() * 0.0002 - 0.0001));
  srcB.playbackRate.value = loopPitchVariation;

  const filterB = audioCtx.createBiquadFilter();
  filterB.type = "lowpass";
  filterB.frequency.value = cutoff * 0.95;

  const gainB = audioCtx.createGain();
  gainB.gain.value = 0;

  const startTimeB = now + bestLoopStart - 0.1;
  srcB.connect(filterB).connect(gainB).connect(audioCtx.destination);
  srcB.start(startTimeB, bestLoopStart);

  // === 淡入/淡出交錯
  const crossfadeDuration = 1.6;
  const steps = 100;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const time = startTimeB + t * crossfadeDuration;
    const fadeOut = sCurveEqualPower(t) * volume;
    const fadeIn = sCurveEqualPower(1 - t) * volume;

    gainA.gain.linearRampToValueAtTime(fadeOut, time);
    gainB.gain.linearRampToValueAtTime(fadeIn, time);
  }

  gainA.gain.setValueAtTime(0, startTimeB + crossfadeDuration + 0.01);

  nodes.A = { src: srcA, gain: gainA };
  nodes.B = { src: srcB, gain: gainB };
}

function sCurveEqualPower(x) {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  const smoothedX = 0.5 - 0.5 * Math.cos(x * Math.PI);
  return Math.cos(smoothedX * Math.PI / 2);
}

function analyzeBestAttackDuration(buffer) {
  const audioData = buffer.getChannelData(0);
  const samples = audioData.length;
  const sampleRate = buffer.sampleRate;
  const defaultAttackDuration = Math.min(2.0, buffer.duration * 0.3);

  try {
    let maxSample = 0;
    let peakIndex = 0;
    const searchLimit = Math.floor(samples / 3);

    for (let i = 0; i < searchLimit; i++) {
      const absValue = Math.abs(audioData[i]);
      if (absValue > maxSample) {
        maxSample = absValue;
        peakIndex = i;
      }
    }

    const threshold = maxSample * 0.5;
    let attackEndIndex = peakIndex;

    for (let i = peakIndex; i < searchLimit; i++) {
      if (Math.abs(audioData[i]) <= threshold) {
        attackEndIndex = i;
        break;
      }
    }

    let attackDuration = (attackEndIndex / sampleRate) + 0.2;
    attackDuration = Math.max(0.5, Math.min(attackDuration, buffer.duration * 0.5));
    return attackDuration;
  } catch (e) {
    console.warn("⚠️ analyzeBestAttackDuration failed, using default", e);
    return defaultAttackDuration;
  }
}

function findOptimalLoopPoints(buffer, attackDuration) {
  const audioData = buffer.getChannelData(0);
  const samples = audioData.length;
  const sampleRate = buffer.sampleRate;

  const defaultLoopStart = attackDuration;
  const defaultLoopEnd = buffer.duration - 0.2;

  try {
    const sustainStartIndex = Math.floor(attackDuration * sampleRate);
    const safeEndIndex = Math.floor((buffer.duration - 0.2) * sampleRate);

    if (safeEndIndex - sustainStartIndex < sampleRate) {
      return { bestLoopStart: defaultLoopStart, bestLoopEnd: defaultLoopEnd };
    }

    let bestStartIndex = sustainStartIndex;
    let minStartDiff = Math.abs(audioData[sustainStartIndex]);

    for (let i = sustainStartIndex - 1000; i < sustainStartIndex + 1000; i++) {
      if (i > 0 && i < samples && audioData[i - 1] <= 0 && audioData[i] >= 0) {
        const diff = Math.abs(audioData[i]);
        if (diff < minStartDiff) {
          minStartDiff = diff;
          bestStartIndex = i;
        }
      }
    }

    let bestEndIndex = safeEndIndex;
    let minEndDiff = Number.MAX_VALUE;
    const windowSize = Math.floor(0.02 * sampleRate);

    for (let i = safeEndIndex - 2000; i < safeEndIndex + 2000; i++) {
      if (i + windowSize >= samples || bestStartIndex + windowSize >= samples) break;
      let totalDiff = 0;
      for (let j = 0; j < windowSize; j++) {
        totalDiff += Math.abs(audioData[bestStartIndex + j] - audioData[i + j]);
      }
      const avgDiff = totalDiff / windowSize;
      if (avgDiff < minEndDiff) {
        minEndDiff = avgDiff;
        bestEndIndex = i;
      }
    }

    const bestLoopStart = bestStartIndex / sampleRate;
    const bestLoopEnd = bestEndIndex / sampleRate;
    if (bestLoopEnd <= bestLoopStart || bestLoopEnd - bestLoopStart < 0.5) {
      return { bestLoopStart: defaultLoopStart, bestLoopEnd: defaultLoopEnd };
    }

    return { bestLoopStart, bestLoopEnd };
  } catch (e) {
    console.warn("⚠️ findOptimalLoopPoints failed, using default", e);
    return { bestLoopStart: defaultLoopStart, bestLoopEnd: defaultLoopEnd };
  }
}

export {
  playSound,
  stopSound,
  stopPolyCelloNote,
  loadAudioFilesForSound,
  unloadAudioForPiano,
  soundSettings,
  allAudioLoaded,
  audioBuffers,
};
