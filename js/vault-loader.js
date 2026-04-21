// vault-loader.js — loads vault JSON (or mock) and builds the graph payload.

const FOLDER_COLORS = {
  INDEX: '#FFD700',
  Campanhas: '#3B82F6',
  Criativos: '#10B981',
  'Decisões': '#EF4444',
  Decisoes: '#EF4444',
  'Padrões': '#8B5CF6',
  Padroes: '#8B5CF6',
  Produtos: '#FFD700',
};

const DEFAULT_COLOR = '#00D4FF';

const MOCK_DATA = {
  notes: [
    {
      id: 'INDEX',
      title: 'INDEX',
      folder: '',
      content: '# INDEX\n\nHub central do vault. Comece por [[Regras de Otimização]] e [[Nomenclatura]].',
      links: ['Regras de Otimização', 'Nomenclatura'],
    },
  ],
  links: [],
  meta: { count: 1, generatedAt: new Date().toISOString() },
};

export async function loadVault() {
  try {
    const res = await fetch('./data/vault-data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.notes)) throw new Error('Invalid vault data shape');
    return data;
  } catch (err) {
    console.warn('[vault-loader] Falling back to mock data:', err.message);
    return MOCK_DATA;
  }
}

function isIndex(note) {
  return note.title === 'INDEX' || note.id === 'INDEX';
}

function isRankingOrCemiterio(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return t.includes('ranking') || t.includes('cemitério') || t.includes('cemiterio');
}

function resolveColor(folder, note) {
  if (isIndex(note)) return FOLDER_COLORS.INDEX;
  return FOLDER_COLORS[folder] || DEFAULT_COLOR;
}

function randPos() {
  return Math.random() * 600 - 300;
}

export function buildGraph(vaultData) {
  const notes = Array.isArray(vaultData?.notes) ? vaultData.notes : [];
  const rawLinks = Array.isArray(vaultData?.links) ? vaultData.links : [];

  const nodes = notes.map((note) => {
    const index = isIndex(note);
    const rankCem = isRankingOrCemiterio(note.title);
    let radius = 10;
    if (index) radius = 22;
    else if (rankCem) radius = 14;

    return {
      id: note.id,
      title: note.title,
      folder: note.folder || '',
      content: note.content || '',
      x: randPos(),
      y: randPos(),
      vx: 0,
      vy: 0,
      radius,
      color: resolveColor(note.folder, note),
      pulsing: index,
      isIndex: index,
      label: note.title,
      doubleBorder: rankCem,
    };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const links = rawLinks
    .filter((l) => l && ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target }));

  return { nodes, links };
}
