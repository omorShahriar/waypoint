import assert from "node:assert/strict";
import test from "node:test";
import { assertTransition, parseIssue, renderTable, replaceTable, validateIssues } from "./waypoint.mjs";

function makeIssue({ id = "S0", status = "planned", dependencies = [], evidence = [], unchecked = true } = {}) {
  return parseIssue(`---
kind: "issue"
id: "${id}"
title: "Issue ${id}"
status: "${status}"
priority: "active"
milestone: "test"
depends_on: ${JSON.stringify(dependencies)}
unlocks: []
affected_repos: ["root"]
last_updated: "1970-01-01T00:00:00.000Z"
active_step: "Test"
next_action: "Continue"
evidence: ${JSON.stringify(evidence)}
human_request: null
human_response: null
---

# ${id}

## Outcome
Outcome.

## Context
Context.

## What to build
Build.

## Acceptance criteria
${unchecked ? "- [ ] Complete" : "- [x] Complete"}

## Blocked by
None.

## Decisions
None.

## Implementation log
None.

## Verification
None.

## Handoff
Continue.
`, `${id}.md`);
}

test("parses JSON-valued frontmatter", () => {
  assert.deepEqual(makeIssue({ dependencies: ["S-1"] }).metadata.depends_on, ["S-1"]);
});

test("guards transitions and dependencies", () => {
  const dependency = makeIssue({ id: "S0", status: "in_progress" });
  const dependent = makeIssue({ id: "S1", dependencies: ["S0"] });
  assert.throws(() => assertTransition([dependent], "S1", "done"), /illegal transition/);
  assert.throws(() => assertTransition([dependency, dependent], "S1", "ready"), /incomplete dependencies/);
});

test("requires criteria and evidence before done", () => {
  const unchecked = makeIssue({ status: "verification" });
  assert.throws(() => assertTransition([unchecked], "S0", "done", { evidence: "test" }), /checked criteria/);
  const checked = makeIssue({ status: "verification", unchecked: false });
  assert.throws(() => assertTransition([checked], "S0", "done"), /evidence/);
  assert.doesNotThrow(() => assertTransition([checked], "S0", "done", { evidence: "test" }));
});

test("validates structured human wait state", () => {
  const waiting = makeIssue({ status: "awaiting_human" });
  waiting.metadata.human_request = {
    request_id: "approval-1",
    question: "Approve the design?",
    reason: "Subjective review is required",
    expected_response: "Approve or request changes",
    requested_at: "2026-07-18T00:00:00.000Z",
    resume_condition: "A clear approval decision is recorded",
  };
  assert.deepEqual(validateIssues([waiting]), []);
  waiting.metadata.human_request = null;
  assert.ok(validateIssues([waiting]).some((error) => error.includes("human_request")));
});

test("detects cycles and active limit", () => {
  const a = makeIssue({ id: "A", status: "in_progress", dependencies: ["B"] });
  const b = makeIssue({ id: "B", status: "in_progress", dependencies: ["A"] });
  const errors = validateIssues([a, b], { max_in_progress: 1 });
  assert.ok(errors.some((error) => error.includes("dependency cycle")));
  assert.ok(errors.some((error) => error.includes("in_progress limit")));
});

test("renders and replaces dashboard table", () => {
  const table = renderTable([makeIssue()]);
  const result = replaceTable(`x\n<!-- issue-table:start -->\nold\n<!-- issue-table:end -->\ny\n`, table);
  assert.match(result, /Issue S0/);
  assert.doesNotMatch(result, /\nold\n/);
});
