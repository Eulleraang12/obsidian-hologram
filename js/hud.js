// hud.js  HUD overlay: corners, clock, minimap, FPS

const FOLDERS = [
  { name: 'Campanhas', color: '#3aa0ff' },
  { name: 'Criativos', color: '#3cff9a' },
  { name: 'Decisões', color: '#ff4d5a' },
  { name: 'Padrões', color: '#b266ff' },
  { name: 'Produtos', color: '#FFD700' },
  { name: 'INDEX', color: '#ffd84d' }
];

function injectHudStyles() {
  if (document.getElementById('hud-styles')) return;
  const css = `
  .hud-tl,.hud-tr,.hud-bl,.hud-br{position:fixed;font-family:'Orbitron',monospace;
    color:#4FE3FF;font-size:11px;letter-spacing:2px;text-transform:uppercase;
    padding:10px 14px;background:rgba(0,0,0,0.55);border:1px solid rgba(0,212,255,0.45);
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:50;pointer-events:none;
    box-shadow:0 0 14px rgba(0,212,255,0.12);}
  .hud-tl{top:16px;left:16px;}
  .hud-tr{top:16px;right:16px;text-align:right;}
  .hud-bl{bottom:16px;left:16px;}
  .hud-br{bottom:16px;right:16px;}
  .hud-dot{display:inline-block;width:8px;height:8px;border-radius:50%;
    background:#00D4FF;box-shadow:0 0 8px #00D4FF;margin-right:8px;vertical-align:middle;
    animation:hudpulse 1.4s ease-in-out infinite;}
  .hud-dot.green{background:#3cff9a;box-shadow:0 0 8px #3cff9a;}
  @keyframes hudpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
  .hud-legend{display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;}
  .hud-legend span{display:inline-flex;align-items:center;gap:4px;font-size:9px;opacity:.85;}
  .hud-legend i{display:inline-block;width:9px;height:9px;}
  .hud-clock{font-size:14px;color:#4FE3FF;margin-top:3px;letter-spacing:3px;}
  .minimap{position:fixed;top:84px;right:16px;width:220px;height:140px;
    background:rgba(0,0,0,0.7);border:1px solid rgba(0,212,255,0.45);
    box-shadow:0 0 14px rgba(0,212,255,0.15);z-index:50;pointer-events:none;}
  `;
  const s = document.createElement('style');
  s.id = 'hud-styles'; s.textContent = css;
  document.head.appendChild(s);
}

export class HUD {
  constructor({ root, graph }) {
    this.root = root;
    this.graph = graph;
    this._stats = { nodes: 0, links: 0 };
    this._fps = 0;
    this._lastFrame = 0;
    this._running = false;
    injectHudStyles();
    this._build();
  }

  _build() {
    const tl = document.createElement('div');
    tl.className = 'hud-tl';
    tl.innerHTML = `<span class="hud-dot"></span>J.A.R.V.I.S. <span style="opacity:.6">/</span> DATASKY VAULT`;
    this.root.appendChild(tl);

    const tr = document.createElement('div');
    tr.className = 'hud-tr';
    tr.innerHTML = `<div><span class="hud-dot green"></span>ONLINE</div><div class="hud-clock">00:00:00</div>`;
    this.root.appendChild(tr);
    this._clockEl = tr.querySelector('.hud-clock');

    const bl = document.createElement('div');
    bl.className = 'hud-bl';
    const legend = FOLDERS.map(f => `<span><i style="background:${f.color};box-shadow:0 0 6px ${f.color}"></i>${f.name}</span>`).join('');
    bl.innerHTML = `<div class="hud-stats">NODES: 0 &nbsp;&bull;&nbsp; LINKS: 0 &nbsp;&bull;&nbsp; FPS: 0</div><div class="hud-legend">${legend}</div>`;
    this.root.appendChild(bl);
    this._statsEl = bl.querySelector('.hud-stats');

    const br = document.createElement('div');
    br.className = 'hud-br';
    br.textContent = 'GESTURE: —';
    this.root.appendChild(br);
    this._gestureEl = br;

    const mm = document.createElement('canvas');
    mm.className = 'minimap';
    mm.width = 220; mm.height = 140;
    mm.style.display = 'none'; // hidden — particle playground has nothing meaningful to map
    this.root.appendChild(mm);
    this._minimap = mm;
    this._mmCtx = mm.getContext('2d');
  }

