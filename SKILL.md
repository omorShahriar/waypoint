---
name: waypoint
description: Turn approved plans into local, resumable work and carry execution safely across fresh agent sessions. Use when the user says "initialize waypoint", "create local issues", "start issue", "resume work", "checkpoint", "wait for me", "verify issue", "complete issue", or wants durable plan-to-execution handoffs. Use grill-me and lavish first when a large plan is not yet approved.
---

# Waypoint

Install and operate an execution control plane in a selected target project whose issue files, not conversation history, are authoritative.

This skill is self-contained and project agnostic. Its own directory contains:

- `scripts/install.mjs` - idempotent installer;
- `scripts/waypoint.mjs` - zero-dependency state-machine CLI copied into projects;
- `scripts/*.test.mjs` - runtime and clean-install tests;
- `templates/` - generic workflow, issue, dashboard, config, and root-instruction templates.

## Large-Work Sequence

```text
explore -> grill-me -> durable plan -> lavish approval
-> Waypoint local plan-to-slices approval -> one issue per fresh session
-> Waypoint verify/complete -> next unblocked issue
```

This skill composes with:

- `grill-me` for resolving plan decisions;
- `lavish` for visual plan review and approval;

Waypoint replaces remote issue-publishing workflows for this operating model. It proposes the smallest outcome-level local issue sequence, obtains granularity and dependency approval, persists issue files under the target project's root `issues/` directory, and carries execution across sessions.

## Skill Installation Scope

The skill itself may be installed project-locally or globally. Never infer the target project from the skill's own location.

- Project-local skill: the skill directory is inside the current repository.
- Global skill: the skill directory is in the agent host's global skills directory and may initialize many repositories.
- Target execution state: always installed into the explicit `--root <workspace-root>` project, regardless of where the skill lives.

Resolve the directory containing this `SKILL.md` at runtime. Use that directory only to find packaged installer/templates. Store issue files, runtime CLI, configuration, and handoffs in the selected target project.

## Select One Mode

| Intent | Mode |
|---|---|
| Add the harness to a project | `initialize` |
| Persist an approved issue breakdown into tracked slices | `plan-to-slices` |
| Begin a planned or ready issue | `start` |
| Continue active, blocked, or reopened work | `resume` |
| Save durable progress without a transition | `checkpoint` |
| Record a real external blocker | `block` |
| Prove acceptance and enter review | `verify` |
| Finish reviewed work with evidence | `complete` |
| Report current work and next action | `status` |

If more than one mode is plausible, ask one short question before changing files or state.

## Mode: Initialize

1. Identify the workspace root.
2. Resolve the directory containing this `SKILL.md`, whether project-local or global. Do not assume `.agents/`, `.opencode/`, or a home-directory path.
3. Review the install plan without changing files:

```bash
node <skill-directory>/scripts/install.mjs --root <workspace-root> --dry-run
```

4. If the target has conflicting `issues/` or `scripts/waypoint*` files, stop and ask. Do not use `--force` without explicit approval.
5. Install:

```bash
node <skill-directory>/scripts/install.mjs --root <workspace-root>
```

6. From the workspace root, run:

```bash
node --test scripts/waypoint.test.mjs
node scripts/waypoint.mjs sync
node scripts/waypoint.mjs validate
```

7. Report installed files and the exact next action.

The installer may create or append a marked section to root `AGENTS.md`. It must not overwrite unrelated instructions.

## Preflight For All Operational Modes

Confirm the target project contains:

- `AGENTS.md` with the Waypoint marker;
- `issues/WORKFLOW.md`;
- `issues/AGENTS.md`;
- `issues/README.md`;
- `issues/TEMPLATE.md`;
- `issues/config.json`;
- `scripts/waypoint.mjs`.

Then:

1. Read root and nested agent instructions.
2. Read `issues/WORKFLOW.md` completely.
3. Run `node scripts/waypoint.mjs validate`.
4. Run `node scripts/waypoint.mjs status`.

If validation fails, repair only harness drift before product work. Never create a parallel state store or manually edit an issue's `status`.

## Mode: Plan To Slices

1. Read the complete durable plan and confirm it is approved.
2. Read project vocabulary and enough current code to avoid artificial boundaries.
3. Propose the minimum independently resumable outcome-level issues in dependency order. Preserve approved plan slices when they already satisfy this rule.
4. Each issue is autonomous by default and may perform any schema, API, UI, test, documentation, research, or tool work needed for its outcome.
5. Do not statically classify issues by anticipated human involvement or split them for that reason. Human intervention is represented dynamically through `awaiting_human` during execution.
6. Show titles, dependencies, covered outcomes/user stories, and stop conditions. Ask whether granularity and dependencies are right.
7. After approval, write a JSON manifest using `issues/PLAN-ISSUES.example.json` and run:

```bash
node scripts/waypoint.mjs create-from-plan <manifest-path>
```

8. The manifest must give each issue:
   - unique stable ID;
   - dependency and unlock IDs;
   - milestone and priority;
   - one exact `next_action`;
   - approved plan, context, acceptance criteria, and inherited invariant references.
9. Mark an issue `ready` only when dependencies are `done` and acceptance is implementation-ready.
10. Run `sync` and `validate`.
11. Report paths, active priorities, and the first eligible issue.

