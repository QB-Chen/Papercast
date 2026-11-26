# Hook: animation auto-improve loop

**Trigger**: After motion stage completes, before render  
**Script**: `scripts/auto-improve.mjs`  
**Runs**: Up to `--rounds` times (default 2) on all demos marked "needs revision"

## What this hook automates

This is the most complex feedback loop in the pipeline. For each demo that fails frame QA:

1. **Detect**: `demo-qa.mjs` renders frames and classifies defects (blank_start, empty, static, half_acted, too_small, overlap, hidden, off_topic)
2. **Fix**: Re-runs `gen-motion.mjs` for that specific demo with the defect type as additional context
3. **Retest**: Renders the new animation and re-evaluates
4. **Decision**: Keeps the new version only if it scores better on the same `key` criteria; otherwise restores the original

## Concurrency model

- Generation and review: 3 parallel workers (`--concurrency 3`)
- Install / validate / props-rebuild / retest: serialized with a lock (`withLock`)

This prevents race conditions where two demos simultaneously try to modify the storyboard files.

## Exit codes

- `0`: All demos passing, or no demos needed fixing
- `3`: Some demos still need revision after all rounds (human review recommended)
- `4`: Some QA calls failed (incomplete results)
- `1`: Unexpected error

## Implementation

See `scripts/auto-improve.mjs`, `scripts/demo-qa.mjs`, `scripts/gen-motion.mjs`