  setGesture(name) {
    this._gestureEl.textContent = 'GESTURE: ' + (name || '—').toUpperCase();
  }

  setStatus(text) {
    // repurpose tr first line
    const tr = this.root.querySelector('.hud-tr');
    if (tr) {
      const first = tr.firstElementChild;
      if (first) first.innerHTML = `<span class="hud-dot green"></span>${text}`;
    }
  }

  updateStats({ nodes, links }) {
    if (typeof nodes === 'number') this._stats.nodes = nodes;
    if (typeof links === 'number') this._stats.links = links;
    this._renderStats();
  }

  _renderStats() {
    this._statsEl.innerHTML = `NODES: ${this._stats.nodes} &nbsp;&bull;&nbsp; LINKS: ${this._stats.links} &nbsp;&bull;&nbsp; FPS: ${this._fps}`;
  }

  start() {
    if (this._running) return;
    this._running = true;

    this._tickClock();
    this._clockTimer = setInterval(() => this._tickClock(), 1000);

    // Minimap disabled for particle playground
    // this._mmTimer = setInterval(() => this._drawMinimap(), 100);

    const loop = (t) => {
      if (!this._running) return;
      if (this._lastFrame) {
        const dt = t - this._lastFrame;
        if (dt > 0) {
          const cur = 1000 / dt;
          this._fps = Math.round(this._fps * 0.9 + cur * 0.1);
        }
      }
      this._lastFrame = t;
      this._renderStats();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._clockTimer) clearInterval(this._clockTimer);
    if (this._mmTimer) clearInterval(this._mmTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _tickClock() {
    try {
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      this._clockEl.textContent = fmt.format(new Date());
    } catch (_) {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      this._clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  _folderColor(folder) {
    const f = FOLDERS.find(x => x.name === folder);
    return f ? f.color : '#00D4FF';
  }

  _drawMinimap() {
    const ctx = this._mmCtx;
    const W = this._minimap.width, H = this._minimap.height;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);

    if (!this.graph || typeof this.graph.getBounds !== 'function') return;
    const b = this.graph.getBounds();
    if (!b || b.maxX === b.minX || b.maxY === b.minY) return;

    const pad = 8;
    const sx = (W - pad * 2) / (b.maxX - b.minX);
    const sy = (H - pad * 2) / (b.maxY - b.minY);
    const s = Math.min(sx, sy);
    const ox = pad + ((W - pad * 2) - (b.maxX - b.minX) * s) / 2;
    const oy = pad + ((H - pad * 2) - (b.maxY - b.minY) * s) / 2;
    const toX = (x) => ox + (x - b.minX) * s;
    const toY = (y) => oy + (y - b.minY) * s;

    const nodes = this.graph.nodes || (this.graph.getNodes && this.graph.getNodes()) || [];
    ctx.globalAlpha = 0.9;
    for (const n of nodes) {
      ctx.fillStyle = this._folderColor(n.data?.folder ?? n.folder);
      ctx.fillRect(toX(n.x) - 1, toY(n.y) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    if (typeof this.graph.getViewport === 'function') {
      const v = this.graph.getViewport();
      const cw = this.graph._cw || window.innerWidth;
      const ch = this.graph._ch || window.innerHeight;
      if (v && v.scale) {
        const halfW = cw / v.scale / 2;
        const halfH = ch / v.scale / 2;
        const vMinX = v.x - halfW;
        const vMinY = v.y - halfH;
        ctx.strokeStyle = 'rgba(0,212,255,0.9)';
        ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(0,212,255,0.8)';
        ctx.shadowBlur = 4;
        ctx.strokeRect(toX(vMinX), toY(vMinY), (halfW * 2) * s, (halfH * 2) * s);
        ctx.shadowBlur = 0;
      }
    }

    ctx.strokeStyle = 'rgba(0,212,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
}
