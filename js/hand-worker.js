// hand-worker.js — Web Worker for MediaPipe GestureRecognizer
// Runs inference off the main thread at ~30fps.
// Receives: ImageBitmap frames via postMessage (transferable)
// Returns: { landmarks, gestures, handedness } per hand

import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

let recognizer = null;
let customModel = null;
let canvas = null;
let ctx = null;

async function loadCustomModel(modelUrl) {
  try {
    const res = await fetch(modelUrl);
    if (!res.ok) return null;
    customModel = await res.json();
    self.postMessage({
      type: 'log',
      msg: `Custom model loaded: ${customModel.labels.join(', ')} (${(customModel.accuracy * 100).toFixed(1)}%)`
    });
    return customModel;
  } catch {
    return null;
  }
}

async function init(config) {
  self.postMessage({ type: 'status', status: 'loading' });

  // Load custom model
  if (config.customModelUrl) {
    await loadCustomModel(config.customModelUrl);
  }

  // Init MediaPipe
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    numHands: 2,
    runningMode: 'VIDEO',
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  // Create offscreen canvas for drawing ImageBitmap
  canvas = new OffscreenCanvas(config.width || 640, config.height || 480);
  ctx = canvas.getContext('2d');

  self.postMessage({ type: 'status', status: 'ready' });
}

function processFrame(bitmap, timestamp) {
  if (!recognizer || !ctx || !canvas) return;

  // Draw bitmap onto offscreen canvas
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // free memory

  let result;
  try {
    result = recognizer.recognizeForVideo(canvas, timestamp);
  } catch {
    return;
  }

  const hands = [];
  const count = result.landmarks?.length || 0;

  for (let i = 0; i < count; i++) {
    const lm = result.landmarks[i];
    const gesture = result.gestures?.[i]?.[0]?.categoryName || 'None';
    const confidence = result.gestures?.[i]?.[0]?.score || 0;
    const handed = result.handedness?.[i]?.[0]?.categoryName || 'Right';

    hands.push({
      landmarks: lm, // raw, un-mirrored (main thread handles mirroring)
      gesture,
      gestureConfidence: confidence,
      handedness: handed,
    });
  }

  // Include custom model data for main thread classification
  self.postMessage({
    type: 'result',
    hands,
    customModel: customModel ? true : false,
    timestamp,
  });
}

// Message handler
self.onmessage = async (e) => {
  const { type, ...data } = e.data;

  switch (type) {
    case 'init':
      await init(data);
      break;
    case 'frame':
      processFrame(data.bitmap, data.timestamp);
      break;
    case 'stop':
      if (recognizer) {
        recognizer.close();
        recognizer = null;
      }
      self.postMessage({ type: 'status', status: 'stopped' });
      break;
  }
};
