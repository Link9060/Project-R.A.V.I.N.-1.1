# RAVIN Evolution Lab

RAVIN Evolution is an isolated autonomous R&D branch for experimenting on RAVIN without touching production.

## Current architecture

Each experiment moves through a persistent three-agent pipeline:

1. **Explorer** — inspects RAVIN and chooses one bounded, high-value experiment.
2. **Engineer** — implements only that experiment with project-scoped read/write tools.
3. **Critic** — independently reviews the untrusted diff, benchmarks, regression data, and security gates.

Accepted code is committed only to `evolution`. Nothing automatically merges into `main`.

## What V2 adds

- true in-flight experiment checkpoints
- quota-safe patch persistence and resume
- Workers AI request timeouts
- exponential retries for temporary API/network failures
- separate Explorer / Engineer / Critic model configuration
- automatic sync from current `main` before starting a fresh experiment
- atomic state writes plus a recovery copy
- long-term JSONL experiment history
- history search available to Explorer and Engineer
- symlink-aware project path containment
- secret/credential scanning
- deleted-security-code detection
- new external-network-destination gating
- package.json/package-lock consistency checks
- JavaScript syntax checks across the whole RAVIN project
- JSON validation across the project
- ARROW/RAVIN UI contract checks
- API/auth contract checks
- isolated server startup + `/api/health` smoke testing
- baseline vs candidate quality metrics
- regression comparisons for contracts, latency, size, and quality score
- `.evolution/status.json` machine-readable status
- `.evolution/REPORT.md` human-readable evolution report

## Persistent files

- `CONSTITUTION.md` — non-negotiable rules
- `state.json` — current evolution state
- `state.backup.json` — previous valid state snapshot
- `history.jsonl` — long-term experiment history
- `journal.md` — compact human-readable event journal
- `inflight.patch` — only exists when unfinished code must survive a quota cutoff
- `status.json` — compact dashboard data
- `REPORT.md` — readable dashboard/report

## Resume behavior

If quota is exhausted while an experiment is being engineered or reviewed:

1. the current RAVIN diff is saved to `inflight.patch`
2. the working tree is restored to its clean base
3. experiment phase, plan, benchmark baseline, and checkpoint metadata are committed
4. the next run reapplies the exact patch
5. the same experiment continues instead of starting over

No unfinished patch is merged into production.

## Required Actions secrets

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Activation

Evolution is deliberately **opt-in**.

Scheduled and manual workflow runs execute only when this repository variable is exactly:

`RAVIN_EVOLUTION_ENABLED=true`

If the variable is absent or anything other than `true`, the evolution job stays off.

## Optional model variables

- `RAVIN_EVOLUTION_MODEL` — Engineer
- `RAVIN_EVOLUTION_EXPLORER_MODEL` — Explorer
- `RAVIN_EVOLUTION_CRITIC_MODEL` — Critic

Keeping the Critic on a different model from the Engineer helps reduce correlated mistakes.

## Safety boundary

The autonomous tools can read/write only inside `ravin/`.

They cannot directly edit:

- `.evolution/`
- `.github/`
- git metadata
- environment files
- GitHub Actions configuration
- credentials

The controller, not the AI, owns commits, pushes, benchmarks, regression gates, quota checkpoints, and branch synchronization.

Production remains a human decision.
