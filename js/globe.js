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
    // Esfera wireframe holográfica — grade lat/long estilo J.A.R.V.I.S.
    const LAT_LINES = 12;
    const LON_LINES = 16;
    const gridGroup = new THREE.Group();

    // Latitude lines
    for (let i = 1; i < LAT_LINES; i++) {
      const phi = (i / LAT_LINES) * Math.PI;
      const r = GLOBE_RADIUS * Math.sin(phi);
      const y = GLOBE_RADIUS * Math.cos(phi);
      const depth = Math.abs(Math.cos(phi)); // 1 at poles, 0 at equator
      const opacity = 0.3 + (1 - depth) * 0.3; // equator brighter
      const points = [];
      for (let j = 0; j <= 64; j++) {
        const theta = (j / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity });
      gridGroup.add(new THREE.Line(geo, mat));
    }

    // Longitude lines
    for (let i = 0; i < LON_LINES; i++) {
      const theta = (i / LON_LINES) * Math.PI * 2;
      const points = [];
      for (let j = 0; j <= 64; j++) {
        const phi = (j / 64) * Math.PI;
        points.push(new THREE.Vector3(
          GLOBE_RADIUS * Math.sin(phi) * Math.cos(theta),
          GLOBE_RADIUS * Math.cos(phi),
          GLOBE_RADIUS * Math.sin(phi) * Math.sin(theta)
        ));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.4 });
      gridGroup.add(new THREE.Line(geo, mat));
    }

    this._globeMesh = gridGroup;
    this._globeMesh.material = { opacity: 1 }; // dummy for compatibility
    this._globeMesh._setOpacity = (v) => {
      gridGroup.children.forEach(line => { line.material.opacity = line._baseOpacity * v; });
    };
    gridGroup.children.forEach(line => { line._baseOpacity = line.material.opacity; });
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

      const r = ((node.radius || 10) / 90);
      const color = hexToColor(node.color);

      // Glow externo
      const glowGeo = new THREE.SphereGeometry(r * 2.8, 8, 8);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false });
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
    const dim = [0.0, 0.35, 0.6];
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
      // Pulso nas linhas conectadas ao nó pinçado
      if (this._dragSet.size > 0 && this._linksMesh) {
        const pulse = 0.5 + Math.sin(t * 4) * 0.5;
        const colorAttr = this._linksMesh.geometry.getAttribute('color');
        const dragNode = this._dragSet.values().next().value;
        this.links.forEach((l, idx) => {
          const connected = l.source === dragNode.id || l.target === dragNode.id;
          if (connected) {
            colorAttr.setXYZ(idx*2, 0, pulse, pulse);
            colorAttr.setXYZ(idx*2+1, 0, pulse, pulse);
          }
        });
        colorAttr.needsUpdate = true;
        this._linksMesh.material.opacity = 0.5 + pulse * 0.5;
      }
      
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
        const dim = [0.0, 0.35, 0.6];
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
    // Mão empurra o globo para o lado oposto
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = (sx - cx) / window.innerWidth;
    const dy = (sy - cy) / window.innerHeight;
    this._rotationGroup.rotation.y -= dx * 0.25;
    this._rotationGroup.rotation.x -= dy * 0.25;
    this._autoRotate = false;
    clearTimeout(this._repelTimeout);
    this._repelTimeout = setTimeout(() => { this._autoRotate = true; }, 1500);
  }

  focusNode(node) {
    if (!node) return;
    if (this.onNodeActivate) this.onNodeActivate(node);
  }

  explode() {
    if (this._exploded) return;
    this._exploded = true;
    this._autoRotate = false;

    // Phase 1: electric pulse (400ms) — nodes glow cyan and pulse
    const pulseDuration = 400;
    const pulseStart = performance.now();
    const pulseTick = () => {
      const pt = Math.min((performance.now() - pulseStart) / pulseDuration, 1);
      const pulse = Math.sin(pt * Math.PI * 6) * 0.5 + 0.5;
      this.nodes.forEach(node => {
        if (!node._mesh) return;
        if (node._glow) {
          node._glow.material.color.setRGB(0, 0.8 + pulse * 0.2, 1);
          node._glow.material.opacity = 0.12 + pulse * 0.4;
        }
        node._mesh.material.color.setRGB(pulse, 1, 1);
      });
      if (pt < 1) requestAnimationFrame(pulseTick);
      else launchExplosion();
    };
    pulseTick();

    // Phase 2: explosion — nodes fly outward with exponential ease
    const launchExplosion = () => {
      this.nodes.forEach(node => {
        const dir = node._spherePos.clone().normalize();
        dir.x += (Math.random() - 0.5) * 0.6;
        dir.y += (Math.random() - 0.5) * 0.6;
        dir.z += (Math.random() - 0.5) * 0.6;
        node._explodeDir = dir.normalize();
        node._explodeOrigin = node._spherePos.clone();
      });
      const duration = 900;
      const start = performance.now();
      const tick = () => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // exponential out
        this.nodes.forEach(node => {
          if (!node._mesh) return;
          const pos = node._explodeOrigin.clone().addScaledVector(node._explodeDir, ease * 40);
          node._mesh.position.copy(pos);
          node._glow?.position.copy(pos);
          node._mesh.material.opacity = (1 - ease) * 0.95;
          node._mesh.material.color.setRGB(0, 0.8 + (1-ease)*0.2, 1);
          if (node._glow) node._glow.material.opacity = (1 - ease) * 0.12;
        });
        if (this._globeMesh._setOpacity) this._globeMesh._setOpacity(1 - ease); else this._globeMesh.material.opacity = (1 - ease) * 0.08;
        this._linksMesh.material.opacity = (1 - ease) * 0.5;
        if (t < 1) requestAnimationFrame(tick);
        else this._rotationGroup.visible = false;
      };
      tick();
    };
  }

  isExploded() { return !!this._exploded; }

  implode() {
    if (!this._exploded) return;
    this._exploded = false;
    this._rotationGroup.visible = true;
    // Capture current positions for suck-in animation
    this.nodes.forEach(node => {
      if (node._mesh) node._implodeStart = node._mesh.position.clone();
    });
    const duration = 700;
    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / duration, 1);
      const ease = t * t * t; // cubic in — accelerates toward center
      this.nodes.forEach(node => {
        if (!node._mesh) return;
        const pos = node._implodeStart
          ? node._implodeStart.clone().lerp(node._spherePos, ease)
          : node._spherePos.clone();
        node._mesh.position.copy(pos);
        node._glow?.position.copy(pos);
        node._mesh.material.opacity = ease * 0.95;
        node._mesh.material.color.set(node._baseColor);
        if (node._glow) node._glow.material.opacity = ease * 0.12;
      });
      if (this._globeMesh._setOpacity) this._globeMesh._setOpacity(ease); else this._globeMesh.material.opacity = ease * 0.08;
      this._linksMesh.material.opacity = ease * 0.5;
      if (t < 1) requestAnimationFrame(tick);
      else this._autoRotate = true;
    };
    tick();
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
