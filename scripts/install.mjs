#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");

const COPIES = [
  ["templates/issues/WORKFLOW.md", "issues/WORKFLOW.md"],
  ["templates/issues/AGENTS.md", "issues/AGENTS.md"],
  ["templates/issues/TEMPLATE.md", "issues/TEMPLATE.md"],
  ["templates/issues/README.md", "issues/README.md"],
  ["templates/issues/config.json", "issues/config.json"],
  ["templates/issues/PLAN-ISSUES.example.json", "issues/PLAN-ISSUES.example.json"],
  ["scripts/waypoint.mjs", "scripts/waypoint.mjs"],
  ["scripts/waypoint.test.mjs", "scripts/waypoint.test.mjs"],
];

function parseArgs(argv) {
  const options = { root: process.cwd(), dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a path");
      options.root = resolve(value);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function planCopy(source, target, force) {
  const sourceContent = await readFile(source, "utf8");
  if (!(await exists(target))) return { action: "create", sourceContent };
  const targetContent = await readFile(target, "utf8");
  if (sourceContent === targetContent) return { action: "unchanged", sourceContent };
  if (!force) return { action: "conflict", sourceContent };
  return { action: "overwrite", sourceContent };
}

async function planAgents(root, force) {
  const target = join(root, "AGENTS.md");
  const snippet = (await readFile(join(SKILL_DIR, "templates/root-AGENTS-snippet.md"), "utf8")).trim();
  if (!(await exists(target))) {
    return { target, action: "create", content: `# Agent Instructions\n\n${snippet}\n` };
  }
  const current = await readFile(target, "utf8");
  const start = "<!-- waypoint:start -->";
  const end = "<!-- waypoint:end -->";
  const startIndex = current.indexOf(start);
  if (startIndex < 0) {
    return { target, action: "append", content: `${current.trimEnd()}\n\n${snippet}\n` };
  }
  const endIndex = current.indexOf(end, startIndex);
  if (endIndex < 0) return { target, action: "conflict", content: current };
  const existing = current.slice(startIndex, endIndex + end.length).trim();
  if (existing === snippet) return { target, action: "unchanged", content: current };
  if (!force) return { target, action: "conflict", content: current };
  const content = `${current.slice(0, startIndex)}${snippet}${current.slice(endIndex + end.length)}`;
  return { target, action: "overwrite-block", content };
}

async function install(options) {
  if (!(await exists(options.root))) throw new Error(`root does not exist: ${options.root}`);
  const plans = [];
  for (const [sourceRelative, targetRelative] of COPIES) {
    const source = join(SKILL_DIR, sourceRelative);
    const target = join(options.root, targetRelative);
    plans.push({
      source,
      target,
      targetRelative,
      ...(await planCopy(source, target, options.force)),
    });
  }
  plans.push({ targetRelative: "AGENTS.md", ...(await planAgents(options.root, options.force)) });

  const conflicts = plans.filter((plan) => plan.action === "conflict");
  for (const plan of plans) console.log(`${plan.action.padEnd(15)} ${plan.targetRelative}`);
  if (conflicts.length) {
    throw new Error(`refusing to overwrite ${conflicts.length} conflicting file(s); review them or rerun with --force`);
  }
  if (options.dryRun) return;

  for (const plan of plans) {
    if (plan.action === "unchanged") continue;
    await mkdir(dirname(plan.target), { recursive: true });
    await writeFile(plan.target, plan.content ?? plan.sourceContent);
  }

  const test = spawnSync(process.execPath, ["--test", "scripts/waypoint.test.mjs"], {
    cwd: options.root,
    encoding: "utf8",
  });
  if (test.status !== 0) throw new Error(`installed runtime tests failed:\n${test.stderr || test.stdout}`);

  for (const command of ["sync", "validate"]) {
    const result = spawnSync(process.execPath, ["scripts/waypoint.mjs", command], {
      cwd: options.root,
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
  console.log(`Installed and verified Waypoint in ${options.root}`);
}

install(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(`Waypoint installer: ${error.message}`);
  process.exitCode = 1;
});
