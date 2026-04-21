// hand-tracker.js — MediaPipe Gesture Recognizer (Tasks Vision API)
// Built-in gestures: None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou
// Pinch detection: still via landmarks (thumb+index distance) but fist is now ML-classified = no confusion

import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';
import { OneEuroFilter2D } from './one-euro-filter.js';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const DOUBLE_PINCH_MS = 400;
const DOUBLE_PINCH_DIST = 0.05;

// Custom gesture classifier trained on Euller's hands
let customModel = null;

async function loadCustomModel() {
  try {
    const res = await fetch('data/gesture-model.json');
    if (!res.ok) return null;
    customModel = await res.json();
    console.log('[HandTracker] Custom model loaded:', customModel.labels.join(', '),
      `(${(customModel.accuracy * 100).toFixed(1)}% accuracy)`);
    return customModel;
  } catch (e) {
    console.warn('[HandTracker] Custom model not found, using built-in only');
    return null;
  }
}

function classifyCustom(landmarks) {
  if (!customModel) return null;
  const wrist = landmarks[0];
  const features = [];
  for (const p of landmarks) {
    features.push(
      (p.x - wrist.x - customModel.scaler.mean[features.length]) / (customModel.scaler.scale[features.length] || 1),
    );
    features.push(
      (p.y - wrist.y - customModel.scaler.mean[features.length]) / (customModel.scaler.scale[features.length] || 1),
    );
    features.push(
      (p.z - wrist.z - customModel.scaler.mean[features.length]) / (customModel.scaler.scale[features.length] || 1),
    );
  }
  // Find nearest class centroid (Gaussian classifier)
  let bestLabel = 'none';
  let bestScore = -Infinity;
  for (const [label, cls] of Object.entries(customModel.classes)) {
    if (!cls.mean || cls.mean.length === 0) continue;
    let score = 0;
    for (let i = 0; i < features.length && i < cls.mean.length; i++) {
      const std = cls.std[i] || 1;
      const diff = features[i] - cls.mean[i];
      score -= (diff * diff) / (std * std + 0.01);
    }
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }
  return bestLabel;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export class HandTracker {
  constructor({ videoEl, onUpdate, onGesture }) {
    this.videoEl = videoEl;
    this.onUpdate = onUpdate || (() => {});
    this.onGesture = onGesture || (() => {});
    this.recognizer = null;
    this.running = false;
    this.lastGesture = null;
    this._rafId = null;
    this._lastTime = -1;
    this.state = new Map();
    this.twoHandPrevDist = null;
    this.twoHandActive = false;
    // OneEuroFilter2D per tracking point (replaces old EMA smoothPinch)
    this._filters = new Map(); // key → OneEuroFilter2D
    this.draggingHands = new Set();
    this._comboOpenFired = false;
  }

  _getFilter(key) {
    if (!this._filters.has(key)) {
      // minCutoff=1.5: smooth when slow. beta=0.01: responsive when fast.
      this._filters.set(key, new OneEuroFilter2D(1.5, 0.01, 1.0));
    }
    return this._filters.get(key);
  }

  _smoothPoint(handedness, raw) {
    const filter = this._getFilter(handedness);
    const t = performance.now() / 1000;
    return filter.filter(raw.x, raw.y, t);
  }

  _getState(handedness) {
    if (!this.state.has(handedness)) {
      this.state.set(handedness, {
        wasPinching: false,
        wasFist: false,
        pistolFired: false,
        lastPinchStartTs: 0,
        lastPinchStartPoint: null,
        lastGestureName: 'None',
      });
    }
    return this.state.get(handedness);
  }

  _emit(name, payload) {
    this.lastGesture = name;
    try {
      this.onGesture(name, payload);
    } catch (e) {
      console.error('[HandTracker] onGesture error', e);
    }
  }

  getLastGesture() {
    return this.lastGesture;
  }

  _analyzeHand(landmarks, gestureName, handedness) {
    // Mirror x for natural interaction
    const lm = landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
    const thumbTip = lm[4];
    const indexTip = lm[8];
    const rawPinch = midpoint(thumbTip, indexTip);
    const pinchPoint = this._smoothPoint(handedness, rawPinch);

    // Custom model classification (trained on Euller's hands) — used as boost/veto, not exclusive
    const customGesture = classifyCustom(lm);
    const pinchDist = dist(thumbTip, indexTip);
    const thresholdPinch = pinchDist < 0.06;

    // 🤏 Pinch: custom says pinch → YES. Custom says fist → NO. Otherwise → threshold + ML guard.
    const isPinching =
      (customGesture && customGesture.startsWith('pinch_')) ||
      (!customGesture?.startsWith('fist_') && thresholdPinch && gestureName !== 'Closed_Fist');

    // ✊ Fist: custom says fist → YES. ML says fist AND NOT threshold-pinch → YES.
    const isFist =
      (customGesture && customGesture.startsWith('fist_') && !thresholdPinch) ||
      (!customGesture && gestureName === 'Closed_Fist' && !thresholdPinch);

    // 🖐️ Open palm: custom OR ML
    const isOpen =
      (customGesture && customGesture.startsWith('open_palm_')) ||
      (!customGesture && gestureName === 'Open_Palm');

    // ☝️ Pointing: custom OR ML
    const isPointing =
      (customGesture && customGesture.startsWith('pointing_')) ||
      (!customGesture && gestureName === 'Pointing_Up');

    // 🔫 Pistola: thumb extended outward + index extended + middle/ring/pinky curled
    const thumbExtended = dist(lm[4], lm[0]) > dist(lm[3], lm[0]);
    const indexExtended = lm[8].y < lm[6].y - 0.015;
    const middleCurled = lm[12].y > lm[10].y;
    const ringCurled = lm[16].y > lm[14].y;
    const pinkyCurled = lm[20].y > lm[18].y;
    const isPistol = thumbExtended && indexExtended && middleCurled && ringCurled && pinkyCurled
      && !isPinching; // pistol has thumb far from index, pinch has them touching

    const isThumbUp = gestureName === 'Thumb_Up';
    const isVictory = gestureName === 'Victory';
    const isILoveYou = gestureName === 'ILoveYou';

    // Fist center for drag tracking
    const fistCenter = {
      x: lm[0].x * 0.3 + lm[9].x * 0.7, // weighted toward middle finger base
      y: lm[0].y * 0.3 + lm[9].y * 0.7,
    };
    const fistPoint = isFist ? this._smoothPoint(handedness + '_fist', fistCenter) : fistCenter;

    const effectiveGesture = customGesture || gestureName;

    return {
      handedness,
      landmarks: lm,
      pinchPoint,
      fistPoint,
      isPinching,
      isFist,
      isOpen,
      isPointing,
      isPistol,
      isThumbUp,
      isVictory,
      isILoveYou,
      gestureName: effectiveGesture,
    };
  }

  _processGestures(hand, now) {
    const s = this._getState(hand.handedness);

    if (this.twoHandActive) {
      s.wasPinching = hand.isPinching;
      s.wasFist = hand.isFist;
      return;
    }

    // 🤏 Pinch transitions (grab particle only, no drag)
    if (hand.isPinching && !s.wasPinching) {
      this._emit('pinchStart', { hand: hand.handedness, point: hand.pinchPoint });
      if (
        s.lastPinchStartTs &&
        now - s.lastPinchStartTs < DOUBLE_PINCH_MS &&
        s.lastPinchStartPoint &&
        dist2d(s.lastPinchStartPoint, hand.pinchPoint) < DOUBLE_PINCH_DIST
      ) {
        this._emit('doublePinch', { hand: hand.handedness, point: hand.pinchPoint });
        s.lastPinchStartTs = 0;
        s.lastPinchStartPoint = null;
      } else {
        s.lastPinchStartTs = now;
        s.lastPinchStartPoint = hand.pinchPoint;
      }
    } else if (hand.isPinching && s.wasPinching) {
      this._emit('pinchMove', { hand: hand.handedness, point: hand.pinchPoint });
    } else if (!hand.isPinching && s.wasPinching) {
      this._emit('pinchEnd', { hand: hand.handedness });
    }
    s.wasPinching = hand.isPinching;

    // ✊ Fist drag transitions (pan / rotate / drag nodes)
    if (hand.isFist && !hand.isPinching) {
      if (!s.wasFist) {
        this._emit('fistStart', { hand: hand.handedness, point: hand.fistPoint });
      } else {
        this._emit('fistMove', { hand: hand.handedness, point: hand.fistPoint });
      }
    } else if (!hand.isFist && s.wasFist) {
      this._emit('fistEnd', { hand: hand.handedness });
    }
    s.wasFist = hand.isFist && !hand.isPinching;

    // 🔫 Pistola (close note)
    if (hand.isPistol) {
      if (!s.pistolFired) {
        this._emit('pistol', { hand: hand.handedness });
        s.pistolFired = true;
      }
    } else {
      s.pistolFired = false;
    }

    // 🖐️ Open palm
    if (hand.isOpen) {
      const pts = [0, 4, 8, 12, 16, 20].map((i) => hand.landmarks[i]);
      const center = {
        x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
        y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
      };
      this._emit('openPalm', { hand: hand.handedness, center });
    }

    // ☝️ Pointing (cursor hover, not pinching)
    if (hand.isPointing && !hand.isPinching) {
      this._emit('pointing', { hand: hand.handedness, tipPoint: hand.landmarks[8] });
    }

    s.lastGestureName = hand.gestureName;
  }

  // Combo detection: runs AFTER all individual hands are processed
  _processComboGestures(hands) {
    if (hands.length < 2) return;

    // 🤏+☝️ Pinch (hand A) + Pointing (hand B) = open note
    const pincher = hands.find((h) => h.isPinching);
    const pointer = hands.find((h) => h.isPointing && !h.isPinching && h.handedness !== pincher?.handedness);

    if (pincher && pointer) {
      if (!this._comboOpenFired) {
        this._emit('comboOpenNote', {
          pinchHand: pincher.handedness,
          pointHand: pointer.handedness,
          pinchPoint: pincher.pinchPoint,
          tipPoint: pointer.landmarks[8],
        });
        this._comboOpenFired = true;
      }
    } else {
      this._comboOpenFired = false;
    }
  }

  _processTwoHandPinch(hands) {
    const pinching = hands.filter(
      (h) => h.isPinching && !this.draggingHands.has(h.handedness)
    );
    if (pinching.length >= 2) {
      const a = pinching[0].pinchPoint;
      const b = pinching[1].pinchPoint;
      const d = dist2d(a, b);
      const center = midpoint(a, b);
      const prev = this.twoHandPrevDist;
      const ratio = prev == null || prev < 0.01 ? 1 : d / prev;
      const delta = prev == null ? 0 : d - prev;
      if (!this.twoHandActive) {
        for (const [key, s] of this.state.entries()) {
          if (s.wasPinching) {
            this._emit('pinchEnd', { hand: key });
            s.wasPinching = false;
          }
        }
      }
      this.twoHandActive = true;
      this._emit('twoHandPinch', { distance: d, center, delta, ratio });
      this.twoHandPrevDist = d;
    } else {
      this.twoHandActive = false;
      this.twoHandPrevDist = null;
    }
  }

  // Process raw worker/main-thread results into analyzed hands + gesture events
  _processResults(hands) {
    const out = [];
    for (const hand of hands) {
      const lm = hand.landmarks;
      const gesture = hand.gesture || 'None';
      const handed = hand.handedness || 'Right';
      const flipped = handed === 'Left' ? 'Right' : 'Left';
      out.push(this._analyzeHand(lm, gesture, flipped));
    }

    const ts = performance.now();
    this._processTwoHandPinch(out);
    for (const h of out) this._processGestures(h, ts);
    this._processComboGestures(out);

    // Clean up stale states
    const visible = new Set(out.map((h) => h.handedness));
    for (const key of this.state.keys()) {
      if (!visible.has(key)) {
        const s = this.state.get(key);
        if (s.wasPinching) {
          this._emit('pinchEnd', { hand: key });
          s.wasPinching = false;
        }
        if (s.wasFist) {
          this._emit('fistEnd', { hand: key });
          s.wasFist = false;
        }
      }
    }

    try {
      this.onUpdate({ hands: out });
    } catch (e) {
      console.error('[HandTracker] onUpdate error', e);
    }
  }

  // Main-thread fallback: run MediaPipe directly
  _processFrameMainThread() {
    const video = this.videoEl;
    if (!video || video.readyState < 2 || !this.recognizer) return;

    const now = performance.now();
    if (now === this._lastTime) return;
    this._lastTime = now;

    let result;
    try {
      result = this.recognizer.recognizeForVideo(video, now);
    } catch {
      return;
    }

    const hands = [];
    const count = result.landmarks?.length || 0;
    for (let i = 0; i < count; i++) {
      hands.push({
        landmarks: result.landmarks[i],
        gesture: result.gestures?.[i]?.[0]?.categoryName || 'None',
        handedness: result.handedness?.[i]?.[0]?.categoryName || 'Right',
      });
    }
    this._processResults(hands);
  }

  // Worker mode: send frame to worker, receive results
  _sendFrameToWorker() {
    const video = this.videoEl;
    if (!video || video.readyState < 2 || !this._worker) return;

    // Throttle: ~30fps (every other rAF at 60fps)
    const now = performance.now();
    if (now - this._lastWorkerSend < 30) return;
    this._lastWorkerSend = now;

    // Capture frame as ImageBitmap (zero-copy transfer)
    createImageBitmap(video).then((bitmap) => {
      this._worker.postMessage(
        { type: 'frame', bitmap, timestamp: performance.now() },
        [bitmap] // transfer
      );
    }).catch(() => {});
  }

  async start() {
    if (this.running) return;

    // Ensure camera stream
    if (!this.videoEl.srcObject) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      });
      this.videoEl.srcObject = stream;
      await this.videoEl.play();
    }

    // Try Worker mode first
    const useWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

    if (useWorker) {
      console.log('[HandTracker] Starting in Worker mode (off main thread)');
      try {
        this._worker = new Worker('js/hand-worker.js', { type: 'module' });
        this._lastWorkerSend = 0;

        // Handle results from worker
        this._worker.onmessage = (e) => {
          const msg = e.data;
          if (msg.type === 'result') {
            this._processResults(msg.hands);
          } else if (msg.type === 'status') {
            console.log('[HandTracker] Worker status:', msg.status);
            if (msg.status === 'ready') {
              console.log('[HandTracker] Worker ready — tracking active');
            }
          } else if (msg.type === 'log') {
            console.log('[HandTracker]', msg.msg);
          }
        };

        this._worker.onerror = (err) => {
          console.error('[HandTracker] Worker error, falling back to main thread', err);
          this._worker = null;
          this._startMainThread();
        };

        // Init worker
        this._worker.postMessage({
          type: 'init',
          width: 640,
          height: 480,
          customModelUrl: 'data/gesture-model.json',
        });

        // Load custom model for main-thread classification too
        await loadCustomModel();

        this.running = true;
        const loop = () => {
          if (!this.running) return;
          this._sendFrameToWorker();
          this._rafId = requestAnimationFrame(loop);
        };
        loop();
        return;
      } catch (err) {
        console.warn('[HandTracker] Worker init failed, falling back', err);
        this._worker = null;
      }
    }

    // Fallback: main thread
    await this._startMainThread();
  }

  async _startMainThread() {
    console.log('[HandTracker] Starting in main-thread mode (fallback)');
    await loadCustomModel();
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.recognizer = await GestureRecognizer.createFromOptions(vision, {
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
    console.log('[HandTracker] Gesture Recognizer ready (main thread)');

    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._processFrameMainThread();
      this._rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._worker) {
      this._worker.postMessage({ type: 'stop' });
      this._worker.terminate();
      this._worker = null;
    }
    if (this.recognizer) {
      this.recognizer.close();
      this.recognizer = null;
    }
    this.state.clear();
    this.twoHandPrevDist = null;
    this.twoHandActive = false;
    this._filters.clear();
  }
}