Stop when plan approval, dependency direction, product decisions, or current external behavior is unclear.

## Mode: Start

1. Resolve the requested issue. If absent, choose only when exactly one active-priority issue is eligible.
2. Read the full issue, approved plan, dependencies, decisions, and current code.
3. Inspect relevant worktrees and current external docs required by project instructions.
4. If `planned`, verify guards and transition to `ready`.
5. Transition to `in_progress` with one exact executable action:

```bash
node scripts/waypoint.mjs transition <ID> in_progress \
  --next-action "<one executable action>" \
  --note "Session started after context and dependency review"
```

6. Validate, state the narrow session outcome, and implement.

Do not exceed the configured active-work limit.

## Mode: Resume

1. Read the authoritative issue through `## Handoff` and every referenced dependency/decision.
2. Inspect current code and worktrees; another session may have changed them.
3. Handle status:
   - `in_progress`: continue from `next_action`;
   - `blocked`: confirm resolution, then transition to `in_progress`;
   - `reopened`: transition to `in_progress` with the regression/follow-up;
   - `verification`: verify or return explicitly to `in_progress`;
   - `done`/`cancelled`: stop unless reopening is explicitly requested.
4. Validate before editing.

## Mode: Checkpoint

1. Run the managed checkpoint command:

```bash
node scripts/waypoint.mjs checkpoint <ID> \
  --active-step "<current durable step>" \
  --next-action "<one executable next action>" \
  --note "<durable progress summary>"
```

2. Record detailed decisions, verification commands, and handoff context in the issue body when needed.
3. Run `sync` and `validate`.

## Mode: Block

Preserve completed work, then run:

```bash
node scripts/waypoint.mjs transition <ID> blocked \
  --next-action "<specific unblocking action>" \
  --note "Blocked because <verifiable external condition>"
```

Update the handoff with the owner/decision needed. Do not use `blocked` for ordinary remaining work.

## Mode: Request Human

Use only when the agent cannot safely proceed without a human decision, approval, secure credential setup performed outside the agent context, external setup, or subjective review.

### Credential Safety

Never request, receive, repeat, display, pass as a command argument, or persist passwords, API keys, access tokens, private keys, connection strings, or other secret values. For credential setup, ask the human to perform the action in the provider UI, environment configuration, or secret manager and return only a non-sensitive completion confirmation or reference. If a secret is provided, do not run a Waypoint command with it; tell the user to rotate the exposed value.

1. Checkpoint completed work and verification first.
2. Ask one precise question or action request with an explicit non-sensitive expected response and resume condition.
3. Transition and halt:

```bash
node scripts/waypoint.mjs request-human <ID> \
  --request-id "<stable request id>" \
  --question "<one precise question or action>" \
  --reason "<why the agent cannot proceed autonomously>" \
  --expected-response "<non-sensitive decision or completion confirmation; never a secret>" \
  --resume-condition "<objective condition for resuming>"
```

4. Do not continue issue work after the command succeeds. Present the exact request to the user.

## Mode: Resume Human

1. Confirm the issue is `awaiting_human` and feedback satisfies the recorded resume condition.
2. Record a non-sensitive summary of the response or completed action. Never quote raw credentials or other secret values:

```bash
node scripts/waypoint.mjs resume-human <ID> \
  --response-summary "<non-sensitive decision or completion confirmation>" \
  --responded-by "<human identity or user>" \
  --next-action "<first executable action after feedback>"
```

3. Read the refreshed issue, validate, and resume from the new next action.

If feedback is incomplete, remain `awaiting_human` and ask only for the missing information.

## Mode: Verify

1. Confirm status is `in_progress`.
2. Run every check needed by acceptance, including browser/manual checks where relevant.
3. Missing or inconclusive evidence fails closed.
4. Record exact commands/results and check only proven criteria.
5. If implementation remains, stay `in_progress` and set the next action.
6. Otherwise transition:

```bash
node scripts/waypoint.mjs transition <ID> verification \
  --next-action "Review evidence and complete the issue" \
  --note "Acceptance verification completed"
```

7. Sync and validate.

## Mode: Complete

1. Confirm status is `verification`.
2. Require all acceptance boxes checked from recorded evidence.
3. Ensure the handoff states final behavior, residual risk, and next eligible issue.
4. Transition:

```bash
node scripts/waypoint.mjs transition <ID> done \
  --next-action "Start <NEXT-ID>" \
  --note "All acceptance criteria verified" \
  --evidence "<commands, artifacts, or review references>"
```

5. Run `sync`, `validate`, and `status`.
6. Report outcome, evidence, residual risk, and next issue.

Never bypass completion guards by checking criteria without evidence.

## Mode: Status

Run validation and status. Report active/review/blocked work, active-priority issues, dependency blockers, authoritative next action, and stale metadata. Do not change state.

## Determinism Rules

- One mode per request.
- One issue file per unit of work.
- One exact next action.
- CLI-controlled transitions only.
- No implementation before context/dependency review.
- No success inferred from missing evidence.
- No `done` without checked criteria and evidence.
- No hidden scope expansion.
- No manual edits inside generated README markers.
- No reliance on conversation history.
- No continuing work while `awaiting_human`.
