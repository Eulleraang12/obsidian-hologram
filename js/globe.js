// globe.js — Esfera 3D holográfica com nós do Obsidian na superfície
import * as THREE from 'three';

const GLOBE_RADIUS = 5;
const ROTATION_SPEED = 0.0008;

function hexToColor(hex) {
  if (!hex) return new THREE.Color(0x00d4ff);
  return new THREE.Color(hex);
}

function fibonacciSphere(count, radius) {
  const points = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < count; i++) {
    const theta = Math.acos(1 - (2 * (i + 0.5)) / count);
    const phi = (2 * Math.PI * i) / goldenRatio;
    points.push(new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi) * radius,
      Math.sin(theta) * Math.sin(phi) * radius,
      Math.cos(theta) * radius
    ));
  }
  return points;
}

export class Globe {
  constructor({ canvas, nodes = [], links = [] }) {
    this.canvas = canvas;
    this.nodes = nodes;
    this.links = links;
    this._nodeById = new Map();
    for (const n of nodes) this._nodeById.set(n.id, n);
    this._running = false;
    this.onNodeActivate = null;
    this._hovered = null;
    this._dragByKey = new Map();
    this._dragSet = new Set();
    this._autoRotate = true;
    this._rotationGroup = null;
    this.viewport = { x: 0, y: 0, scale: 1 };

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    // Scene + Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 14);

    // Raycaster
    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Points = { threshold: 1.2 };

    // Group que rotaciona
    this._rotationGroup = new THREE.Group();
    this.scene.add(this._rotationGroup);

    this._buildGlobe();
    this._buildNodes();
    this._buildLinks();

    this._onResize = () => this._resize();
    this._resize();
    window.addEventListener('resize', this._onResize);
  }

