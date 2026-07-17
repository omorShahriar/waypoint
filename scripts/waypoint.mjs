#!/usr/bin/env node

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
const ISSUES = join(ROOT, "issues");
const README = join(ISSUES, "README.md");
const CONFIG = join(ISSUES, "config.json");
const START = "<!-- issue-table:start -->";
const END = "<!-- issue-table:end -->";

export const TRANSITIONS = {
  planned: ["ready", "cancelled"],
  ready: ["in_progress", "planned", "cancelled"],
  in_progress: ["blocked", "awaiting_human", "verification", "ready", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  awaiting_human: ["in_progress", "cancelled"],
  verification: ["in_progress", "blocked", "done"],
  done: ["reopened"],
  reopened: ["in_progress", "cancelled"],
  cancelled: [],
};

const REQUIRED_FIELDS = [
  "kind", "id", "title", "status", "priority", "milestone",
  "depends_on", "unlocks", "affected_repos", "last_updated", "active_step",
  "next_action", "evidence", "human_request", "human_response",
];
const REQUIRED_SECTIONS = [
  "Outcome", "Context", "What to build", "Acceptance criteria", "Blocked by",
  "Decisions", "Implementation log", "Verification", "Handoff",
];

export function parseIssue(content, filename = "<memory>") {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const metadata = {};
  for (const [index, line] of match[1].split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${filename}:${index + 2}: invalid frontmatter`);
    const key = line.slice(0, separator).trim();
    try {
      metadata[key] = JSON.parse(line.slice(separator + 1).trim());
    } catch {
      throw new Error(`${filename}:${index + 2}: ${key} must be valid JSON`);
    }
  }
  return { metadata, body: match[2], filename };
}

function serialize(issue) {
  const extras = Object.keys(issue.metadata).filter((key) => !REQUIRED_FIELDS.includes(key)).sort();
  const keys = [...REQUIRED_FIELDS.filter((key) => key in issue.metadata), ...extras];
  const frontmatter = keys.map((key) => `${key}: ${JSON.stringify(issue.metadata[key])}`).join("\n");
  return `---\n${frontmatter}\n---\n${issue.body}`;
}

function section(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`(?:^|\\n)## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? null;
}

function appendSection(body, heading, entry) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(## ${escaped}\\n)([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(pattern);
  if (!match) throw new Error(`missing section: ${heading}`);
  return body.replace(pattern, `${match[1]}${match[2].trimEnd()}\n${entry}\n`);
}

function sortIssues(a, b) {
  const rank = (id) => {
    const match = String(id).match(/^(.*?)(\d+)$/);
    return match ? [match[1], Number(match[2]), id] : [id, -1, id];
  };
  const aa = rank(a.metadata.id);
  const bb = rank(b.metadata.id);
  return aa[0].localeCompare(bb[0]) || aa[1] - bb[1] || aa[2].localeCompare(bb[2]);
}

export function validateIssues(issues, config = { max_in_progress: 1 }) {
  const errors = [];
  const byId = new Map();
  for (const issue of issues) {
    const { metadata: meta, body, filename } = issue;
    for (const field of REQUIRED_FIELDS) if (!(field in meta)) errors.push(`${filename}: missing ${field}`);
    if (meta.kind !== "issue") errors.push(`${filename}: kind must be \"issue\"`);
    if (byId.has(meta.id)) errors.push(`${filename}: duplicate id ${meta.id}`);
    else byId.set(meta.id, issue);
    if (!(meta.status in TRANSITIONS)) errors.push(`${filename}: invalid status ${meta.status}`);
    for (const field of ["depends_on", "unlocks", "affected_repos", "evidence"]) {
      if (!Array.isArray(meta[field])) errors.push(`${filename}: ${field} must be an array`);
    }
    for (const heading of REQUIRED_SECTIONS) if (section(body, heading) === null) errors.push(`${filename}: missing ## ${heading}`);
    if (meta.status === "awaiting_human") {
      const required = ["request_id", "question", "reason", "expected_response", "requested_at", "resume_condition"];
      if (!meta.human_request || typeof meta.human_request !== "object") errors.push(`${filename}: awaiting_human requires human_request`);
      else for (const field of required) if (!meta.human_request[field]) errors.push(`${filename}: human_request missing ${field}`);
      if (meta.human_response !== null) errors.push(`${filename}: awaiting_human cannot have human_response`);
    }
    if (meta.human_response !== null) {
      const required = ["request_id", "response", "responded_by", "responded_at"];
      if (!meta.human_response || typeof meta.human_response !== "object") errors.push(`${filename}: human_response must be an object or null`);
      else {
        for (const field of required) if (!meta.human_response[field]) errors.push(`${filename}: human_response missing ${field}`);
        if (meta.human_request?.request_id !== meta.human_response.request_id) errors.push(`${filename}: human response does not match request`);
      }
    }
    if (meta.status === "done") {
      if (body.includes("- [ ]")) errors.push(`${filename}: done issue has unchecked criteria`);
      if (!meta.evidence?.length) errors.push(`${filename}: done issue requires evidence`);
    }
  }

  for (const issue of issues) {
    const meta = issue.metadata;
    for (const dependencyId of meta.depends_on ?? []) {
      const dependency = byId.get(dependencyId);
      if (!dependency) errors.push(`${issue.filename}: unknown dependency ${dependencyId}`);
      else if (["ready", "in_progress", "awaiting_human", "verification", "done"].includes(meta.status) && dependency.metadata.status !== "done") {
        errors.push(`${issue.filename}: ${meta.status} depends on incomplete ${dependencyId}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path = []) => {
    if (visiting.has(id)) return errors.push(`dependency cycle: ${[...path, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.metadata.depends_on ?? []) if (byId.has(dependency)) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  const active = issues.filter((issue) => issue.metadata.status === "in_progress");
  if (active.length > (config.max_in_progress ?? 1)) errors.push(`in_progress limit exceeded: ${active.map((issue) => issue.metadata.id).join(", ")}`);
  return errors;
}

export function assertTransition(issues, id, next, options = {}) {
  const issue = issues.find((candidate) => candidate.metadata.id === id);
  if (!issue) throw new Error(`unknown issue: ${id}`);
  if (!TRANSITIONS[issue.metadata.status]?.includes(next)) throw new Error(`illegal transition: ${issue.metadata.status} -> ${next}`);
  if (["ready", "in_progress", "verification"].includes(next)) {
    const incomplete = issue.metadata.depends_on.filter((dependencyId) => issues.find((candidate) => candidate.metadata.id === dependencyId)?.metadata.status !== "done");
    if (incomplete.length) throw new Error(`incomplete dependencies: ${incomplete.join(", ")}`);
  }
  if (next === "in_progress" && !options.nextAction) throw new Error("in_progress requires --next-action");
  if (next === "blocked" && (!options.note || !options.nextAction)) throw new Error("blocked requires --note and --next-action");
  if (next === "done") {
    if (issue.body.includes("- [ ]")) throw new Error("done requires checked criteria");
    if (!(options.evidence || issue.metadata.evidence.length)) throw new Error("done requires evidence");
  }
  return issue;
}

function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderTable(issues) {
  const rows = [
    "| ID | Issue | Milestone | Status | Priority | Blocked by | Waiting on | Next action | Updated |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const issue of [...issues].sort(sortIssues)) {
    const meta = issue.metadata;
    const waiting = meta.status === "awaiting_human" ? meta.human_request?.question ?? "Human response" : "None";
    rows.push(`| ${cell(meta.id)} | [${cell(meta.title)}](${cell(issue.filename)}) | ${cell(meta.milestone)} | \`${cell(meta.status)}\` | ${cell(meta.priority)} | ${cell(meta.depends_on.length ? meta.depends_on.join(", ") : "None")} | ${cell(waiting)} | ${cell(meta.next_action)} | ${cell(String(meta.last_updated).slice(0, 10))} |`);
  }
  return rows.join("\n");
}

export function replaceTable(readme, table) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error("README table markers missing");
  return `${readme.slice(0, start + START.length)}\n${table}\n${readme.slice(end)}`;
}

async function loadIssues() {
  const entries = await readdir(ISSUES, { withFileTypes: true });
  const issues = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const parsed = parseIssue(await readFile(join(ISSUES, entry.name), "utf8"), entry.name);
    if (parsed?.metadata.kind === "issue") issues.push(parsed);
  }
  return issues.sort(sortIssues);
}

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG, "utf8"));
}

async function sync(issues) {
  const readme = await readFile(README, "utf8");
  await writeFile(README, replaceTable(readme, renderTable(issues)));
}

async function validate(checkReadme = true) {
  const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
  const errors = validateIssues(issues, config);
  if (checkReadme) {
    const readme = await readFile(README, "utf8");
    if (replaceTable(readme, renderTable(issues)) !== readme) errors.push("README is stale; run sync");
  }
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  return issues;
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`invalid option near ${key ?? "end"}`);
    result[key.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireOptions(opts, names, command) {
  const missing = names.filter((name) => !opts[name]);
  if (missing.length) throw new Error(`${command} missing options: ${missing.map((name) => `--${name.replaceAll("_", "-")}`).join(", ")}`);
}

async function persistIssue(issue, issues, config) {
  const errors = validateIssues(issues, config);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  await writeFile(join(ISSUES, issue.filename), serialize(issue));
  await sync(issues);
  await validate();
}

function issueBody(manifest, item) {
  const context = item.context.map((entry) => `- ${entry}`).join("\n");
  const criteria = item.acceptance_criteria.map((entry) => `- [ ] ${entry}`).join("\n");
  const blockers = item.depends_on.length ? item.depends_on.map((id) => `- \`${id}\``).join("\n") : "None - can start when moved to `ready`.";
  return `\n# ${item.id}: ${item.title}\n\n## Outcome\n\n${item.outcome}\n\n## Context\n\n- Approved plan: \`${manifest.plan}\`\n${context}\n\n## What to build\n\n${item.what_to_build}\n\n## Acceptance criteria\n\n${criteria}\n\n## Blocked by\n\n${blockers}\n\n## Decisions\n\n- No issue-specific decisions recorded yet.\n\n## Implementation log\n\n- Created from approved plan manifest.\n\n## Verification\n\n- Not run.\n\n## Handoff\n\n- Current behavior: Not implemented.\n- Remaining work: Everything in this issue.\n- Exact next action: ${item.next_action}\n- Tests to rerun: None yet.\n- Decisions to preserve: Follow the approved plan and project invariants.\n`;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("manifest must be a JSON object");
  if (!manifest.plan || !manifest.milestone || !Array.isArray(manifest.issues) || !manifest.issues.length) throw new Error("manifest requires plan, milestone, and a non-empty issues array");
  const ids = new Set();
  const required = ["id", "title", "priority", "depends_on", "unlocks", "affected_repos", "outcome", "context", "what_to_build", "acceptance_criteria", "next_action"];
  for (const [index, item] of manifest.issues.entries()) {
    for (const field of required) if (!(field in item)) throw new Error(`manifest issue ${index} missing ${field}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.id)) throw new Error(`invalid issue id: ${item.id}`);
    if (ids.has(item.id)) throw new Error(`duplicate manifest issue id: ${item.id}`);
    ids.add(item.id);
    for (const field of ["depends_on", "unlocks", "affected_repos", "context", "acceptance_criteria"]) if (!Array.isArray(item[field])) throw new Error(`${item.id}: ${field} must be an array`);
    if (!item.acceptance_criteria.length) throw new Error(`${item.id}: acceptance_criteria cannot be empty`);
  }
}

async function createFromPlan(manifestPath) {
  if (!manifestPath) throw new Error("usage: create-from-plan <manifest-path>");
  const path = isAbsolute(manifestPath) ? manifestPath : resolve(ROOT, manifestPath);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  validateManifest(manifest);
  const [existing, config] = await Promise.all([loadIssues(), loadConfig()]);
  const existingIds = new Set(existing.map((issue) => issue.metadata.id));
  const now = new Date().toISOString();
  const created = [];
  for (const item of manifest.issues) {
    if (existingIds.has(item.id)) throw new Error(`issue already exists: ${item.id}`);
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "issue";
    const filename = `${item.id}-${slug}.md`;
    if (await exists(join(ISSUES, filename))) throw new Error(`issue file already exists: ${filename}`);
    created.push({
      filename,
      metadata: {
        kind: "issue", id: item.id, title: item.title, status: "planned",
        priority: item.priority, milestone: manifest.milestone,
        depends_on: item.depends_on, unlocks: item.unlocks,
        affected_repos: item.affected_repos, last_updated: now,
        active_step: "Not started", next_action: item.next_action, evidence: [],
        human_request: null, human_response: null,
      },
      body: issueBody(manifest, item),
    });
  }
  const prospective = [...existing, ...created];
  const errors = validateIssues(prospective, config);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  for (const issue of created) await writeFile(join(ISSUES, issue.filename), serialize(issue));
  await sync(prospective);
  await validate();
  console.log(`Created ${created.length} issue(s) from ${manifest.plan}.`);
}

async function checkpoint(id, args) {
  const opts = options(args);
  requireOptions(opts, ["active_step", "next_action", "note"], "checkpoint");
  const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
  const issue = issues.find((candidate) => candidate.metadata.id === id);
  if (!issue) throw new Error(`unknown issue: ${id}`);
  if (["done", "cancelled"].includes(issue.metadata.status)) throw new Error(`cannot checkpoint ${issue.metadata.status} issue`);
  const now = new Date().toISOString();
  issue.metadata.last_updated = now;
  issue.metadata.active_step = opts.active_step;
  issue.metadata.next_action = opts.next_action;
  if (opts.evidence) issue.metadata.evidence.push(opts.evidence);
  issue.body = appendSection(issue.body, "Implementation log", `- ${now}: ${opts.note}`);
  await persistIssue(issue, issues, config);
  console.log(`${id}: checkpointed`);
}

async function requestHuman(id, args) {
  const opts = options(args);
  requireOptions(opts, ["request_id", "question", "reason", "expected_response", "resume_condition"], "request-human");
  const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
  const issue = assertTransition(issues, id, "awaiting_human");
  const now = new Date().toISOString();
  issue.metadata.status = "awaiting_human";
  issue.metadata.last_updated = now;
  issue.metadata.active_step = "Awaiting human";
  issue.metadata.next_action = opts.resume_condition;
  issue.metadata.human_request = {
    request_id: opts.request_id, question: opts.question, reason: opts.reason,
    expected_response: opts.expected_response, requested_at: now,
    resume_condition: opts.resume_condition,
  };
  issue.metadata.human_response = null;
  issue.body = appendSection(issue.body, "Implementation log", `- ${now}: Awaiting human (${opts.request_id}): ${opts.question}`);
  await persistIssue(issue, issues, config);
  console.log(`${id}: awaiting_human (${opts.request_id})`);
}

async function resumeHuman(id, args) {
  const opts = options(args);
  requireOptions(opts, ["response", "responded_by", "next_action"], "resume-human");
  const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
  const issue = assertTransition(issues, id, "in_progress", { nextAction: opts.next_action });
  if (!issue.metadata.human_request) throw new Error(`${id}: no human request to resume`);
  const now = new Date().toISOString();
  issue.metadata.human_response = {
    request_id: issue.metadata.human_request.request_id, response: opts.response,
    responded_by: opts.responded_by, responded_at: now,
  };
  issue.metadata.status = "in_progress";
  issue.metadata.last_updated = now;
  issue.metadata.active_step = "Resumed after human response";
  issue.metadata.next_action = opts.next_action;
  issue.body = appendSection(issue.body, "Implementation log", `- ${now}: Human response recorded for ${issue.metadata.human_request.request_id} by ${opts.responded_by}`);
  await persistIssue(issue, issues, config);
  console.log(`${id}: in_progress after human response`);
}

async function transition(id, next, args) {
  const opts = options(args);
  const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
  const current = issues.find((candidate) => candidate.metadata.id === id)?.metadata.status;
  if (next === "awaiting_human" || (current === "awaiting_human" && next === "in_progress")) throw new Error("use request-human or resume-human for human transitions");
  const issue = assertTransition(issues, id, next, { note: opts.note, nextAction: opts.next_action, evidence: opts.evidence });
  const now = new Date().toISOString();
  issue.metadata.status = next;
  issue.metadata.last_updated = now;
  issue.metadata.active_step = opts.active_step ?? next;
  issue.metadata.next_action = opts.next_action ?? issue.metadata.next_action;
  if (opts.evidence) issue.metadata.evidence.push(opts.evidence);
  if (opts.note) issue.body = appendSection(issue.body, "Implementation log", `- ${now}: ${opts.note}`);
  const errors = validateIssues(issues, config);
  if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  await writeFile(join(ISSUES, issue.filename), serialize(issue));
  await sync(issues);
  await validate();
  console.log(`${id}: ${next}`);
}

async function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  if (command === "validate") return console.log(`Validated ${(await validate()).length} issue(s).`);
  if (command === "sync") {
    const [issues, config] = await Promise.all([loadIssues(), loadConfig()]);
    const errors = validateIssues(issues, config);
    if (errors.length) throw new Error(errors.map((error) => `- ${error}`).join("\n"));
    await sync(issues);
    await validate();
    return console.log(`Synced ${issues.length} issue(s).`);
  }
  if (command === "status") return console.log(renderTable(await validate(false)));
  if (command === "create-from-plan") return createFromPlan(args[0]);
  if (command === "checkpoint") {
    const [id, ...rest] = args;
    if (!id) throw new Error("usage: checkpoint <id> [options]");
    return checkpoint(id, rest);
  }
  if (command === "request-human") {
    const [id, ...rest] = args;
    if (!id) throw new Error("usage: request-human <id> [options]");
    return requestHuman(id, rest);
  }
  if (command === "resume-human") {
    const [id, ...rest] = args;
    if (!id) throw new Error("usage: resume-human <id> [options]");
    return resumeHuman(id, rest);
  }
  if (command === "transition") {
    const [id, next, ...rest] = args;
    if (!id || !next) throw new Error("usage: transition <id> <status> [options]");
    return transition(id, next, rest);
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => {
    console.error(`waypoint: ${error.message}`);
    process.exitCode = 1;
  });
}
