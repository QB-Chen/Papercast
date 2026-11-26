# Steering: Papercast pipeline rules

These rules apply to all Kiro interactions within this project.

## Model usage

- All LLM calls go through the local gateway at `BIFROST_URL` (env var, default `http://localhost:8080`)
- Never call any external AI API directly
- Allowed models are enforced in `scripts/llm.mjs` — do not add new models without updating the allowlist
- Different models handle different roles: planner/writer (long-context), animator (code generation), reviewer (judgment), vision judge (multimodal)

## Fact discipline

- Every factual claim about a paper must be traceable to a verbatim quote from `paper.txt`
- Do not invent numbers, model names, benchmark scores, or parameter counts
- If the paper hedges ("often", "typically"), preserve the hedge — never strengthen to "always" or "definitely"
- Illustrative examples (not from the paper) must be explicitly flagged as "for example" / "suppose"

## Content rules for screen text

- Chinese mode: no Arabic numerals (write 汉字), no self-invented English words (only abbreviations from the allowlist)
- English mode: no CJK characters, no LaTeX notation in display text (`_{}\\^`), no Greek letters
- Neither mode: no math symbols, no function notation like `f(x)`
- Numbers in animations are always示意图 (illustrative) — do not write paper data values directly

## Code generation rules (animation)

- Generated HTML+CSS+GSAP must be self-contained and run in a headless browser
- No `fetch()`, no external resources, no `import`
- All elements must stay within the stage bounds: 1600×520px (or 1600×300px for insets)
- Use `cue("sentenceId")` for time anchors — never hardcode frame numbers
- Text size minimum 24px; elements minimum 60px wide

## Pipeline modifications

- When adding a new stage, update `.kiro/specs/paper2video.md` first
- Validator errors must be classified as structural (hard, blocks pipeline) or quality (soft, warns only) in `scripts/error-classes.mjs`
- Never silently swallow errors — log them and either retry or fail fast
- State is persisted in `projects/<id>/state.json` — stages already marked done are skipped on re-run

## Privacy

- Do not log or expose API keys, gateway credentials, or internal paths
- The `BIFROST_URL` environment variable must never appear in committed code
- `projects/` directory contains generated content (audio, images, video) — it is gitignored
