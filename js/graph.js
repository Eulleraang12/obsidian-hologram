// graph.js — PixiJS v8 force-directed graph (Obsidian-style, Jarvis palette)
// Renders colored nodes (per folder) + links, with pan/zoom/drag/hover/focus.
// Supports multi-hand drag via keyed drag sessions.

const DEFAULT_HEX = 0x00d4ff;

function hexToInt(hex) {
  if (typeof hex !== 'string') return DEFAULT_HEX;
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? n : DEFAULT_HEX;
}

// Simulation params (d3-force inspired: cooling alpha + spread-out layout)
const LINK_DIST = 135;
const LINK_STRENGTH = 0.022;
const REPULSION = 3600;
const MIN_DIST2 = 225;       // floor on d² to kill singularities (15px)
const CENTER_GRAVITY = 0.010;
const DAMPING = 0.72;
const MAX_VEL = 7;
const VEL_SNAP = 0.05;       // snap small velocities to 0 (kill jitter)
const ALPHA_DECAY = 0.992;
const ALPHA_MIN = 0.02;
const REHEAT_ON_INTERACT = 0.35;

export class GraphEngine {
  constructor({ canvas, nodes = [], links = [] }) {
    this.canvas = canvas;
    this.nodes = nodes;
    this.links = links;

    this.onNodeActivate = null;
    this._running = false;
    this._ready = false;
    this.app = null;

    this._cw = canvas.clientWidth || window.innerWidth;
    this._ch = canvas.clientHeight || window.innerHeight;

    this.viewport = { x: 0, y: 0, scale: 1 };

    this._nodeById = new Map();
    for (const n of nodes) this._nodeById.set(n.id, n);

    this._hovered = null;
    // Multi-hand drag: key -> node. Set mirrors values for O(1) membership.
    this._dragByKey = new Map();
    this._dragSet = new Set();
    this._focusTarget = null;

    this._alpha = 1;
    this._seedLayout();
  }

  _seedLayout() {
    const n = this.nodes.length;
    if (!n) return;
    let i = 0;
    for (const node of this.nodes) {
      if (node.isIndex) { node.x = 0; node.y = 0; node.vx = 0; node.vy = 0; continue; }
      const k = i++;
      const ring = 1 + Math.floor(k / 14);
      const per = 14 + ring * 4;
      const idxInRing = k % per;
      const ang = (idxInRing / per) * Math.PI * 2 + ring * 0.37;
      const r = 120 + ring * 85;
      node.x = Math.cos(ang) * r + (Math.random() - 0.5) * 8;
      node.y = Math.sin(ang) * r + (Math.random() - 0.5) * 8;
      node.vx = 0;
      node.vy = 0;
    }
  }

  _reheat(v = REHEAT_ON_INTERACT) {
    if (v > this._alpha) this._alpha = v;
  }

  _isDragging(node) {
    return this._dragSet.has(node);
  }

  setOnNodeActivate(fn) { this.onNodeActivate = fn; }

  async start() {
    if (this._running) return;
    if (!this._ready) await this._initPixi();
    this._running = true;
    this.app.ticker.add(this._frame, this);
  }

  stop() {
    this._running = false;
    if (this.app?.ticker) this.app.ticker.remove(this._frame, this);
  }

  async _initPixi() {
    const rect = this.canvas.getBoundingClientRect();
    this._cw = rect.width || window.innerWidth;
    this._ch = rect.height || window.innerHeight;

    this.app = new PIXI.Application();
    await this.app.init({
      canvas: this.canvas,
      width: this._cw,
      height: this._ch,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
    });

    this.worldContainer = new PIXI.Container();
    this.app.stage.addChild(this.worldContainer);
    this._applyViewport();

    this.linkLayer = new PIXI.Graphics();
    this.linkLayer.blendMode = 'add';
    this.worldContainer.addChild(this.linkLayer);

    this.nodeLayer = new PIXI.Container();
    this.worldContainer.addChild(this.nodeLayer);

    this.labelLayer = new PIXI.Container();
    this.worldContainer.addChild(this.labelLayer);

    this._buildNodeSprites();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);

