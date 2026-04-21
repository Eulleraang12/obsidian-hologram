// main.js — orchestrator for the J.A.R.V.I.S. DataSky Vault hologram
import { loadVault, buildGraph } from './vault-loader.js';
import { HandTracker } from './hand-tracker.js';
import { GraphEngine } from './graph.js';
import { NoteViewer } from './note-viewer.js';
import { HUD } from './hud.js';
import { Particles } from './particles.js';
import { mountCameraPicker } from './camera-picker.js';

const state = {
  // Per-hand drag: Map<handKey, node>
  dragByHand: new Map(),
  // Per-hand last pan point: Map<handKey, {sx, sy}>
  lastPanByHand: new Map(),
  cameraFallback: false,
  mouseDownNode: null,
};

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function init() {
  const video = document.getElementById('webcam');
  const graphCanvas = document.getElementById('graph-canvas');
  const particlesCanvas = document.getElementById('particles-canvas');
  const handCanvas = document.getElementById('hand-overlay');
  const hudRoot = document.getElementById('hud-root');
  const noteLayer = document.getElementById('note-layer');
  const bootScreen = document.getElementById('boot-screen');

  // graphCanvas is managed by PIXI (WebGL) — don't touch it
  sizeCanvas(handCanvas);
  window.addEventListener('resize', () => sizeCanvas(handCanvas));

  // Load vault
  const vaultData = await loadVault();
  const { nodes, links } = buildGraph(vaultData);

  // Particles (3D sphere)
  const particles = new Particles({ canvas: particlesCanvas, count: 120 });
  particles.start();
  state.particles = particles;

  // Graph
  const graph = new GraphEngine({ canvas: graphCanvas, nodes, links });
  await graph.start();
  setTimeout(() => graph.resetView && graph.resetView(), 50);

  // Webcam is now managed by HandTracker (GestureRecognizer handles stream internally)

  // HUD
  const hud = new HUD({ root: hudRoot, graph });
  hud.start();
  hud.updateStats({ nodes: nodes.length, links: links.length });

  // Note viewer
  const noteViewer = new NoteViewer({ container: noteLayer });

  // Wire node activation -> show note
  const activateNode = (node) => {
    if (!node) return;
    const payload = node.data || node;
    noteViewer.show({
      title: payload.title || node.label || node.id,
      folder: payload.folder || '',
      content: payload.content || '',
    });
  };
  if (typeof graph.setOnNodeActivate === 'function') {
    graph.setOnNodeActivate(activateNode);
  } else {
    graph.onNodeActivate = activateNode;
  }

  // Hand tracker (tracker ref captured below; closure uses let binding)
  let tracker;
  tracker = new HandTracker({
    videoEl: video,
    onUpdate: (data) => handleUpdate(data, handCanvas),
    onGesture: (name, payload) => handleGesture(name, payload, { graph, noteViewer, hud, tracker }),
  });

  try {
    await tracker.start();
    hud.setStatus('ONLINE');
    mountCameraPicker({ tracker }).catch((e) => console.warn('[main] camera picker failed', e));
  } catch (err) {
    console.warn('[main] camera denied, falling back to mouse', err);
    state.cameraFallback = true;
    hud.setStatus('CAMERA DENIED — MOUSE FALLBACK');
    document.body.style.cursor = 'crosshair';
    wireMouseFallback({ graph, noteViewer });
  }

  // Global scroll-wheel zoom (works with webcam OR mouse)
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    graph.zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  // Escape + global keys
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (noteViewer.isVisible()) noteViewer.hide();
      else graph.resetView();
    }
  });

  // Hide boot screen
  setTimeout(() => bootScreen.classList.add('hidden'), 600);
}

async function safeInit() {
  try {
    await init();
  } catch (err) {
    console.error('[main] init failed', err);
    const boot = document.getElementById('boot-screen');
    if (boot) {
      boot.textContent = 'SYSTEM ERROR — ' + (err?.message || err);
      boot.style.color = '#EF4444';
    }
  }
}

