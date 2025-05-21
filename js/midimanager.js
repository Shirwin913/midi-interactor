// ✅ 精簡後的 midimanager.js：專注於手動播放模式的 MIDI 控制
import {
  manualPlayNextNote,
  isManualPlayMode,
  stopManualNotes,
  setManualTriggerKey,
  getManualTriggerKey,
} from "./midiplayer.js";

import { stopSound } from "./audioManager.js";

// MIDI 裝置對應 piano
const deviceToPianoMap = new Map();
const inputWithListener = new WeakSet();

// 防止多鍵跳拍
let manualPlayLock = false;
let manualPlayLockTimeout = null;

function onMIDIMessage(event, pianoId) {
  const [status, note, velocity] = event.data;

  if (isManualPlayMode()) {
    if (status === 144 && velocity > 0) {
      if (!manualPlayLock) {
        manualPlayLock = true;
        manualPlayNextNote(velocity, note);
        setManualTriggerKey(note);
        manualPlayLockTimeout = setTimeout(() => {
          manualPlayLock = false;
        }, 100);
      }
      return;
    }

    if (status === 128 || (status === 144 && velocity === 0)) {
      if (note === getManualTriggerKey()) {
        stopManualNotes();
        setManualTriggerKey(null);
      }
      return;
    }
  }
}

function listenEvent(inputs, selectedIndex, pianoId) {
  inputs.forEach((input, idx) => {
    if (selectedIndex === idx || selectedIndex < 0) {
      if (!inputWithListener.has(input)) {
        input.onmidimessage = (event) => {
          const pianos = deviceToPianoMap.get(input);
          if (pianos) {
            for (const pid of pianos) {
              onMIDIMessage(event, pid);
            }
          }
        };
        inputWithListener.add(input);
      }

      if (!deviceToPianoMap.has(input)) {
        deviceToPianoMap.set(input, new Set());
      }
      deviceToPianoMap.get(input).add(pianoId);
    }
  });
}

function removePianoFromDevices(pianoId) {
  for (const [input, pianoSet] of deviceToPianoMap.entries()) {
    pianoSet.delete(pianoId);
    if (pianoSet.size === 0) {
      input.onmidimessage = null;
      deviceToPianoMap.delete(input);
      inputWithListener.delete(input);
    }
  }
}

export { listenEvent, removePianoFromDevices };