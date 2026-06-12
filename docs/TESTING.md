# Testing process notes

The command matrix (what to run, when) lives in the root [README](../README.md)
— "Verification". This file holds process rules that are about *how* to act on
results, not which command to run.

## Transient live-env failures: capture before you touch

Some checks run against live, unpinned state: the env-gated live-DB
integration tests (`src/db/scoped.integration.test.ts`), the live smoke
scripts (`smoke:scoped-db`, `smoke:posthog`, `verify:db-schema`), and any
`verify:ui` run against a server you didn't just build. When one of these
fails and then passes on rerun, the rerun has destroyed the only evidence.

**The rule: when a live-env check fails, capture the complete output BEFORE
any debugging, rerun, or environment poke.**

1. **Capture in full.** Re-running the command is forbidden until the failing
   output is saved — `<command> 2>&1 | tee <file>` on the next occurrence, or
   copy the entire scrollback of the failed run now (full stdout+stderr;
   partial excerpts don't count).
2. **Record the context with it:** exact command, HEAD SHA, branch/worktree,
   timestamp + timezone, and which env the run used (`.env.local`,
   placeholder env, DB branch if known).
3. **File it.** Open a GitHub issue — `chore(test): <symptom>` — with the
   full output attached (or pasted), or comment on the existing issue if the
   symptom is already tracked. If the failure happened inside a gated run
   (verification, release gate), link the issue from that run's notes.
4. Only then debug, rerun, or shrug.

Why this exists: during Phase 2 an env-gated integration run failed 4 tests
once, was rerun before the output was saved, passed, and could never be
reproduced — the incident closed as "unknown" because step 1 was skipped.
