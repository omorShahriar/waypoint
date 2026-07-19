import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "install.mjs");

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], {
    encoding: "utf8",
  });
}

function harness(root, ...args) {
  return spawnSync(process.execPath, ["scripts/waypoint.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("installs and verifies a clean project idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "waypoint-install-"));
  try {
    const dryRun = run(root, "--dry-run");
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /create\s+issues\/WORKFLOW\.md/);

    const first = run(root);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Installed and verified/);
    assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /waypoint:start/);
    assert.match(await readFile(join(root, "issues/README.md"), "utf8"), /issue-table:start/);

    const second = run(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /unchanged\s+issues\/WORKFLOW\.md/);

    const manifest = {
      plan: "docs/approved-plan.md",
      milestone: "test-milestone",
      issues: [{
        id: "S0",
        title: "Deliver one complete outcome",
        priority: "active",
        depends_on: [],
        unlocks: [],
        affected_repos: ["root"],
        outcome: "A complete result exists.",
        context: ["Approved locally"],
        what_to_build: "Build the complete result.",
        acceptance_criteria: ["The result is verifiable."],
        next_action: "Inspect the target project",
      }],
    };
    await writeFile(join(root, "issues/plan.json"), JSON.stringify(manifest));
    assert.equal(harness(root, "create-from-plan", "issues/plan.json").status, 0);
    assert.equal(harness(root, "transition", "S0", "ready", "--note", "Ready").status, 0);
    assert.equal(harness(root, "transition", "S0", "in_progress", "--next-action", "Implement", "--note", "Started").status, 0);
    assert.equal(harness(root, "checkpoint", "S0", "--active-step", "Halfway", "--next-action", "Ask for approval", "--note", "Checkpointed").status, 0);
    // Synthetic inputs prove unsafe credential prompts and values fail before persistence.
    const secretRequest = harness(root, "request-human", "S0", "--request-id", "credential-1", "--question", "Paste the API token", "--reason", "Deployment requires setup", "--expected-response", "The API token value", "--resume-condition", "Credentials configured");
    assert.notEqual(secretRequest.status, 0);
    assert.match(secretRequest.stderr, /must not ask for a secret value/);
    assert.equal(harness(root, "request-human", "S0", "--request-id", "approval-1", "--question", "Approve?", "--reason", "Human approval required", "--expected-response", "yes or changes", "--resume-condition", "Approval recorded").status, 0);
    const illegalResume = harness(root, "transition", "S0", "in_progress", "--next-action", "Continue");
    assert.notEqual(illegalResume.status, 0);
    assert.match(illegalResume.stderr, /resume-human/);
    const secretResponse = harness(root, "resume-human", "S0", "--response-summary", "token=EXAMPLE_ONLY_NOT_A_SECRET", "--responded-by", "tester", "--next-action", "Continue implementation");
    assert.notEqual(secretResponse.status, 0);
    assert.match(secretResponse.stderr, /appears to contain a secret value/);
    assert.equal(harness(root, "resume-human", "S0", "--response-summary", "Approved", "--responded-by", "tester", "--next-action", "Continue implementation").status, 0);
    const issue = await readFile(join(root, "issues/S0-deliver-one-complete-outcome.md"), "utf8");
    assert.match(issue, /"summary":"Approved"/);
    assert.doesNotMatch(issue, /EXAMPLE_ONLY_NOT_A_SECRET/);
    const status = harness(root, "status");
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /in_progress/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves existing agent instructions and rejects conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "waypoint-conflict-"));
  try {
    await writeFile(join(root, "AGENTS.md"), "# Existing\n\nKeep this.\n");
    assert.equal(run(root).status, 0);
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /Keep this/);
    assert.match(agents, /waypoint:start/);

    await writeFile(join(root, "issues/WORKFLOW.md"), "conflicting content\n");
    const conflict = run(root);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /refusing to overwrite/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
