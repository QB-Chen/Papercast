# Papercast 🎙️

> Type an arXiv ID. Get a fully narrated explainer video — in Chinese and English.

Papercast is an end-to-end automated pipeline that converts any arXiv paper from a major AI lab into a narrated explainer video with animations, TTS voiceover, and caption alignment. Zero human intervention after you press Enter.

Built for [Kiroween 2026](https://kiroween2026.devpost.com/) using Kiro IDE with spec-driven development, agent hooks, and steering docs.

---

## Demo

**DeepSeek-V4.1-Flash** (arXiv 2609.19969)

| | Chinese | English |
|---|---|---|
| Duration | 16 min | 19 min |
| Resolution | 1440×810 | 1440×810 |
| Sentences | 82 | 89 |
| A/V offset (median) | 0.15s | 0.16s |

> ⚠️ Playback smoothness and audio sync are verified by timestamp measurement only, not by human review.

---

## How it works

```
arXiv ID
  │
  ▼  fetch      Extract equations, figures, tables from arXiv HTML
  ▼  plan       LLM plans scenes; every fact verified against paper quotes
  ▼  narration  LLM writes voice-over; style metrics auto-enforced
  ▼  voice      TTS → ASR back-verification → Whisper caption alignment
  ▼  boards     LLM designs storyboards (formulas, diagrams, skits)
  ▼  motion     Director → Animator → Browser check → Judge → auto-improve
  ▼  render     Remotion renders to 1440×810 MP4
  │
  ▼
projects/<id>/out/video.mp4
```

Each stage has a formal spec in [`.kiro/specs/paper2video.md`](.kiro/specs/paper2video.md).  
Feedback loops are documented in [`.kiro/hooks/`](.kiro/hooks/).  
Pipeline constraints are in [`.kiro/steering/pipeline-rules.md`](.kiro/steering/pipeline-rules.md).

---

## Requirements

- Node.js 18+
- ffmpeg in PATH
- A **local LLM gateway** at `BIFROST_URL` (OpenAI-compatible API)
  - You need: a capable chat model, a code-generation model, a vision model, a TTS endpoint (MiMo-V2.5-TTS compatible), a Whisper ASR endpoint
- Microsoft Edge or Chromium (for headless animation checks)

> This project uses a local gateway — no cloud API keys are included or required. You must provide your own models.

---

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/papercast
cd papercast
npm install

cp .env.example .env
# Edit .env and set BIFROST_URL to your gateway
```

---

## Usage

### One command, full pipeline

```bash
# Chinese video
node scripts/paper2video.mjs 2609.19969 --minutes 10 --auto

# English video
node scripts/paper2video.mjs 2609.19969 --lang en --minutes 10 --auto
```

### With human review checkpoints

```bash
node scripts/paper2video.mjs 2609.19969 --minutes 10
# → pauses at CHECKPOINT-1.md (scene plan + facts)

node scripts/paper2video.mjs 2609.19969 --approve 1
# → pauses at CHECKPOINT-2.md (narration review)

node scripts/paper2video.mjs 2609.19969 --approve 2
# → pauses at CHECKPOINT-3.md (storyboard + animation preview)

node scripts/paper2video.mjs 2609.19969 --approve 3
# → starts rendering
```

### Resume from a specific stage

```bash
node scripts/paper2video.mjs 2609.19969 --from boards --auto
```

---

## Paper source allowlist

By default, only papers from major AI labs are accepted. Edit `config/allowed-orgs.json` to customize. Use `--force` to bypass.

Default orgs: Microsoft · Google/DeepMind · Amazon · ByteDance · Meta · OpenAI · xAI · Anthropic · Tencent · DeepSeek · Alibaba/Qwen · Zhipu · Moonshot

---

## Output structure

```
projects/<arxiv-id>/
├── paper/              # Extracted paper content
│   ├── meta.json
│   ├── paper.txt
│   ├── equations.json
│   ├── figures.json
│   └── tables.json
├── plan.json           # Scene plan with verified facts
├── briefs/             # Per-scene writing briefs
├── narration/          # Voice-over scripts + revisions
├── storyboards/        # Visual design per scene
├── narration/motion/   # Generated GSAP animations
├── out/
│   └── video.mp4       # Final rendered video
├── qa-report.md        # Frame QA results
├── auto-improve-report.md
├── motion-report.md
└── state.json          # Pipeline state (resume support)
```

---

## Kiro usage

This project was built with Kiro IDE using:

- **Spec-driven development** — `.kiro/specs/paper2video.md` defines inputs, outputs, and invariants for all 8 stages before any code was written
- **Agent hooks** — narration validation loop, storyboard correction loop, and animation auto-improve loop documented in `.kiro/hooks/`
- **Steering docs** — `.kiro/steering/pipeline-rules.md` enforces model usage, fact discipline, and content rules across all LLM interactions
- **Multi-agent collaboration** — planner, writer, fact reviewer, storyboard designer, animation director, animation coder, frame judge — all different models with different strengths

See the [Devpost submission](https://kiroween2026.devpost.com/) for a full write-up.

---

## Known limitations

- Video length is a target, not a guarantee (formula-heavy papers run longer)
- Animation quality is AI-reviewed on still frames — playback smoothness not automatically verified
- Requires arXiv HTML version (most 2023+ papers have it)
- All LLM calls require your own gateway — no bundled API access

---

## License

MIT — see [LICENSE](LICENSE)