function handleUpdate({ hands }, handCanvas) {
  const ctx = handCanvas.getContext('2d');
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  if (!hands || !hands.length) return;

  for (const hand of hands) {
    if (!hand.landmarks) continue;
    // hand.landmarks already mirror-adjusted by tracker
    // Skeleton: connect a subset
    ctx.strokeStyle = 'rgba(79,227,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < hand.landmarks.length; i++) {
      const p = hand.landmarks[i];
      const x = p.x * w;
      const y = p.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fingertip glow at landmark 8
    const tip = hand.landmarks[8];
    if (tip) {
      const x = tip.x * w;
      const y = tip.y * h;
      ctx.save();
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#00D4FF';
      ctx.fillStyle = '#4FE3FF';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function toScreen(point) {
  return {
    sx: point.x * window.innerWidth,
    sy: point.y * window.innerHeight,
  };
}

function handleGesture(name, payload, ctx) {
  const { graph, noteViewer, hud, tracker } = ctx;
  hud.setGesture(name);

  switch (name) {
    // 🤏 Pinch = grab particle (highlight) + drag/pan/rotate
    case 'pinchStart': {
      const key = payload.hand || '__default';
      const { sx, sy } = toScreen(payload.point);
      // Highlight nearest particle cluster
      if (state.particles) {
        const idx = state.particles.findNearest(sx, sy);
        if (idx >= 0) state.particles.isolateCluster(idx);
      }
      // Also start drag/pan
      const node = graph.pickNode(sx, sy);
      if (node) {
        graph.beginDragNode(node, sx, sy, key);
        state.dragByHand.set(key, node);
        if (tracker) tracker.draggingHands.add(key);
      }
      state.lastPanByHand.set(key, { sx, sy, fresh: true });
      break;
    }
    case 'pinchMove': {
      const key = payload.hand || '__default';
      const { sx, sy } = toScreen(payload.point);
      const last = state.lastPanByHand.get(key);
      if (state.dragByHand.has(key)) {
        graph.dragNode(sx, sy, key);
      } else if (last) {
        if (last.fresh) {
          state.lastPanByHand.set(key, { sx, sy, fresh: false });
          break;
        }
        const dx = sx - last.sx;
        const dy = sy - last.sy;
        const maxDelta = 40;
        const cdx = Math.max(-maxDelta, Math.min(maxDelta, dx));
        const cdy = Math.max(-maxDelta, Math.min(maxDelta, dy));
        if (noteViewer.isVisible()) {
          noteViewer.scrollBy(-cdy * 1.8);
        } else {
          graph.pan(cdx, cdy);
          if (state.particles) state.particles.rotate(cdx * 2, cdy * 2);
        }
      }
      state.lastPanByHand.set(key, { sx, sy, fresh: false });
      break;
    }
    case 'pinchEnd': {
      const key = payload.hand || '__default';
      graph.endDrag(key);
      state.dragByHand.delete(key);
      state.lastPanByHand.delete(key);
      if (tracker) tracker.draggingHands.delete(key);
      if (state.particles && state.particles.isIsolated()) {
        state.particles.exitIsolation();
      }
      break;
    }

    // doublePinch = disabled (notes open via combo only)
    case 'doublePinch': {
      break;
    }

    // ✊ Fist = drag / pan / rotate sphere
    case 'fistStart': {
      const key = payload.hand || '__default';
      const { sx, sy } = toScreen(payload.point);
      const node = graph.pickNode(sx, sy);
      if (node) {
        graph.beginDragNode(node, sx, sy, key);
        state.dragByHand.set(key, node);
        if (tracker) tracker.draggingHands.add(key);
      }
      // Store position but mark as "fresh" — first fistMove will only save pos, not apply delta
      state.lastPanByHand.set(key, { sx, sy, fresh: true });
      break;
    }
    case 'fistMove': {
      const key = payload.hand || '__default';
      const { sx, sy } = toScreen(payload.point);
      const last = state.lastPanByHand.get(key);
      if (state.dragByHand.has(key)) {
        graph.dragNode(sx, sy, key);
      } else if (last) {
        // Skip first frame to prevent jump (fresh flag)
        if (last.fresh) {
          state.lastPanByHand.set(key, { sx, sy, fresh: false });
          break;
        }
        const dx = sx - last.sx;
        const dy = sy - last.sy;
        // Clamp max delta to prevent jumps on tracking glitches
        const maxDelta = 40;
        const cdx = Math.max(-maxDelta, Math.min(maxDelta, dx));
        const cdy = Math.max(-maxDelta, Math.min(maxDelta, dy));
        if (noteViewer.isVisible()) {
          noteViewer.scrollBy(-cdy * 1.8);
        } else {
          graph.pan(cdx, cdy);
          if (state.particles) state.particles.rotate(cdx * 2, cdy * 2);
        }
      }
      state.lastPanByHand.set(key, { sx, sy, fresh: false });
      break;
    }
    case 'fistEnd': {
      const key = payload.hand || '__default';
      graph.endDrag(key);
      state.dragByHand.delete(key);
      state.lastPanByHand.delete(key);
      if (tracker) tracker.draggingHands.delete(key);
      break;
    }

    // 🤏+☝️ Combo: pinch (hand A) + pointing (hand B) = open note
    case 'comboOpenNote': {
      const { sx, sy } = toScreen(payload.pinchPoint);
      const node = graph.pickNode(sx, sy);
      if (node) {
        graph.focusNode(node);
      }
      break;
    }

    // 🔫 Pistola = close note
    case 'pistol': {
      if (noteViewer.isVisible()) noteViewer.hide();
      break;
    }

    // 🖐️ Open palm = repel particles / exit isolation
    case 'openPalm': {
      if (state.particles && state.particles.isIsolated()) {
        state.particles.exitIsolation();
      } else if (payload.center) {
        const { sx, sy } = toScreen(payload.center);
        graph.repelAt(sx, sy, 150, 400);
      }
      break;
    }

    // ☝️ Pointing = cursor hover
    case 'pointing': {
      if (payload.tipPoint) {
        const { sx, sy } = toScreen(payload.tipPoint);
        const node = graph.pickNode(sx, sy);
        graph.hoverNode(node);
      }
      break;
    }

    // 🤏↔️🤏 Two hand pinch = zoom
    case 'twoHandPinch': {
      if (payload.center && typeof payload.ratio === 'number') {
        const { sx, sy } = toScreen(payload.center);
        let factor = payload.ratio;
        if (factor < 0.85) factor = 0.85;
        if (factor > 1.18) factor = 1.18;
        graph.zoomAt(sx, sy, factor);
        if (state.particles) state.particles.setZoom(factor);
      }
      break;
    }

    default:
      break;
  }
}

function wireMouseFallback({ graph, noteViewer }) {
  const canvas = document.getElementById('graph-canvas');

  const MK = 'mouse';
  canvas.addEventListener('mousemove', (e) => {
    const sx = e.clientX, sy = e.clientY;
    if (state.dragByHand.has(MK)) {
      graph.dragNode(sx, sy, MK);
    } else {
      const node = graph.pickNode(sx, sy);
      graph.hoverNode(node);
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const node = graph.pickNode(sx, sy);
    if (node) {
      graph.beginDragNode(node, sx, sy, MK);
      state.dragByHand.set(MK, node);
      state.mouseDownNode = node;
    }
  });

  window.addEventListener('mouseup', () => {
    graph.endDrag(MK);
    state.dragByHand.delete(MK);
    state.mouseDownNode = null;
  });

  canvas.addEventListener('dblclick', (e) => {
    const node = graph.pickNode(e.clientX, e.clientY);
    if (node) graph.focusNode(node);
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (noteViewer.isVisible()) noteViewer.hide();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    graph.zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
