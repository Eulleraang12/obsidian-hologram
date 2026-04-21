# Gestures Spec — Obsidian Hologram

Mapeamento de gestos de mao para o J.A.R.V.I.S. DataSky Vault.

**Stack**: MediaPipe Gesture Recognizer (Tasks Vision) + modelo custom treinado (95.8% accuracy)

---

## Mapeamento atual

| #   | Acao                        | Gesto                                                       | Status |
|:---:|:----------------------------|:------------------------------------------------------------|:------:|
|  1  | Pegar particula (highlight) | 🤏 Pinca                                                    |   🟡   |
|  2  | Arrastar / pan / rotacionar | ✊ Punho fechado + mover                                     |   🟡   |
|  3  | Abrir nota                  | 🤏+☝️ Pinca (mao A) + Apontar (mao B)                       |   🟡   |
|  4  | Fechar nota                 | 🔫 Pistola (polegar+indicador em L)                          |   🟡   |
|  5  | Cursor / hover              | ☝️ Apontar (so indicador estendido)                          |   ✅   |
|  6  | Zoom in                     | 🤏↔️🤏 Afastar duas pincas                                  |   ✅   |
|  7  | Zoom out                    | 🤏🤏 Aproximar duas pincas                                  |   ✅   |
|  8  | Repelir particulas          | 🖐️ Mao aberta                                               |   🟡   |
|  9  | Focar no (double tap)       | 🤏🤏 Dupla pinca rapida                                     |   🟡   |

---

## Detecção tecnica

| Gesto | Evento emitido | Deteccao |
|:---|:---|:---|
| 🤏 Pinca | `pinchStart/End` | Modelo custom (`pinch_left`/`pinch_right`) OU threshold landmarks |
| ✊ Punho + mover | `fistStart/Move/End` | Modelo custom (`fist_left`/`fist_right`) OU ML `Closed_Fist` |
| 🤏+☝️ Combo | `comboOpenNote` | Mao A em pinca + Mao B em pointing (simultaneo) |
| 🔫 Pistola | `pistol` | Polegar estendido + indicador estendido + medio/anelar/mindinho curvados |
| ☝️ Apontar | `pointing` | Modelo custom (`pointing_left`/`pointing_right`) OU ML `Pointing_Up` |
| 🖐️ Mao aberta | `openPalm` | Modelo custom (`open_palm_left`/`open_palm_right`) OU ML `Open_Palm` |
| 🤏↔️🤏 Zoom | `twoHandPinch` | Duas maos em pinca simultanea, delta de distancia |

---

## Modelo custom

- **Arquivo**: `data/gesture-model.json` (23KB)
- **Treinado**: 2026-04-16
- **Amostras**: 193 (225 capturadas, 32 sem mao detectada)
- **Classes**: `fist_left`, `fist_right`, `none`, `open_palm_left`, `open_palm_right`, `pinch_left`, `pinch_right`, `pointing_left`, `pointing_right`
- **Accuracy**: 95.8% (cross-validation 5-fold)
- **Tipo**: Gaussian centroid classifier (SVM backup)

Para retreinar: `http://localhost:8080/training/capture.html` → capturar → `python training/train.py`

---

## Historico de testes

### Ciclo 1 — 2026-04-14

Modelo antigo (MediaPipe Hands, thresholds manuais).
Resultado: 🤏 confundia com ✊, 🖐️ nao funcionava, ☝️ OK, zoom OK.

### Ciclo 2 — 2026-04-16

Modelo novo (Gesture Recognizer + custom 95.8%).
Remapeamento: ✊ virou drag (nao reset), 🔫 fecha nota, 🤏+☝️ abre nota.
Resultado: pendente teste.
