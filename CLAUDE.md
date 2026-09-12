@AGENTS.md

# Claude Code on this repo

`AGENTS.md` above is the substance and applies in full. This file adds only what Claude Code needs on top of it.

The skills under `.claude/skills/` fire from their own descriptions. The one that applies to almost every change is `platform-parity`: Lilo ships on macOS and Windows from one codebase, and a change is not done until both branches are written and the commit says what was tried on which OS. The global `run` skill defers to `run-lilo` here.
