// particles.js — 3D particle sphere using Three.js
// Replaces the old 2D canvas particles with a rotatable sphere

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CONNECTION_DIST = 0.45;
const SPHERE_RADIUS = 4.5;

function fibonacciSphere(count) {
  const points = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < count; i++) {
    const theta = Math.acos(1 - (2 * (i + 0.5)) / count);
    const phi = (2 * Math.PI * i) / goldenRatio;
    const x = Math.sin(theta) * Math.cos(phi) * SPHERE_RADIUS;
    const y = Math.sin(theta) * Math.sin(phi) * SPHERE_RADIUS;
    const z = Math.cos(theta) * SPHERE_RADIUS;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

export class Particles {
  constructor({ canvas, count = 120 }) {
    this.canvas = canvas;
    this.count = count;
    this._running = false;
    this._isolated = null; // Set<number> | null

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 12);

    // Auto-rotate only — manual rotation comes from gestures/mouse via rotate()
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.enableZoom = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;

    // Manual mouse rotation (works even when graph-canvas is on top)
    this._mouseDown = false;
    this._lastMouse = { x: 0, y: 0 };
    this._onMouseDown = (e) => {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this._mouseDown = true;
        this._lastMouse = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    };
    this._onMouseMove = (e) => {
      if (!this._mouseDown) return;
      const dx = e.clientX - this._lastMouse.x;
      const dy = e.clientY - this._lastMouse.y;
      this._lastMouse = { x: e.clientX, y: e.clientY };
      this.rotate(dx, dy);
    };
    this._onMouseUp = () => { this._mouseDown = false; };
    this._onWheel = (e) => {
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      this.setZoom(factor);
    };
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });

    // Distribute points on sphere
    this._positions = fibonacciSphere(count);

    // Build particle points
    this._buildPoints();
    this._buildLines();

    // Resize handler
    this._onResize = () => this._resize();
    this._resize();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.canvas.style.position = 'fixed';
    this.canvas.style.inset = '0';
    this.canvas.style.zIndex = '0';
  }

  _buildPoints() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.count * 3);
    const sizes = new Float32Array(this.count);
    const alphas = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      const p = this._positions[i];
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      sizes[i] = 3 + Math.random() * 4;
      alphas[i] = 0.5 + Math.random() * 0.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x00d4ff) },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uPixelRatio;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (8.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        uniform vec3 uColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float glow = 1.0 - d * d;
          gl_FragColor = vec4(uColor, vAlpha * glow);
        }
      `,
    });

    this.pointsMesh = new THREE.Points(geo, mat);
    this.scene.add(this.pointsMesh);
  }

  _buildLines() {
    // Find pairs within CONNECTION_DIST
    const pairs = [];
    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        if (this._positions[i].distanceTo(this._positions[j]) < CONNECTION_DIST) {
          pairs.push(i, j);
        }
      }
    }
    this._linePairs = pairs;

    const positions = new Float32Array(pairs.length * 3);
    for (let k = 0; k < pairs.length; k++) {
      const p = this._positions[pairs[k]];
      positions[k * 3] = p.x;
      positions[k * 3 + 1] = p.y;
      positions[k * 3 + 2] = p.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.linesMesh = new THREE.LineSegments(geo, mat);
    this.scene.add(this.linesMesh);
  }

  start() {
    if (this._running) return;
    this._running = true;
    window.addEventListener('resize', this._onResize);

    const tick = () => {
      if (!this._running) return;
      this.controls.update();

      // Gentle vertex drift (breathing)
      const posAttr = this.pointsMesh.geometry.getAttribute('position');
      const t = performance.now() * 0.0003;
      for (let i = 0; i < this.count; i++) {
        const base = this._positions[i];
        const offset = Math.sin(t + i * 0.7) * 0.04;
        const dir = base.clone().normalize();
        posAttr.setXYZ(
          i,
          base.x + dir.x * offset,
          base.y + dir.y * offset,
          base.z + dir.z * offset
        );
      }
      posAttr.needsUpdate = true;

      // Update line positions to follow point drift
      const linePos = this.linesMesh.geometry.getAttribute('position');
      for (let k = 0; k < this._linePairs.length; k++) {
        const idx = this._linePairs[k];
        linePos.setXYZ(
          k,
          posAttr.getX(idx),
          posAttr.getY(idx),
          posAttr.getZ(idx)
        );
      }
      linePos.needsUpdate = true;

      // Isolation: dim non-cluster alphas
      const alphaAttr = this.pointsMesh.geometry.getAttribute('aAlpha');
      if (this._isolated) {
        for (let i = 0; i < this.count; i++) {
          alphaAttr.setX(i, this._isolated.has(i) ? 1.0 : 0.04);
        }
        this.linesMesh.material.opacity = 0.03;
      } else {
        for (let i = 0; i < this.count; i++) {
          alphaAttr.setX(i, 0.5 + Math.sin(t + i * 0.7) * 0.15);
        }
        this.linesMesh.material.opacity = 0.12;
      }
      alphaAttr.needsUpdate = true;

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
  }

  // --- External API for hand gestures ---

  rotate(deltaX, deltaY) {
    const euler = new THREE.Euler(deltaY * 0.01, deltaX * 0.01, 0, 'XYZ');
    this.pointsMesh.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(euler)
    );
    this.linesMesh.quaternion.copy(this.pointsMesh.quaternion);
  }

  setZoom(factor) {
    const dist = this.camera.position.length();
    const next = THREE.MathUtils.clamp(dist / factor, 2, 30);
    this.camera.position.normalize().multiplyScalar(next);
  }

  findNearest(screenX, screenY) {
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    raycaster.params.Points.threshold = 0.5;
    const hits = raycaster.intersectObject(this.pointsMesh);
    return hits.length > 0 ? hits[0].index : -1;
  }

  buildCluster(seedIdx) {
    const cluster = new Set([seedIdx]);
    const queue = [seedIdx];
    while (queue.length > 0) {
      const cur = queue.shift();
      const a = this._positions[cur];
      for (let j = 0; j < this.count; j++) {
        if (cluster.has(j)) continue;
        if (a.distanceTo(this._positions[j]) < CONNECTION_DIST) {
          cluster.add(j);
          queue.push(j);
        }
      }
    }
    return cluster;
  }

  isolateCluster(seedIdx) {
    this._isolated = this.buildCluster(seedIdx);
  }

  exitIsolation() {
    this._isolated = null;
  }

  isIsolated() {
    return this._isolated !== null;
  }

  resetView() {
    this.exitIsolation();
    this.camera.position.set(0, 0, 12);
    this.camera.lookAt(0, 0, 0);
    this.pointsMesh.quaternion.identity();
    this.linesMesh.quaternion.identity();
  }
}
