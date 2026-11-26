# Spec: paper2video pipeline

## Overview

Convert any arXiv paper into a narrated explainer video (Chinese or English) with zero human intervention.

Input: arXiv paper ID (e.g. `2609.19969`)  
Output: `projects/<id>/out/video.mp4` (1440×810 MP4, narration + captions + animations)

---

## Stages

### 1. fetch
**Input**: arXiv ID  
**Output**: `projects/<id>/paper/{meta.json, paper.txt, equations.json, figures.json, tables.json}`  
**Invariants**:
- `meta.json` must contain title, authors, abstract
- `paper.txt` must contain section headings and equation placeholders `[[EQ eqN]]`
- Paper source must match the org allowlist in `config/allowed-orgs.json` (or `--force` flag set)
- All equation LaTeX must be extractable from `math[alttext]` attributes

### 2. plan
**Input**: `paper/` directory  
**Output**: `plan.json`, `briefs/<scene>.md` for each scene  
**Invariants**:
- 7–11 scenes, first id `hook`, last id `out`
- Every `facts[].quote` must appear verbatim in `paper.txt`
- All `refs.eq/fig/table` ids must exist in the paper data
- `plan.json` must contain `lang` field (`zh` or `en`)
- Scene sentence targets must sum to within 25% of `(minutes × 60) / 9.5`

### 3. narration
**Input**: `briefs/<scene>.md`, `paper/paper.txt`  
**Output**: `narration/<scene>.revised.json`, `narration.json`, `audit-numbers.md`  
**Invariants**:
- Each sentence `id` must follow the scene prefix + sequential number
- No Arabic numerals in Chinese narration (Chinese characters only)
- No CJK characters in English narration
- No Greek letters or math symbols in any narration
- No "last episode / next episode" references (standalone video)
- Every formula term listed in `plan.json formulas[].parts[].say` must appear in narration, in order
- All numbers in narration must be traceable to `plan.json facts[]`
- Style metrics (sentence length, question ratio, colloquial word ratio) must exceed 80% of reference exemplar thresholds

### 4. voice
**Input**: `narration.json`  
**Output**: `public/<id>/audio/<sentence>.wav`, `timeline.json`  
**Invariants**:
- ASR back-verification score ≥ 0.93 (retried up to 3 times per sentence)
- `timeline.json` must contain `lang` field
- Caption alignment: `caps[]` written for sentences where ASR alignment covers ≥60% of characters

### 5. boards
**Input**: `timeline.json`, `narration/<scene>.final.json`, `plan.json`  
**Output**: `storyboards/<scene>.json`  
**Invariants**:
- All `beat.at` sentence ids must exist in the scene
- All `refs.eq/fig/table` ids must exist in paper data
- No element coordinates outside canvas bounds (0–1600 × 0–520)
- Text fields: no LaTeX notation (`_{}\\^`) in English mode; no self-invented English words in Chinese mode
- Structural errors block; quality warnings (animation not dynamic enough) are recorded but do not block

### 6. motion
**Input**: `storyboards/<scene>.json`, `narration/demos.json`  
**Output**: `narration/motion/<scene>-<demo>.json`, updated storyboards  
**Invariants**:
- Generated HTML+CSS+GSAP must pass headless browser execution (no JS errors)
- All `cue()` time anchors must resolve in the timeline
- Animation must have at least one visible change per beat (no static frames > 5.5s)
- Text in animations: no Arabic numerals; size ≥ 24px
- auto-improve: only keep new version if frame review score improves

### 7. qa
**Input**: rendered frames (via stills.mjs)  
**Output**: `qa-report.md`, `auto-improve-report.md`  
**Invariants**:
- No `high`-severity defects that are render-time bugs (text flipped, formula clipped)
- auto-improve runs up to 2 rounds on `needs-revision` demos

### 8. render
**Input**: `props.json` (timeline + storyboards merged)  
**Output**: `out/video.mp4`  
**Invariants**:
- All time anchors resolve before render starts (check-anchors exit 0)
- Output file must be valid MP4 with matching video+audio duration
- Audio-visual offset median must be < 0.3s (verified by av-offset.mjs)

---

## Language support

`--lang zh` (default): Chinese narration, Chinese screen text, MiMo TTS voice 冰糖  
`--lang en`: English narration, English screen text, MiMo TTS voice Mia  
English project uses directory suffix `-en` (e.g. `projects/2609.19969-en/`)

## Error classification

Errors from validators are classified in `scripts/error-classes.mjs`:
- **Structural (hard)**: anchor not found, field missing, out of bounds, language violations → pipeline fails
- **Quality (soft)**: animation not dynamic enough,演示 half-acted, elements overlap → recorded as warnings, pipeline continues