  _buildGlobe() {
    // Esfera wireframe holográfica
    const geo = new THREE.IcosahedronGeometry(GLOBE_RADIUS, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    this._globeMesh = new THREE.Mesh(geo, mat);
    this._rotationGroup.add(this._globeMesh);

    // Partículas ambientes na superfície
    const positions = fibonacciSphere(200, GLOBE_RADIUS);
    const geo2 = new THREE.BufferGeometry();
    const pos = new Float32Array(positions.length * 3);
    positions.forEach((p, i) => { pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z; });
    geo2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat2 = new THREE.PointsMaterial({
      color: 0xF59E0B,
      size: 0.06,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    this._ambientParticles = new THREE.Points(geo2, mat2);
    this._rotationGroup.add(this._ambientParticles);
  }

  _buildNodes() {
    this._nodeMeshes = [];
    const positions = fibonacciSphere(this.nodes.length, GLOBE_RADIUS);

    this.nodes.forEach((node, i) => {
      const pos = positions[i];
      node._spherePos = pos.clone();
      node.x = pos.x; node.y = pos.y; node.z = pos.z;

      const r = ((node.radius || 10) / 80);
      const color = hexToColor(node.color);

      // Glow externo
      const glowGeo = new THREE.SphereGeometry(r * 2.5, 8, 8);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.copy(pos);
      this._rotationGroup.add(glow);
      node._glow = glow;

      // Nó principal
      const geo = new THREE.SphereGeometry(r, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      this._rotationGroup.add(mesh);
      node._mesh = mesh;
      node._baseColor = color;
      this._nodeMeshes.push(mesh);
    });
  }

  _buildLinks() {
    const positions = [];
    for (const l of this.links) {
      const a = this._nodeById.get(l.source);
      const b = this._nodeById.get(l.target);
      if (!a?._spherePos || !b?._spherePos) continue;
      positions.push(a._spherePos.x, a._spherePos.y, a._spherePos.z);
      positions.push(b._spherePos.x, b._spherePos.y, b._spherePos.z);
    }
    const colors = [];
    const dim = [0.18, 0.45, 0.7];
    for (let i = 0; i < positions.length / 6; i++) colors.push(...dim, ...dim);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this._linksMesh = new THREE.LineSegments(geo, mat);
    this._rotationGroup.add(this._linksMesh);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async start() {
    if (this._running) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      if (this._autoRotate) {
        this._rotationGroup.rotation.y += ROTATION_SPEED;
      }
      // Pulso nos nós
      const t = performance.now() * 0.001;
      this.nodes.forEach((node, i) => {
        if (node._mesh && !this._dragSet.has(node)) {
    const pulse = 1 + Math.sin(t + i * 0.5) * 0.15;
    node._mesh.scale.setScalar(pulse);
}
if (node._glow && !this._dragSet.has(node)) {
    const pulse2 = 1 + Math.sin(t * 0.7 + i * 0.3) * 0.2;
    node._glow.scale.setScalar(pulse2);
}
      });
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  stop() { this._running = false; }

  rotate(dx, dy) {
    this._autoRotate = false;
    this._rotationGroup.rotation.y += dx * 0.01;
    this._rotationGroup.rotation.x += dy * 0.01;
    setTimeout(() => { this._autoRotate = true; }, 2000);
  }

  setZoom(factor) {
    const z = this.camera.position.z / factor;
    this.camera.position.z = Math.max(6, Math.min(40, z));
  }

  pan(dx, dy) {
    this.camera.position.x -= dx * 0.02;
    this.camera.position.y += dy * 0.02;
  }

  pickNode(sx, sy) {
    const ndc = new THREE.Vector2(
      (sx / window.innerWidth) * 2 - 1,
      -(sy / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._nodeMeshes);
    if (!hits.length) return null;
    return this.nodes.find(n => n._mesh === hits[0].object) || null;
  }

  hoverNode(node) {
    this._hovered = node || null;
    const label = document.getElementById('hover-label');
    if (!label) return;
    if (node && node._mesh) {
        const pos = node._mesh.position.clone();
        this._rotationGroup.localToWorld(pos);
        pos.project(this.camera);
        const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-pos.y * 0.5 + 0.5) * window.innerHeight + 20;
        label.textContent = node.label || node.id || '';
        label.style.display = 'block';
        label.style.left = x + 'px';
        label.style.top = y + 'px';
        label.style.transform = 'translateX(-50%)';
        label.style.bottom = '';
    } else {
        label.style.display = 'none';
    }
}

  beginDragNode(node, sx, sy, key = '__default') {
    if (!node) return;
    this._dragByKey.set(key, node);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
    this._autoRotate = false;
    this.hoverNode(node);
    if (node._mesh) {
        node._mesh.material.color.set(0xffffff);
        node._mesh.scale.setScalar(2.5);
    }
    if (node._glow) {
        node._glow.material.opacity = 0.5;
        node._glow.scale.setScalar(3);
    }
    if (this._linksMesh) {
        const colorAttr = this._linksMesh.geometry.getAttribute('color');
        this.links.forEach((l, idx) => {
            const connected = l.source === node.id || l.target === node.id;
            const r = connected ? 0.0 : 0.18;
            const g = connected ? 1.0 : 0.45;
            const b = connected ? 1.0 : 0.7;
            colorAttr.setXYZ(idx*2, r, g, b);
            colorAttr.setXYZ(idx*2+1, r, g, b);
        });
        colorAttr.needsUpdate = true;
        this._linksMesh.material.opacity = 0.7;
    }
}

  dragNode(sx, sy, key = '__default') {
    const node = this._dragByKey.get(key);
    if (!node || !node._mesh) return;
    const ndc = new THREE.Vector2(
        (sx / window.innerWidth) * 2 - 1,
        -(sy / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const ray = this._raycaster.ray;
    const dist = node._mesh.position.length();
    const target = ray.direction.clone().multiplyScalar(dist + this.camera.position.z);
    const worldPos = target.add(this.camera.position);
    const localPos = this._rotationGroup.worldToLocal(worldPos.clone());
    const spherePos = localPos.normalize().multiplyScalar(GLOBE_RADIUS);
    node._mesh.position.copy(spherePos);
    node._glow?.position.copy(spherePos);
    node._spherePos = spherePos.clone();
    if (this._linksMesh) {
        const posAttr = this._linksMesh.geometry.getAttribute('position');
        this.links.forEach((l, idx) => {
            if (l.source === node.id) posAttr.setXYZ(idx*2, spherePos.x, spherePos.y, spherePos.z);
            else if (l.target === node.id) posAttr.setXYZ(idx*2+1, spherePos.x, spherePos.y, spherePos.z);
        });
        posAttr.needsUpdate = true;
    }
}

  endDrag(key = '__default') {
    const node = this._dragByKey.get(key);
    if (node && node._mesh) {
        node._mesh.material.color.set(node._baseColor);
        node._mesh.scale.setScalar(1);
    }
    if (node && node._glow) {
        node._glow.material.opacity = 0.12;
        node._glow.scale.setScalar(1);
    }
    if (this._linksMesh) {
        const colorAttr = this._linksMesh.geometry.getAttribute('color');
        const dim = [0.18, 0.45, 0.7];
        for (let i = 0; i < this.links.length; i++) {
            colorAttr.setXYZ(i*2, ...dim);
            colorAttr.setXYZ(i*2+1, ...dim);
        }
        colorAttr.needsUpdate = true;
        this._linksMesh.material.opacity = 0.5;
    }
    this._dragByKey.delete(key);
    this._dragSet.clear();
    for (const n of this._dragByKey.values()) this._dragSet.add(n);
    this.hoverNode(null);
    setTimeout(() => { this._autoRotate = true; }, 2000);
}

  endAllDrags() {
    this._dragByKey.clear();
    this._dragSet.clear();
  }

  zoomAt(sx, sy, factor) { this.setZoom(factor); }

  repelAt(sx, sy, radius, strength) {
    // Repulsão = impulso de rotação
    this._rotationGroup.rotation.y += (Math.random() - 0.5) * 0.3;
    this._rotationGroup.rotation.x += (Math.random() - 0.5) * 0.1;
  }

  focusNode(node) {
    if (!node) return;
    if (this.onNodeActivate) this.onNodeActivate(node);
  }

  resetView() {
    this.camera.position.set(0, 0, 14);
    this._rotationGroup.rotation.set(0, 0, 0);
    this._autoRotate = true;
  }

  setOnNodeActivate(fn) { this.onNodeActivate = fn; }
  getViewport() { return { ...this.viewport }; }
  getBounds() { return { minX: -10, minY: -10, maxX: 10, maxY: 10 }; }
}
