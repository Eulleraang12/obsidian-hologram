# Obsidian Holographic Interface — DataSky

Interface web que replica o Graph View do Obsidian com estética Jarvis / Tron Legacy, controlada por gestos de mão via webcam (MediaPipe Hands + modelo custom). Pensada para gravar como criativo de marketing da DataSky: o operador "pilota" o vault da operação de tráfego com as mãos no ar, estilo J.A.R.V.I.S.

## O que é

O vault real do Obsidian (notas em markdown com wikilinks) vira um graph 3D-feel em Canvas 2D, com partículas ambientes, HUD nos cantos, minimap, relógio e materialização holográfica ao abrir nota. Tudo dark + neon amber/cyan. Os gestos controlam hover, drag, pan, zoom, abrir/fechar nota e repelir partículas sem mouse nem teclado.

## Stack

Vanilla JS (ES modules), Canvas 2D, MediaPipe Gesture Recognizer (Tasks Vision) + modelo custom treinado (95.8% accuracy, 193 amostras, 9 classes), marked.js para markdown. Zero build step, zero framework.

## Estrutura

```
obsidian-hologram/
├── index.html
├── css/style.css
├── js/
│   ├── main.js           orquestrador
│   ├── vault-loader.js   carrega vault-data.json + fallback mock
│   ├── hand-tracker.js   MediaPipe + detecção de gestos
│   ├── graph.js          força-direcionada + render Canvas 2D
│   ├── note-viewer.js    painel holográfico + materialização
│   ├── hud.js            cantos HUD + minimap + relógio
│   └── particles.js      partículas ambientes
├── scripts/
│   └── preprocess-vault.js   Node.js walker do vault
└── data/
    └── vault-data.json       57 notes mock (substituir pelo real)
```

## Como rodar

1. Servir os arquivos via HTTP (MediaPipe + ES modules exigem origem http/https, não `file://`):
   ```
   cd obsidian-hologram
   npx serve .
   ```
   Ou qualquer servidor estático (`python -m http.server`, Live Server do VSCode, etc).

2. Abrir no browser (Chrome recomendado pelo suporte a MediaPipe) e permitir acesso à webcam.

3. F11 pra tela cheia antes de gravar.

## Usar o vault real

Quando o iCloud sincronizar as notas de `C:\Users\Alienware\iCloudDrive\iCloud~md~obsidian\Euller cofre\Tráfego Starterpack`, rode:

```
node scripts/preprocess-vault.js "C:\Users\Alienware\iCloudDrive\iCloud~md~obsidian\Euller cofre\Tráfego Starterpack" data/vault-data.json
```

Isso sobrescreve o mock com as notas reais. Refresh na página e pronto.

## Controle por gestos

Detalhes completos (eventos, lógica de detecção, histórico de treino) em [GESTURES.md](GESTURES.md).

| # | Ação | Gesto | Status |
|:---:|:---|:---|:---:|
| 1 | Pegar partícula (highlight) | 🤏 Pinça (polegar + indicador) | 🟡 |
| 2 | Arrastar / pan / rotacionar | ✊ Punho fechado + mover | 🟡 |
| 3 | Abrir nota | 🤏 + ☝️ Pinça (mão A) + Apontar (mão B) | 🟡 |
| 4 | Fechar nota | 🔫 Pistola (polegar + indicador em L) | 🟡 |
| 5 | Cursor / hover | ☝️ Apontar (só indicador estendido) | ✅ |
| 6 | Zoom in | 🤏 ↔️ 🤏 Afastar duas pinças | ✅ |
| 7 | Zoom out | 🤏 🤏 Aproximar duas pinças | ✅ |
| 8 | Repelir partículas | 🖐️ Mão aberta espalmada | 🟡 |
| 9 | Focar no node (double tap) | 🤏 🤏 Dupla pinça rápida | 🟡 |

**Detecção**: modelo custom Gaussian centroid (`data/gesture-model.json`, 23KB, 9 classes, 95.8% accuracy em cross-validation 5-fold). Fallback pra classificador do MediaPipe Gesture Recognizer + thresholds nos landmarks quando o custom não converge.

**Retreinar**: servir a pasta via HTTP, abrir `training/capture.html`, capturar amostras por classe, rodar `python training/train.py`. Gera novo `gesture-model.json`.

## Fallback

Se a webcam for negada, a app entra em modo mouse: hover, arraste, duplo-clique abre nota, scroll zoom, ESC fecha nota.

## Paleta

- Amber primário `#F59E0B` / glow `#FCD34D`
- Cyan accent `#22D3EE` (wikilinks)
- Campanhas `#3B82F6`, Criativos `#10B981`, Decisões `#EF4444`, Padrões `#8B5CF6`, Produtos `#F59E0B`, INDEX dourado pulsante

## Notas

- O mock vault tem 57 notes / 137 links replicando a estrutura descrita no prompt original — suficiente pra gravar demo antes do iCloud sincronizar.
- Performance alvo: 30fps+ com webcam + graph + tracking simultâneos em hardware médio.
- Toda estética é injetada via JS (HUD/NoteViewer criam seus próprios estilos) + fallback em `css/style.css`.
