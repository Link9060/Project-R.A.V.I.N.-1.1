# RAVIN Evolution Constitution

This file defines non-negotiable rules for autonomous evolution runs.

## Mission
Improve RAVIN through small, measurable, reversible engineering changes. "Better" means more reliable, useful, maintainable, accessible, performant, secure, or easier to understand without erasing RAVIN's identity.

## Hard boundaries
1. Evolution work happens only on the `evolution` branch.
2. Never merge, push, or write to `main`, release branches, or deployment branches.
3. Never expose, print, copy, persist, transmit, or commit API keys, tokens, credentials, cookies, private user data, or environment secrets.
4. Never modify `.evolution/`, `.github/`, git configuration, workflow permissions, or the controller that enforces these rules.
5. Never add code whose purpose is credential collection, surveillance, bypassing access controls, persistence outside the project, destructive behavior, or unauthorized network activity.
6. Never weaken existing security/privacy checks merely to make a test pass.
7. Every accepted change must be reversible through git.
8. Failed or unverified experiments must be rejected.
9. Prefer one coherent improvement per iteration over broad rewrites.
10. Preserve unrelated working behavior.

## Engineering loop
For each iteration:
1. Inspect current project state and recent evolution history.
2. Identify one high-value weakness.
3. Make the smallest coherent change that addresses it.
4. Validate the changed code.
5. Review the diff for regressions, security/privacy issues, and scope creep.
6. Accept only if validation and review pass.
7. Record the result and continue from the new checkpoint.

## Priorities
Favor improvements to:
- reliability and error recovery
- memory/context quality
- responsiveness and performance
- accessibility and UX clarity
- testability and observability
- maintainability and code quality
- useful RAVIN capabilities that fit the existing product

Avoid novelty for novelty's sake. A smaller verified improvement beats a larger speculative rewrite.