    this._ready = true;
  }

  _buildNodeSprites() {
    for (const node of this.nodes) {
      const color = hexToInt(node.color);
      const g = new PIXI.Graphics();
      const r = node.radius || 10;
      g.circle(0, 0, r + 6).fill({ color, alpha: 0.12 });
      g.circle(0, 0, r + 3).fill({ color, alpha: 0.22 });
      g.circle(0, 0, r).fill({ color, alpha: 0.95 });
      g.circle(0, 0, Math.max(2, r * 0.45)).fill({ color: 0xffffff, alpha: 0.85 });
      if (node.doubleBorder) {
        g.circle(0, 0, r + 2).stroke({ color, width: 1.5, alpha: 0.8 });
      }
      g.x = node.x;
      g.y = node.y;
      g.eventMode = 'none';
      this.nodeLayer.addChild(g);
      node._gfx = g;
      node._baseColor = color;

      const style = new PIXI.TextStyle({
        fontFamily: 'Orbitron, Arial, sans-serif',
        fontSize: node.isIndex ? 13 : 11,
        fill: node.isIndex ? 0xffffff : 0xcfeaff,
        stroke: { color: 0x001018, width: 3 },
      });
      const label = new PIXI.Text({ text: node.label || node.title || node.id, style });
      label.anchor.set(0.5, 0);
      label.x = node.x;
      label.y = node.y + r + 4;
      label.alpha = 0;
      this.labelLayer.addChild(label);
      node._label = label;
    }
  }

  _applyViewport() {
    const { x, y, scale } = this.viewport;
    this.worldContainer.position.set(this._cw / 2 + x, this._ch / 2 + y);
    this.worldContainer.scale.set(scale, scale);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this._cw = w; this._ch = h;
    if (this.app?.renderer) this.app.renderer.resize(w, h);
    this._applyViewport();
  }

  screenToWorld(sx, sy) {
    const { x, y, scale } = this.viewport;
    return {
      x: (sx - this._cw / 2 - x) / scale,
      y: (sy - this._ch / 2 - y) / scale,
    };
  }

  _simulate() {
    const nodes = this.nodes;
    const links = this.links;
    const n = nodes.length;
    const alpha = this._alpha;
    const anyDragging = this._dragSet.size > 0;

    if (alpha <= ALPHA_MIN && !anyDragging) {
      for (let i = 0; i < n; i++) {
        const node = nodes[i];
        node.vx *= 0.5; node.vy *= 0.5;
        node.x += node.vx; node.y += node.vy;
      }
      return;
    }

    // Repulsion O(n²)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const aDrag = this._dragSet.has(a);
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
        if (d2 < MIN_DIST2) d2 = MIN_DIST2;
        const d = Math.sqrt(d2);
        const f = (REPULSION / d2) * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (!aDrag) { a.vx += fx; a.vy += fy; }
        if (!this._dragSet.has(b)) { b.vx -= fx; b.vy -= fy; }
      }
    }

    // Link springs
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const a = this._nodeById.get(l.source);
      const b = this._nodeById.get(l.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const diff = (d - LINK_DIST) * LINK_STRENGTH * alpha;
      const fx = (dx / d) * diff;
      const fy = (dy / d) * diff;
      if (!this._dragSet.has(a)) { a.vx += fx; a.vy += fy; }
      if (!this._dragSet.has(b)) { b.vx -= fx; b.vy -= fy; }
    }

    // Center gravity + integrate
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      if (this._dragSet.has(node)) { node.vx = 0; node.vy = 0; continue; }
      node.vx += -node.x * CENTER_GRAVITY * alpha;
      node.vy += -node.y * CENTER_GRAVITY * alpha;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      if (node.vx > MAX_VEL) node.vx = MAX_VEL; else if (node.vx < -MAX_VEL) node.vx = -MAX_VEL;
      if (node.vy > MAX_VEL) node.vy = MAX_VEL; else if (node.vy < -MAX_VEL) node.vy = -MAX_VEL;
      if (node.vx > -VEL_SNAP && node.vx < VEL_SNAP) node.vx = 0;
      if (node.vy > -VEL_SNAP && node.vy < VEL_SNAP) node.vy = 0;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  _frame() {
    if (!this._ready) return;

    if (this._focusTarget) {
      const target = this._focusTarget;
      const desiredX = -target.x * this.viewport.scale;
      const desiredY = -target.y * this.viewport.scale;
      this.viewport.x += (desiredX - this.viewport.x) * 0.12;
      this.viewport.y += (desiredY - this.viewport.y) * 0.12;
      if (Math.abs(desiredX - this.viewport.x) < 0.5 && Math.abs(desiredY - this.viewport.y) < 0.5) {
        this._focusTarget = null;
      }
      this._applyViewport();
    }

    this._simulate();

    if (this._alpha > ALPHA_MIN) {
      this._alpha *= ALPHA_DECAY;
      if (this._alpha < ALPHA_MIN) this._alpha = ALPHA_MIN;
    }

    // Draw links
    const g = this.linkLayer;
    g.clear();
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i];
      const a = this._nodeById.get(l.source);
      const b = this._nodeById.get(l.target);
      if (!a || !b) continue;
      const highlighted = this._hovered && (a === this._hovered || b === this._hovered);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
        color: highlighted ? 0x9fefff : 0x4fe3ff,
        width: highlighted ? 1.4 : 0.6,
        alpha: highlighted ? 0.85 : 0.18,
      });
    }

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n._gfx) { n._gfx.x = n.x; n._gfx.y = n.y; }
      if (n._label) {
        n._label.x = n.x;
        n._label.y = n.y + (n.radius || 10) + 4;
        // Labels only on touch (hover or drag)
        const wantVisible = n === this._hovered || this._dragSet.has(n);
        const targetAlpha = wantVisible ? 0.95 : 0;
        n._label.alpha += (targetAlpha - n._label.alpha) * 0.2;
      }
      if (n._gfx) {
        const target = (n === this._hovered || this._dragSet.has(n)) ? 1.35 : 1;
        const cur = n._gfx.scale.x;
        n._gfx.scale.set(cur + (target - cur) * 0.2);
      }
    }
  }

  // ---------- API ----------
  pickNode(sx, sy) {
    const { x, y } = this.screenToWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const dx = n.x - x;
      const dy = n.y - y;
      const d2 = dx * dx + dy * dy;
      const r = (n.radius || 10) + 6;
      if (d2 < r * r && d2 < bestD) { best = n; bestD = d2; }
    }
    return best;
  }

  hoverNode(node) {
    this._hovered = node || null;
    if (this.canvas && this.canvas.style) {
      this.canvas.style.cursor = node ? 'pointer' : 'default';
    }
  }

  // Keyed drag API: pass a stable key per input source ('Left', 'Right', 'mouse', ...)
  beginDragNode(node, _sx, _sy, key = '__default') {
    if (!node) return;
    // If another key already holds this node, release it first
    for (const [k, v] of this._dragByKey.entries()) {
      if (v === node && k !== key) {
        this._dragByKey.delete(k);
      }
    }
    this._dragByKey.set(key, node);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
    this._reheat(0.25);
  }

  dragNode(sx, sy, key = '__default') {
    const node = this._dragByKey.get(key);
    if (!node) return;
    const w = this.screenToWorld(sx, sy);
    node.x = w.x;
    node.y = w.y;
    node.vx = 0;
    node.vy = 0;
  }

  endDrag(key = '__default') {
    this._dragByKey.delete(key);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
  }

  endAllDrags() {
    this._dragByKey.clear();
    this._dragSet.clear();
  }

  pan(dx, dy) {
    this.viewport.x += dx;
    this.viewport.y += dy;
    this._applyViewport();
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    let s = this.viewport.scale * factor;
    if (s < 0.25) s = 0.25;
    if (s > 4) s = 4;
    this.viewport.scale = s;
    const after = this.screenToWorld(sx, sy);
    this.viewport.x += (after.x - before.x) * s;
    this.viewport.y += (after.y - before.y) * s;
    this._applyViewport();
  }

  repelAt(sx, sy, radius, strength) {
    const w = this.screenToWorld(sx, sy);
    for (const n of this.nodes) {
      const dx = n.x - w.x;
      const dy = n.y - w.y;
      const d = Math.hypot(dx, dy);
      if (d < radius && d > 0.01) {
        const f = strength * (1 - d / radius) * 0.05;
        n.vx += (dx / d) * f;
        n.vy += (dy / d) * f;
      }
    }
    this._reheat(0.4);
  }

  focusNode(node) {
    if (!node) return;
    this._focusTarget = node;
    if (this.onNodeActivate) this.onNodeActivate(node);
  }

  resetView() {
    this.viewport.x = 0;
    this.viewport.y = 0;
    this.viewport.scale = 1;
    this._applyViewport();
    this._focusTarget = null;
    this._reheat(0.5);
  }

  getBounds() {
    if (!this.nodes.length) return { minX: -400, minY: -400, maxX: 400, maxY: 400 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    return { minX, minY, maxX, maxY };
  }
  getViewport() { return { ...this.viewport }; }
}
