<p align="center">
  <img src="assets/waypoint-logo.svg" alt="Waypoint - durable agent workflows" width="720">
</p>

# Waypoint

Waypoint turns an approved plan into local, resumable work that survives fresh agent sessions.

It gives an agent a durable answer to four questions:

1. What are we building?
2. What has already been completed?
3. What is blocking or waiting for a human?
4. What exact action should the next session take?

Waypoint stores that state in the project, not in chat history. It is designed for long-running engineering work where plans are reviewed first, implementation spans many sessions, and the agent must sometimes stop for a human decision or external action.

## When To Use Waypoint

### Turn an approved plan into local work

Use Waypoint after a plan has been explored, challenged, and approved. It proposes the smallest independently resumable issue sequence, asks you to confirm granularity and dependencies, then creates local files under `issues/`.

Example prompt:

> Use Waypoint to turn `docs/plans/operator-console.md` into local issues. Keep the approved plan slices unless a dependency is invalid.

### Start one issue in a fresh session

Every issue carries its outcome, context, acceptance criteria, decisions, verification, and handoff. A new session reads the project state instead of relying on the previous conversation.

Example prompt:

> Use Waypoint to start S0.

### Resume interrupted work

Waypoint records the active step and one exact next action. If an agent session ends, the next session can validate state and continue from the issue handoff.

Example prompt:

> Use Waypoint to resume the current issue from its durable handoff.

### Pause safely for human input

Issues are autonomous by default. When the agent reaches a decision, approval, credential action, external setup, or subjective review that only a human can provide, it enters `awaiting_human`, records one precise request, and halts. The human response is recorded before work resumes.

Example prompts:

> Ask me before choosing the production identity provider.

> Resume S3 with this response: the customer approved the requested OAuth scopes.

### Verify and complete work with evidence

Waypoint does not mark work complete because code was written. Completion requires checked acceptance criteria and recorded commands, artifacts, or review evidence.

Example prompt:

> Use Waypoint to verify S4 and complete it only if every acceptance criterion has evidence.

### See project status

The generated dashboard shows planned, active, blocked, human-waiting, verification, and completed work with dependencies and next actions.

Example prompt:

> Use Waypoint to show current status and the next unblocked issue.

## Recommended Workflow

```text
explore the codebase
-> challenge decisions with grill-me
-> write a durable plan
-> review and approve it with Lavish
-> use Waypoint to create local issues
-> work on one issue per fresh session
-> checkpoint, wait for a human, verify, and complete through Waypoint
```

Waypoint does not create GitHub issues. Its issue tracker is the project’s root `issues/` directory.

## Install The Skill With `npx skills`

