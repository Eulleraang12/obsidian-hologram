#!/usr/bin/env node
// preprocess-vault.js — walks an Obsidian vault and emits graph JSON.
// Usage: node preprocess-vault.js <vaultPath> [outputPath]

const fs = require('fs');
const path = require('path');

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

function walk(dir, base = dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name === 'node_modules') continue;
    if (ent.name.endsWith('.skill') || ent.name.endsWith('.plugin')) continue;
    if (ent.name === 'skills-para-compartilhar') continue;
    if (ent.name === 'creative-research-engine') continue;
    if (ent.name === 'oferta-builder-skill' || ent.name === 'oferta-builder.skill') continue;
    if (ent.name === 'apresentacao-claude-jander') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, base, acc);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

function extractLinks(content) {
  const out = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function main() {
  const vaultPath = process.argv[2];
  const outputPath = process.argv[3] || path.join(process.cwd(), 'data', 'vault-data.json');

  if (!vaultPath) {
    console.error('Usage: node preprocess-vault.js <vaultPath> [outputPath]');
    process.exit(1);
  }

  const absVault = path.resolve(vaultPath);
  if (!fs.existsSync(absVault)) {
    console.error('Vault path not found:', absVault);
    process.exit(1);
  }

  console.log('Scanning vault:', absVault);
  const files = walk(absVault);
  console.log('Found', files.length, 'markdown files');

  const notes = [];
  const titleIndex = new Map();
  const idIndex = new Map();

  for (const file of files) {
    const rel = path.relative(absVault, file).replace(/\\/g, '/');
    const id = rel.replace(/\.md$/i, '');
    const title = path.basename(file).replace(/\.md$/i, '');
    const parts = id.split('/');
    const folder = parts.length > 1 ? parts[0] : '';
    const content = fs.readFileSync(file, 'utf8');
    const rawLinks = extractLinks(content);
    notes.push({ id, title, folder, content, links: rawLinks });
    titleIndex.set(title, id);
    idIndex.set(id, id);
  }

  const links = [];
  let resolved = 0;
  let orphans = 0;
  const orphanTargets = new Set();

  for (const note of notes) {
    const resolvedLinks = [];
    for (const raw of note.links) {
      const basename = raw.split('/').pop();
      const target = idIndex.get(raw) || titleIndex.get(raw) || titleIndex.get(basename);
      if (target) {
        resolvedLinks.push(target);
        links.push({ source: note.id, target });
        resolved++;
      } else {
        orphans++;
        orphanTargets.add(raw);
      }
    }
    note.links = resolvedLinks;
  }

  const output = {
    notes,
    links,
    meta: {
      count: notes.length,
      linkCount: links.length,
      generatedAt: new Date().toISOString(),
    },
  };

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('Notes processed:', notes.length);
  console.log('Links resolved :', resolved);
  console.log('Orphan links   :', orphans);
  if (orphans > 0) {
    console.log('Unresolved targets sample:', Array.from(orphanTargets).slice(0, 10));
  }
  console.log('Wrote:', outputPath);
}

main();
