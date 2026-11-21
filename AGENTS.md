# Repository Instructions

## Scope Discipline

Do not introduce new requirements, behaviors, UI elements, fallback states, duplicated surfaces, or secondary improvements unless the user explicitly requested them.

When the user asks for a precise fix, implement only that fix. Do not add “supporting” behavior unless the user explicitly asked for it.

If a change would require introducing a new requirement or product decision, stop and ask first instead of inferring permission.

## Feature Documentation

Every feature added, removed, or materially changed must be tracked in `README.md`.

For each feature change, update the README to explain:

- What changed.
- How the feature works for users.
- Any limits, defaults, or environment variables involved.
- Any operational impact, such as persistence, cleanup, cost, or deployment behavior.

Do not merge or ship feature changes without keeping `README.md` accurate.
