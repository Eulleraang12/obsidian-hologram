// note-viewer.js  Holographic note panel with materialization effects

const FOLDER_COLORS = {
  Campanhas: '#3aa0ff',
  Criativos: '#3cff9a',
  'Decisões': '#ff4d5a',
  Decisoes: '#ff4d5a',
  'Padrões': '#b266ff',
  Padroes: '#b266ff',
  Produtos: '#FFD700',
  INDEX: '#ffd84d'
};

function simpleMarkdown(src) {
  if (!src) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = src.split(/\r?\n/);
  let html = '';
  let inList = false;
  let inPara = false;
  const flushPara = () => { if (inPara) { html += '</p>'; inPara = false; } };
  const flushList = () => { if (inList) { html += '</ul>'; inList = false; } };

  for (let raw of lines) {
    const line = raw;
    if (/^\s*$/.test(line)) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      html += `<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`;
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(esc(li[1]))}</li>`;
      continue;
    }
    flushList();
    if (!inPara) { html += '<p>'; inPara = true; } else { html += ' '; }
    html += inline(esc(line));
  }
  flushPara(); flushList();
  return html;

  function inline(s) {
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return s;
  }
}

function renderMarkdown(src) {
  if (typeof window !== 'undefined' && window.marked) {
    try {
      const out = window.marked.parse ? window.marked.parse(src) : window.marked(src);
      return out.replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>');
    } catch (_) {}
  }
  return simpleMarkdown(src);
}

function injectStyles() {
  if (document.getElementById('hologram-panel-styles')) return;
  const css = `
  .hologram-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scaleY(0);
    width:60vw;height:70vh;max-width:900px;max-height:700px;
    background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    border:1px solid rgba(0,212,255,0.7);box-shadow:0 0 40px rgba(0,212,255,0.25),inset 0 0 30px rgba(0,212,255,0.08);
    clip-path:polygon(18px 0,calc(100% - 18px) 0,100% 18px,100% calc(100% - 18px),calc(100% - 18px) 100%,18px 100%,0 calc(100% - 18px),0 18px);
    color:#4FE3FF;font-family:'Orbitron',monospace;z-index:9999;overflow:hidden;
    transition:transform 300ms cubic-bezier(.2,.8,.2,1);pointer-events:auto;}
  .hologram-panel.show{transform:translate(-50%,-50%) scaleY(1);}
  .hologram-panel .hp-head{display:flex;align-items:center;gap:12px;padding:14px 20px;
    border-bottom:1px solid rgba(0,212,255,0.35);text-transform:uppercase;font-size:11px;letter-spacing:2px;}
  .hologram-panel .hp-folder{padding:3px 8px;border:1px solid currentColor;border-radius:2px;font-weight:700;}
  .hologram-panel .hp-title{flex:1;color:#4FE3FF;font-size:13px;letter-spacing:1.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .hologram-panel .hp-hint{opacity:.7;font-size:10px;}
  .hologram-panel .hp-body{padding:22px 28px;overflow:auto;height:calc(100% - 52px);
    font-family:'Share Tech Mono','Consolas',monospace;font-size:13.5px;line-height:1.7;color:#4FE3FF;}
  .hologram-panel .hp-body p{margin:0 0 12px;opacity:0;transform:translateY(4px);transition:opacity 300ms,transform 300ms;}
  .hologram-panel .hp-body h1,.hp-body h2,.hp-body h3{color:#4FE3FF;letter-spacing:1.5px;margin:18px 0 10px;opacity:0;transition:opacity 300ms;}
  .hologram-panel .hp-body ul{margin:0 0 12px 18px;opacity:0;transition:opacity 300ms;}
  .hologram-panel .hp-body code{background:rgba(0,212,255,0.12);padding:1px 5px;border-radius:2px;color:#4FE3FF;}
  .hologram-panel .hp-body a{color:#7ad1ff;text-decoration:none;border-bottom:1px dashed #7ad1ff;}
  .hologram-panel .hp-body .wikilink{color:#00D4FF;border-bottom:1px dotted #00D4FF;cursor:pointer;}
  .hologram-panel .hp-scan{position:absolute;left:0;right:0;top:0;height:2px;
    background:linear-gradient(90deg,transparent,rgba(0,212,255,0.95),transparent);
    box-shadow:0 0 12px rgba(0,212,255,0.9),0 0 24px rgba(0,212,255,0.5);pointer-events:none;}
  `;
  const style = document.createElement('style');
  style.id = 'hologram-panel-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

export class NoteViewer {
  constructor({ container }) {
    this.container = container;
    this.panel = null;
    this._visible = false;
    this._busy = false;
    this._queued = null;
    injectStyles();
  }

  isVisible() { return this._visible; }

  scrollBy(dy) {
    if (!this.panel) return;
    const body = this.panel.querySelector('.hp-body');
    if (body) body.scrollTop += dy;
  }

  scrollTo(ratio) {
    if (!this.panel) return;
    const body = this.panel.querySelector('.hp-body');
    if (!body) return;
    const max = body.scrollHeight - body.clientHeight;
    body.scrollTop = Math.max(0, Math.min(max, max * ratio));
  }

  async show(note) {
    if (this._busy) { this._queued = note; return; }
    if (this._visible) { await this.hide(); }
    this._busy = true;
    const folder = note.folder || 'INDEX';
    const color = FOLDER_COLORS[folder] || '#00D4FF';

    const panel = document.createElement('div');
    panel.className = 'hologram-panel';
    panel.innerHTML = `
      <div class="hp-head">
        <span class="hp-folder" style="color:${color}">${folder}</span>
        <span class="hp-title">${(note.title || 'UNTITLED').toUpperCase()}</span>
        <span class="hp-hint">FIST TO EXIT</span>
      </div>
      <div class="hp-body"></div>
      <div class="hp-scan"></div>
    `;
    this.container.appendChild(panel);
    this.panel = panel;

    const body = panel.querySelector('.hp-body');
    body.innerHTML = renderMarkdown(note.content || '');
    const scan = panel.querySelector('.hp-scan');

    // reveal blocks starting invisible
    const blocks = body.querySelectorAll('p,h1,h2,h3,h4,ul,pre,blockquote');

    // 1. scaleY 0 to 1
    requestAnimationFrame(() => panel.classList.add('show'));
    await wait(300);

    // 2. scan line top to bottom
    scan.style.top = '0px';
    scan.style.transition = 'top 360ms linear';
    await wait(20);
    scan.style.top = 'calc(100% - 2px)';
    await wait(360);

    // 3. stagger fade
    blocks.forEach((el, i) => {
      setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, i * 40);
    });
    await wait(Math.min(blocks.length * 40, 220));

    this._visible = true;
    this._busy = false;
    if (this._queued) {
      const q = this._queued; this._queued = null;
      this.show(q);
    }
  }

  async hide() {
    if (!this.panel || this._busy) { if (this._busy) { this._queued = null; } return; }
    this._busy = true;
    const panel = this.panel;
    const body = panel.querySelector('.hp-body');
    const scan = panel.querySelector('.hp-scan');
    const blocks = body.querySelectorAll('p,h1,h2,h3,h4,ul,pre,blockquote');

    blocks.forEach((el, i) => {
      setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(4px)'; }, i * 20);
    });
    await wait(Math.min(blocks.length * 20, 180));

    scan.style.transition = 'top 320ms linear';
    scan.style.top = '0px';
    await wait(320);

    panel.classList.remove('show');
    await wait(300);

    if (panel.parentNode) panel.parentNode.removeChild(panel);
    this.panel = null;
    this._visible = false;
    this._busy = false;
  }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
