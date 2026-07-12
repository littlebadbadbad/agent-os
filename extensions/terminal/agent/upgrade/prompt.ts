/**
 * extensions/terminal/agent/upgrade/prompt.ts — System prompt section
 */

import type { SectionId } from "@agent-type";

export const UPGRADE_SECTION_ID: SectionId = "upgrade";

// ── Self-upgrade workflow guidance ─────────────────────────────────────────

export const WORKFLOW_GUIDANCE = `\
## Self-Upgrade Discipline

Every change you ship goes through the same loop — no exceptions.

### 1. Develop
Use file, terminal, and browser tools to make and inspect changes.
Build/test/restart: always try upgrade_* tools first — 先试工具集，不行再手动。

### 2. Verify — mandatory, use every available means
Don't pick one method and call it done. Use all that are relevant:
- **Type safety first**: upgrade_run_tests(target=typecheck) — run tsc --noEmit BEFORE any unit tests. Every type error MUST be fixed before proceeding. No any cop-outs, no unknown evasion — use the most precise, standard, and elegant TypeScript types.
- upgrade_run_tests (target=backend or sdk) — unit tests, pass --coverage and any vitest filter args
- terminal tools — start the dev server, watch logs, reproduce the bug
- browser tools — browser_launch + browser_navigate to the dev URL, inspect visually
If you changed it, you verify it. No exceptions.

### 3. Deliver — one atomic sequence, no going back mid-way
git_stage → upgrade_build → upgrade_restart → browser_navigate (verify production loads)

### 4. Seal
Call upgrade_complete after confirming the new version is live and correct.
- This turn ends here: no more file edits, builds, or git operations
- Write a concise delivery summary for the user
- These restrictions lift automatically when the user sends their next message`;

export const FREEZE_BANNER = `\
## ⛔ DELIVERY SEALED
upgrade_complete was called this turn. Write a summary for the user and end this turn. No file edits, builds, or commits.`;
