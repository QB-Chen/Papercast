# Hook: storyboard validation feedback loop

**Trigger**: After each LLM response in `gen-storyboard.mjs`  
**Condition**: `validateStoryboard()` returns non-empty errors  
**Action**: Feed errors back, up to 10 rounds; fall back to next model if structural errors remain

## Error classification

Errors are scored by `errScore()`:
- **Structural errors** (weight 10): missing anchor, field out of bounds, LaTeX in screen text, `beats 至少 N 个` with 1000-weight → must fix, switches model after 10 rounds
- **Quality errors** (weight 1, matches `SOFT` regex in `error-classes.mjs`): animation not dynamic,演示 not acted out, elements overlap → accepted if no structural errors remain (best-of-N selected by score)

## Model fallback sequence

1. `sensenova/kimi-k3` (10 rounds)
2. `sensenova/sensenova-6.8-flash` (10 rounds)  
3. `sensenova/deepseek-flash` (10 rounds)

If all three fail on structural errors, the stage fails and must be re-run manually.

## Implementation

See `scripts/gen-storyboard.mjs` → `errScore`, `SOFT`, `bestEffort` option in `chatJson()`
