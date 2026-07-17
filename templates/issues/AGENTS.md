# Waypoint Instructions

Issue files are durable execution state, not static planning documents.

Before working on a tracked issue:

1. Read `../AGENTS.md`, `WORKFLOW.md`, `README.md`, and the complete issue file.
2. Read the approved plan and dependency issues referenced by the active issue.
3. Run `node scripts/waypoint.mjs validate` from the workspace root.
4. Do not implement a `planned`, `blocked`, `done`, or `cancelled` issue without a legal transition.

While working:

- Record decisions, verification, and handoff state in the issue.
- Keep frontmatter values valid JSON literals.
- Use the transition CLI rather than editing `status` manually.
- Run `sync` after metadata changes.
- Do not edit the generated README table between its markers.

At session end, the issue must tell a fresh agent what happened, what remains, why, and the exact next action.