Vercel’s [Skills CLI](https://github.com/vercel-labs/skills) discovers repositories containing `SKILL.md` and installs skills for supported coding agents.

### From a single-skill repository

```bash
npx skills add omorShahriar/waypoint
```

### From a repository containing multiple skills

```bash
npx skills add omorShahriar/waypoint --skill waypoint
```

### Install globally on your machine

```bash
npx skills add omorShahriar/waypoint --global
```

A global skill can initialize many projects. Each project keeps isolated issue state.

### Install for a specific agent

```bash
npx skills add omorShahriar/waypoint --agent opencode
```

Use the agent name shown by your installed Skills CLI. You can also let the CLI prompt for supported agents.

### Copy instead of symlink

The CLI may use links when installing local skills. To install a physical copy:

```bash
npx skills add omorShahriar/waypoint --copy
```

### Test this checkout before publishing

From the repository containing this skill:

```bash
npx skills add . --skill waypoint --list
npx skills add . --skill waypoint --copy
```

When pointing directly at a local skill directory, include `./` so the CLI treats it as a filesystem path rather than a repository shorthand:

```bash
npx skills add ./.agents/skills/waypoint --list
```

After installing or updating a skill, restart your coding agent so it reloads skill definitions.

## Initialize Waypoint In A Project

Installing the skill makes Waypoint available to the agent. Initializing a project creates that project’s durable execution state.

Ask the agent:

> Initialize Waypoint in this project.

The agent resolves Waypoint’s installed directory, previews installation, and runs its packaged installer against the selected project root.

Manual initialization is also possible:

```bash
node <waypoint-skill-directory>/scripts/install.mjs \
  --root /path/to/project \
  --dry-run

node <waypoint-skill-directory>/scripts/install.mjs \
  --root /path/to/project
```

The target project receives:

```text
issues/
  AGENTS.md
  PLAN-ISSUES.example.json
  README.md
  TEMPLATE.md
  WORKFLOW.md
  config.json
scripts/
  waypoint.mjs
  waypoint.test.mjs
AGENTS.md  # created or appended through a marked Waypoint block
```

Why vendor the runtime into the project:

- fresh agents can discover the workflow from project instructions;
- CI can validate issue state without a global skill installation;
- collaborators use the same runtime behavior;
- project history records workflow changes alongside implementation state.

The skill itself may be installed globally or project-locally. Runtime state always belongs to the explicit target project.

## What Waypoint Manages

### Issue states

```text
planned -> ready -> in_progress -> verification -> done
                       |       |
                       |       +-> blocked
                       +-> awaiting_human -> in_progress

done -> reopened -> in_progress
```

### Durable issue contents

Each issue records:

- intended outcome;
- approved plan and inherited context;
- acceptance criteria;
- dependencies and unlocked work;
- implementation decisions and activity;
- verification evidence;
- current step and exact next action;
- structured human request and response;
- fresh-session handoff.

### Safety guards

- Dependencies must be complete before work starts.
- Active-work limits prevent accidental parallel ownership.
- Human-waiting issues cannot resume through a generic transition.
- Completion requires checked criteria and evidence.
- Generated dashboard state cannot drift silently from issue files.
- Conflicting installer files are not overwritten without explicit `--force` approval.

## Useful Commands

Agents normally run these for you. They are available for inspection and automation.

```bash
# Validate issue metadata, dependencies, state, and dashboard freshness
node scripts/waypoint.mjs validate

# Show the current dashboard
node scripts/waypoint.mjs status

# Regenerate issues/README.md
node scripts/waypoint.mjs sync

# Create approved local issues from a manifest
node scripts/waypoint.mjs create-from-plan issues/plan.json

# Save durable progress without changing state
node scripts/waypoint.mjs checkpoint S0 \
  --active-step "Documenting lifecycle contracts" \
  --next-action "Resolve cutover evidence ownership" \
  --note "Published the operator journey draft"

# Pause for a human-only decision or action
node scripts/waypoint.mjs request-human S0 \
  --request-id "identity-provider" \
  --question "Which company OIDC provider should production use?" \
  --reason "Deployment configuration depends on this decision" \
  --expected-response "Provider name and tenant constraints" \
  --resume-condition "A production OIDC provider is selected"

# Record the answer and resume
node scripts/waypoint.mjs resume-human S0 \
  --response "Use the company Entra tenant" \
  --responded-by "project owner" \
  --next-action "Finalize the OIDC deployment contract"
```

## Publishing Waypoint

The Skills CLI discovers either of these layouts:

Single-skill repository:

```text
SKILL.md
README.md
scripts/
templates/
```

Multi-skill repository:

```text
skills/
  waypoint/
    SKILL.md
    README.md
    scripts/
    templates/
```

It also discovers standard agent-specific containers such as `.agents/skills/waypoint/`. A standalone Waypoint repository should prefer the root layout because it is simplest for people to inspect and install:

```bash
npx skills add omorShahriar/waypoint
```

For a multi-skill repository:

```bash
npx skills add omorShahriar/waypoint --skill waypoint
```

## Development

Requirements:

- Node.js 20 or newer;
- no npm runtime dependencies.

Run the package tests:

```bash
node --test scripts/waypoint.test.mjs scripts/install.test.mjs
```

The install suite verifies clean installation, idempotency, preservation of existing agent instructions, conflict refusal, local issue creation, checkpoints, human pause/resume, and state validation.

## Current Scope

Waypoint currently provides local issue creation, guarded state transitions, durable checkpoints, human pause/resume, evidence-based completion, and a generated dashboard.

Planned hardening areas include schema/package migrations, execution leases for concurrent sessions, richer context manifests, and interruption recovery.

## License

Waypoint is available under the [MIT License](LICENSE).

## References

- [Vercel Agent Skills](https://vercel.com/docs/agent-resources/skills)
- [Skills CLI](https://github.com/vercel-labs/skills)
- [Lavish Editor](https://github.com/kunchenguid/lavish-axi)
- [grill-me skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)
