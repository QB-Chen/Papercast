# Hook: narration validation feedback loop

**Trigger**: After each LLM response in `gen-narration.mjs`  
**Condition**: `validate(obj)` returns non-empty errors  
**Action**: Feed errors back to the model with the instruction to fix them, up to `maxRounds` attempts

## What this hook automates

Without this hook, a single validation failure would require a human to:
1. Read the error
2. Decide how to fix the prompt
3. Re-run the generation

With this hook, the system automatically:
1. Categorizes the error (format vs. style vs. fact)
2. Constructs a targeted correction message
3. Continues the conversation until the output passes or rounds are exhausted
4. If only style errors remain after all rounds, accepts the best attempt and passes it to the style review stage

## Error categories handled

- **Format errors** (hard): wrong sentence count, bad id sequence, forbidden characters → fed back immediately, model must fix
- **Style errors** (soft, prefix `【风格】`): sentence too long, not enough questions, too few connectives → fed back but accepted if no format errors remain
- **Formula coverage errors**: a formula term's keyword not found in narration → fed back, treated as soft after round 4

## Implementation

See `scripts/llm.mjs` → `chatJson()` and `scripts/gen-narration.mjs` → `validate()` / `validateEn()`
