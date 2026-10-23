# vivaldi-workspace-router

Vivaldi mod that moves newly opened tabs into per-deal workspaces by matching customer names in the tab title/URL, and folds duplicate tabs into the existing one.

- Read `docs/design.md` before doing anything. It is the source of truth for requirements, logic, and the phase plan (section 「Claude Code への指示」).
- Work phase by phase and stop at the end of each phase to report.
- Do not guess Vivaldi internal API names. Anything unverified goes through the Spike phase first; record results in `docs/findings.md`.
- Keep `matcher.js` / `normalize.js` pure and tested with `node --test`. Keep all Vivaldi-specific calls inside one adapter in `router.js`.
- No external libraries. Never close pre-existing tabs.
- Target: macOS Vivaldi only. The user communicates in Japanese.
