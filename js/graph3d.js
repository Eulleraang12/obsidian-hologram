// graph3d.js — Three.js 3D force-directed graph
import * as THREE from 'three';

const LINK_DIST = 4;
const LINK_STRENGTH = 0.015;
const REPULSION = 8;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.008;

function hexToColor(hex) {
  if (!hex) return new THREE.Color(0x00d4ff);
  return new THREE.Color(hex);
}

export class Graph3D {
  constructor({ canvas, nodes = [], links = [] }) {
    this.canvas = canvas;
    this.nodes = nodes;
    this.links = links;
    this._nodeById = new Map();
    for (const n of nodes) this._nodeById.set(n.id, n);
    this._running = false;
    this._hovered = null;
    this._dragByKey = new Map();
    this._dragSet = new Set();
    this.onNodeActivate = null;
    this._focusTarget = null;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 18);

    // Viewport (pan/zoom state)
    this.viewport = { x: 0, y: 0, scale: 1 };

    // Seed 3D positions
    this._seed3D();

    // Build meshes
    this._buildMeshes();

    // Resize
    this._onResize = () => this._resize();
    this._resize();
    window.addEventListener('resize', this._onResize);
  }

  _seed3D() {
    const n = this.nodes.length;
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    let i = 0;
    for (const node of this.nodes) {
      if (node.isIndex) { node.x = 0; node.y = 0; node.z = 0; node.vx = 0; node.vy = 0; node.vz = 0; i++; continue; }
      const theta = Math.acos(1 - (2 * (i + 0.5)) / n);
      const phi = (2 * Math.PI * i) / goldenRatio;
      const r = 5 + Math.random() * 3;
      node.x = Math.sin(theta) * Math.cos(phi) * r;
      node.y = Math.sin(theta) * Math.sin(phi) * r;
      node.z = Math.cos(theta) * r;
      node.vx = 0; node.vy = 0; node.vz = 0;
      i++;
    }
  }

  _buildMeshes() {
    this._nodeMeshes = new Map();
    for (const node of this.nodes) {
      const r = (node.radius || 10) / 18;
      const geo = new THREE.SphereGeometry(r, 16, 16);
      const color = hexToColor(node.color);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(node.x, node.y, node.z);
      this.scene.add(mesh);
      node._mesh = mesh;
      node._baseColor = color;

      // Glow
      const glowGeo = new THREE.SphereGeometry(r * 1.8, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      mesh.add(glow);
      node._glow = glow;
    }

    // Lines
    this._linePositions = new Float32Array(this.links.length * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this._linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    this._linesMesh = new THREE.LineSegments(lineGeo, lineMat);
    this.scene.add(this._linesMesh);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _simulate() {
    const nodes = this.nodes;
    const alpha = 0.3;

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (this._dragSet.has(a)) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = Math.max(dx*dx + dy*dy + dz*dz, 0.01);
        const d = Math.sqrt(d2);
        const f = (REPULSION / d2) * alpha;
        if (!this._dragSet.has(a)) { a.vx += (dx/d)*f; a.vy += (dy/d)*f; a.vz += (dz/d)*f; }
        if (!this._dragSet.has(b)) { b.vx -= (dx/d)*f; b.vy -= (dy/d)*f; b.vz -= (dz/d)*f; }
      }
    }

    // Links
    for (const l of this.links) {
      const a = this._nodeById.get(l.source);
      const b = this._nodeById.get(l.target);
      if (!a || !b) continue;
      const dx = b.x-a.x, dy = b.y-a.y, dz = b.z-a.z;
      const d = Math.hypot(dx, dy, dz) || 0.01;
      const diff = (d - LINK_DIST) * LINK_STRENGTH * alpha;
      const fx = (dx/d)*diff, fy = (dy/d)*diff, fz = (dz/d)*diff;
      if (!this._dragSet.has(a)) { a.vx += fx; a.vy += fy; a.vz += fz; }
      if (!this._dragSet.has(b)) { b.vx -= fx; b.vy -= fy; b.vz -= fz; }
    }

    // Integrate
    for (const node of nodes) {
      if (this._dragSet.has(node)) { node.vx = 0; node.vy = 0; node.vz = 0; continue; }
      node.vx += -node.x * CENTER_GRAVITY * alpha;
      node.vy += -node.y * CENTER_GRAVITY * alpha;
      node.vz += -node.z * CENTER_GRAVITY * alpha;
      node.vx *= DAMPING; node.vy *= DAMPING; node.vz *= DAMPING;
      node.x += node.vx; node.y += node.vy; node.z += node.vz;
      if (node._mesh) node._mesh.position.set(node.x, node.y, node.z);
    }

    // Update lines
    for (let i = 0; i < this.links.length; i++) {
      const a = this._nodeById.get(this.links[i].source);
      const b = this._nodeById.get(this.links[i].target);
      if (!a || !b) continue;
      this._linePositions[i*6] = a.x; this._linePositions[i*6+1] = a.y; this._linePositions[i*6+2] = a.z;
      this._linePositions[i*6+3] = b.x; this._linePositions[i*6+4] = b.y; this._linePositions[i*6+5] = b.z;
    }
    this._linesMesh.geometry.attributes.position.needsUpdate = true;
  }

  async start() {
    if (this._running) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this._simulate();
      if (this._focusTarget) {
        const t = this._focusTarget;
        this.camera.position.x += (-t.x * 0.3 - this.camera.position.x) * 0.08;
        this.camera.position.y += (-t.y * 0.3 - this.camera.position.y) * 0.08;
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  stop() { this._running = false; }

  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    return target;
  }

  pickNode(sx, sy) {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.nodes.map(n => n._mesh).filter(Boolean);
    const hits = raycaster.intersectObjects(meshes);
    if (!hits.length) return null;
    return this.nodes.find(n => n._mesh === hits[0].object) || null;
  }

  hoverNode(node) { this._hovered = node || null; }

  beginDragNode(node, sx, sy, key = '__default') {
    if (!node) return;
    this._dragByKey.set(key, node);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
  }

  dragNode(sx, sy, key = '__default') {
    const node = this._dragByKey.get(key);
    if (!node) return;
    const w = this.screenToWorld(sx, sy);
    node.x = w.x; node.y = w.y;
    node.vx = 0; node.vy = 0;
    if (node._mesh) node._mesh.position.set(node.x, node.y, node.z);
  }

  endDrag(key = '__default') {
    this._dragByKey.delete(key);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
  }

  endAllDrags() { this._dragByKey.clear(); this._dragSet.clear(); }

  pan(dx, dy) {
    this.camera.position.x -= dx * 0.02;
    this.camera.position.y += dy * 0.02;
  }

  zoomAt(sx, sy, factor) {
    const z = this.camera.position.z / factor;
    this.camera.position.z = Math.max(4, Math.min(50, z));
  }

  repelAt(sx, sy, radius, strength) {
    const w = this.screenToWorld(sx, sy);
    for (const n of this.nodes) {
      const dx = n.x - w.x, dy = n.y - w.y;
      const d = Math.hypot(dx, dy);
      const r = radius * 0.03;
      if (d < r && d > 0.01) {
        const f = strength * (1 - d / r) * 0.002;
        n.vx += (dx/d)*f; n.vy += (dy/d)*f; n.vz += (Math.random()-0.5)*f;
      }
    }
  }

  focusNode(node) {
    if (!node) return;
    this._focusTarget = node;
    if (this.onNodeActivate) this.onNodeActivate(node);
  }

  resetView() {
    this.camera.position.set(0, 0, 18);
    this._focusTarget = null;
  }

  rotate(dx, dy) {
    const euler = new THREE.Euler(dy * 0.008, dx * 0.008, 0, 'XYZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    for (const node of this.nodes) {
      const v = new THREE.Vector3(node.x, node.y, node.z).applyQuaternion(q);
      node.x = v.x; node.y = v.y; node.z = v.z;
      if (node._mesh) node._mesh.position.set(node.x, node.y, node.z);
    }
  }

  setOnNodeActivate(fn) { this.onNodeActivate = fn; }
  getViewport() { return { ...this.viewport }; }
  getBounds() { return { minX: -10, minY: -10, maxX: 10, maxY: 10 }; }
}
