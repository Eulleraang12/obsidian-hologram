// starfield.js — Campo estelar reativo estilo J.A.R.V.I.S.
export class Starfield {
  constructor({ canvas }) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._stars = [];
    this._running = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._initStars();
  }

  _resize() {
    this._canvas.width = window.innerWidth;
    this._canvas.height = window.innerHeight;
  }

  _initStars() {
    this._stars = [];
    const count = 220;
    for (let i = 0; i < count; i++) {
      this._stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.5 + 0.2,
        opacity: Math.random() * 0.6 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleOffset: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        color: Math.random() > 0.85 ? '#00d4ff' : '#ffffff',
      });
    }
  }

  shockwave(cx, cy, strength = 1) {
    this._stars.forEach(s => {
      const dx = s.x - cx;
      const dy = s.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (400 / dist) * strength;
      s.vx += (dx / dist) * force * 0.15;
      s.vy += (dy / dist) * force * 0.15;
    });
  }

  implode(cx, cy) {
    this._stars.forEach(s => {
      const dx = cx - s.x;
      const dy = cy - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      s.vx += (dx / dist) * 3;
      s.vy += (dy / dist) * 3;
    });
    setTimeout(() => {
      this._stars.forEach(s => { s.vx *= -0.3; s.vy *= -0.3; });
    }, 300);
  }

  start() {
    this._running = true;
    this._tick();
  }

  _tick() {
    if (!this._running) return;
    const ctx = this._ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    const t = performance.now() * 0.001;
    this._stars.forEach(s => {
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.96;
      s.vy *= 0.96;
      if (s.x < 0) s.x = w;
      if (s.x > w) s.x = 0;
      if (s.y < 0) s.y = h;
      if (s.y > h) s.y = 0;
      const twinkle = Math.sin(t * s.twinkleSpeed * 60 + s.twinkleOffset) * 0.3 + 0.7;
      const op = s.opacity * twinkle;
      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle = s.color;
      ctx.shadowBlur = s.r > 1 ? 6 : 0;
      ctx.shadowColor = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    requestAnimationFrame(() => this._tick());
  }
}
