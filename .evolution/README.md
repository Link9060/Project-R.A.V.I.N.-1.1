# RAVIN Evolution Lab

This branch is RAVIN's autonomous experimental R&D lane.

## What it does
- runs bounded autonomous engineering sessions
- chooses one improvement at a time
- edits only the `ravin/` project
- validates every proposed change
- sends the diff through a separate review gate
- commits accepted experiments to `evolution`
- records rejected experiments so they are less likely to repeat
- pauses safely when the Workers AI quota/rate limit is reached
- resumes on a later scheduled run

It never merges itself into `main`.

## Control plane
`.evolution/runner.mjs` is the controller.
`.evolution/CONSTITUTION.md` contains non-negotiable rules.
`.evolution/state.json` persists progress between runs.
`.evolution/journal.md` is created automatically and records each experiment.

The AI's file tools are rooted at `ravin/`, so the autonomous engineering agent cannot edit the controller or GitHub workflow.

## Required GitHub Actions secrets
The scheduler expects these repository Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Use the same Workers AI credentials that RAVIN already uses if you want evolution to share that free quota.

## Optional controls
Repository variable `RAVIN_EVOLUTION_ENABLED=false` pauses scheduled evolution without deleting anything.

Repository variable `RAVIN_EVOLUTION_MODEL` can override the default work model.

## Safety model
Evolution is intentionally separated from production:
- scheduler definition lives on `main`
- scheduler checks out `evolution`
- all autonomous commits are pushed only to `evolution`
- production deployment remains tied to `main`
- failed/unreviewed experiments are reverted
- merges into production remain a human decision
