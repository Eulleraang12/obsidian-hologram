// camera-picker.js — Jarvis-style camera selector
// Lists available webcams, lets user switch on the fly

const STYLE = `
  .cam-picker {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 50;
    font-family: 'Orbitron', monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    user-select: none;
    pointer-events: auto;
  }
  .cam-picker__btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(10, 18, 28, 0.72);
    border: 1px solid rgba(245, 158, 11, 0.45);
    color: #FCD34D;
    cursor: pointer;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 0 14px rgba(245, 158, 11, 0.15), inset 0 0 12px rgba(245, 158, 11, 0.05);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .cam-picker__btn:hover {
    border-color: rgba(252, 211, 77, 0.8);
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.35), inset 0 0 12px rgba(245, 158, 11, 0.1);
  }
  .cam-picker__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #10B981;
    box-shadow: 0 0 8px #10B981;
  }
  .cam-picker__label {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cam-picker__caret {
    color: rgba(252, 211, 77, 0.6);
    font-size: 9px;
  }
  .cam-picker__menu {
    margin-top: 6px;
    background: rgba(6, 12, 20, 0.92);
    border: 1px solid rgba(245, 158, 11, 0.4);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6), 0 0 18px rgba(245, 158, 11, 0.15);
    max-height: 280px;
    overflow-y: auto;
    display: none;
  }
  .cam-picker__menu.open { display: block; }
  .cam-picker__item {
    padding: 10px 14px;
    color: rgba(252, 211, 77, 0.75);
    cursor: pointer;
    border-bottom: 1px solid rgba(245, 158, 11, 0.08);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
    transition: background 0.12s, color 0.12s;
  }
  .cam-picker__item:last-child { border-bottom: none; }
  .cam-picker__item:hover {
    background: rgba(245, 158, 11, 0.08);
    color: #FCD34D;
  }
  .cam-picker__item--active {
    color: #FCD34D;
    background: rgba(245, 158, 11, 0.12);
  }
  .cam-picker__item--active::before {
    content: '▸ ';
    color: #22D3EE;
  }
`;

function injectStyle() {
  if (document.getElementById('cam-picker-style')) return;
  const s = document.createElement('style');
  s.id = 'cam-picker-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function truncate(label, n = 28) {
  if (!label) return 'CAMERA';
  return label.length > n ? label.slice(0, n - 1) + '…' : label;
}

export async function mountCameraPicker({ tracker, onChange }) {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'cam-picker';

  const btn = document.createElement('div');
  btn.className = 'cam-picker__btn';
  btn.innerHTML = `
    <div class="cam-picker__dot"></div>
    <div class="cam-picker__label">CARREGANDO...</div>
    <div class="cam-picker__caret">▼</div>
  `;
  const labelEl = btn.querySelector('.cam-picker__label');

  const menu = document.createElement('div');
  menu.className = 'cam-picker__menu';

  root.appendChild(btn);
  root.appendChild(menu);
  document.body.appendChild(root);

  let devices = [];
  let currentId = null;

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter((d) => d.kind === 'videoinput');
    } catch (e) {
      devices = [];
    }
    renderMenu();
    syncCurrent();
  }

  function syncCurrent() {
    const stream = tracker.videoEl?.srcObject;
    const track = stream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    currentId = settings.deviceId || null;
    const label = track?.label || devices.find((d) => d.deviceId === currentId)?.label;
    labelEl.textContent = truncate(label || 'CAMERA');
    renderMenu();
  }

  function renderMenu() {
    menu.innerHTML = '';
    if (!devices.length) {
      const empty = document.createElement('div');
      empty.className = 'cam-picker__item';
      empty.textContent = 'Nenhuma câmera detectada';
      menu.appendChild(empty);
      return;
    }
    devices.forEach((d, i) => {
      const item = document.createElement('div');
      item.className = 'cam-picker__item';
      if (d.deviceId === currentId) item.classList.add('cam-picker__item--active');
      item.textContent = d.label || `Câmera ${i + 1}`;
      item.title = d.label || '';
      item.addEventListener('click', async () => {
        menu.classList.remove('open');
        labelEl.textContent = 'TROCANDO...';
        try {
          const newLabel = await tracker.setCamera(d.deviceId);
          currentId = d.deviceId;
          labelEl.textContent = truncate(newLabel);
          onChange?.(d.deviceId, newLabel);
          renderMenu();
        } catch (e) {
          console.error('[camera-picker] failed to switch', e);
          labelEl.textContent = 'FALHA';
          setTimeout(syncCurrent, 1500);
        }
      });
      menu.appendChild(item);
    });
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!devices.length || !devices.some((d) => d.label)) {
      await refreshDevices();
    }
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) menu.classList.remove('open');
  });

  navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);

  await refreshDevices();

  return {
    destroy() {
      root.remove();
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    },
    refresh: refreshDevices,
  };
}
