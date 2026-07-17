# Waypoint Execution Workflow

This directory is the project's durable execution control plane. A fresh agent session must be able to resume from repository state without prior conversation history.

## Sources Of Truth

1. Root and nested agent instructions define repository rules.
2. The approved plan defines product intent.
3. The active issue defines scope, state, decisions, evidence, and handoff.
4. Code and tests define implemented behavior.
5. `README.md` is a generated index; issue frontmatter is authoritative.

If these conflict, stop and record the conflict before changing code.

## State Machine

```text
planned -> ready -> in_progress -> verification -> done
   |         |           |       |
   |         |           |       +-> in_progress
   |         |           +-> blocked
   |         |           +-> awaiting_human -> in_progress
   |         +-> planned
   +-> cancelled

done -> reopened -> in_progress
```

| Current | Allowed next states |
|---|---|
| `planned` | `ready`, `cancelled` |
| `ready` | `in_progress`, `planned`, `cancelled` |
| `in_progress` | `blocked`, `awaiting_human`, `verification`, `ready`, `cancelled` |
| `blocked` | `in_progress`, `cancelled` |
| `awaiting_human` | `in_progress`, `cancelled` |
| `verification` | `in_progress`, `blocked`, `done` |
| `done` | `reopened` |
| `reopened` | `in_progress`, `cancelled` |
| `cancelled` | none |

Guards:

- Dependencies must be `done` before `ready`, `in_progress`, or `verification`.
- The configured `max_in_progress` limit is enforced.
- `done` requires checked acceptance criteria and verification evidence.
- `blocked` requires a concrete note and exact unblocking action.
- `awaiting_human` requires a structured request and halts agent work until a response is recorded.
- `in_progress` requires one exact next action.
- Completed work needing changes returns through `reopened`.

## Issue Contract

Issue Markdown uses JSON-valued YAML frontmatter. Quote strings and use JSON arrays. Required fields are documented in `TEMPLATE.md`. IDs are stable; dependencies use IDs; evidence contains concise commands, artifact paths, or review references.

## Session Start

1. Read root/nested instructions, this workflow, dashboard, active issue, approved plan, dependencies, and linked decisions.
2. Inspect current code and worktrees.
3. Verify current external documentation required by project instructions.
4. Run `node scripts/waypoint.mjs validate` and `status`.
5. Legally transition to `in_progress` with one exact next action.
6. State the narrow outcome before editing.

Do not start when dependencies, acceptance, or product decisions are ambiguous. Record a blocker instead.

## During Work

- Stay within the active outcome.
- Record decisions immediately.
- Record follow-up work without silently expanding scope.
- Keep active step and next action current.
- Treat unknown evidence as blocking, never empty success.

## Session Close

1. Run relevant tests and checks.
2. Record exact commands/outcomes under verification.
3. Check only proven acceptance criteria.
4. Record changed behavior and material files.
5. Write a handoff with current behavior, risks/blockers, exact next action, tests, and preserved decisions.
6. Transition to `verification`, `blocked`, or `done` as appropriate.
7. Run `sync` and `validate`.

## Commands

```bash
node scripts/waypoint.mjs validate
node scripts/waypoint.mjs sync
node scripts/waypoint.mjs status
node scripts/waypoint.mjs create-from-plan issues/plan-issues.json
node scripts/waypoint.mjs checkpoint <ID> --active-step "..." --next-action "..." --note "..."
node scripts/waypoint.mjs request-human <ID> --request-id "..." --question "..." --reason "..." --expected-response "..." --resume-condition "..."
node scripts/waypoint.mjs resume-human <ID> --response "..." --responded-by "..." --next-action "..."
node scripts/waypoint.mjs transition <ID> in_progress \
  --next-action "Implement the next accepted vertical path" \
  --note "Session started after dependency review"
```

## Just-In-Time Decomposition

Keep roadmap slices outcome-level until their implementation session begins. Child work must still produce complete, demoable vertical paths rather than isolated layer tickets.
