import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repository, "cli.mjs");
const editor = join(repository, "editor.mjs");

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "hangar-test-"));
  const home = join(root, "home");
  const project = join(home, "work", "project");
  const config = join(home, ".config", "hangar", "config.json");
  await mkdir(join(project, ".git"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    HANGAR_CONFIG: config,
    NO_COLOR: "1"
  };

  return { root, home, project, config, env };
}

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || repository,
    env: options.env || process.env,
    encoding: "utf8"
  });
}

async function addCapabilities({ home, project }) {
  await write(join(home, ".agents", "skills", "shared-skill", "SKILL.md"), `---
name: shared-skill
description: Global description.
---
`);
  await write(join(project, ".agents", "skills", "shared-skill", "SKILL.md"), `---
name: shared-skill
description: Project description.
---
`);
  await write(join(project, ".claude", "agents", "reviewer.md"), `---
name: reviewer
description: Reviews project changes.
---
`);
  await write(join(project, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "demo-plugin",
    version: "1.2.3",
    description: "A demo plugin."
  }, null, 2)}\n`);
  await write(join(project, "skills", "plugin-skill", "SKILL.md"), `---
name: plugin-skill
description: Skill bundled by the demo plugin.
---
`);
}

test("discovers project overrides, agents, plugins, and bundled capabilities", async t => {
  const fixture = await sandbox(t);
  await addCapabilities(fixture);

  const result = run(cli, ["list", "--json", "--project", fixture.project], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.stdout);
  assert.ok(catalog.capabilities.every(item => !("searchText" in item)));

  const sharedSkill = catalog.capabilities.find(item => item.id === "shared-skill");
  assert.equal(sharedSkill.scope, "project");
  assert.equal(sharedSkill.description, "Project description.");
  assert.equal(sharedSkill.sourceCount, 2);
  assert.equal(sharedSkill.variantCount, 2);

  const reviewer = catalog.capabilities.find(item => item.id === "reviewer");
  assert.equal(reviewer.kind, "agent");
  assert.equal(reviewer.scope, "project");

  const plugin = catalog.capabilities.find(item => item.id === "demo-plugin");
  assert.equal(plugin.kind, "plugin");
  assert.equal(plugin.scope, "project");
  assert.equal(plugin.contents.skills, 2);
  assert.equal(plugin.contents.agents, 1);

  const pluginSkill = catalog.capabilities.find(item => item.id === "plugin-skill");
  assert.ok(pluginSkill.collections.some(collection => collection.id === "demo-plugin"));
  assert.ok(catalog.capabilities.some(item => item.id === "default" && item.kind === "agent"));
});

test("follows capability symlinks without escaping capability roots", async t => {
  const fixture = await sandbox(t);
  const sentinel = "FAKE_HANGAR_SECURITY_SENTINEL_7c21";
  const secret = join(fixture.home, "private", "fake-secret.txt");
  const escapedLink = join(fixture.project, ".agents", "skills", "leak", "SKILL.md");
  const sharedSkill = join(fixture.project, ".agents", "skills", "linked-skill", "SKILL.md");
  const sharedLink = join(fixture.project, ".claude", "skills", "linked-skill", "SKILL.md");
  await write(secret, sentinel);
  await write(sharedSkill, `---
name: linked-skill
description: Shared through a safe symlink.
---
`);
  await mkdir(dirname(escapedLink), { recursive: true });
  await mkdir(dirname(sharedLink), { recursive: true });
  try {
    await symlink(secret, escapedLink, "file");
    await symlink(sharedSkill, sharedLink, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("File symlinks are unavailable on this runner");
      return;
    }
    throw error;
  }

  const result = run(cli, ["list", "--json", "--project", fixture.project], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(sentinel));
  const catalog = JSON.parse(result.stdout);
  assert.ok(!catalog.capabilities.some(item => item.id === "leak"));
  const linkedSkill = catalog.capabilities.find(item => item.id === "linked-skill");
  assert.equal(linkedSkill.sourceCount, 2);
  assert.ok(linkedSkill.tools.includes("Shared"));
  assert.ok(linkedSkill.tools.includes("Claude Code"));
});

test("ignores oversized capability metadata", async t => {
  const fixture = await sandbox(t);
  await write(join(fixture.project, ".agents", "skills", "oversized", "SKILL.md"), "x".repeat(1024 * 1024 + 1));

  const result = run(cli, ["list", "--json", "--project", fixture.project], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.stdout);
  assert.ok(!catalog.capabilities.some(item => item.id === "oversized"));
  assert.equal(catalog.unreadableCount, 1);
});

test("runs the built-in self-check against an isolated catalog", async t => {
  const fixture = await sandbox(t);
  await addCapabilities(fixture);

  const result = run(cli, ["check", "--project", fixture.project], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PASS: catalog, project discovery, and CLI \(\d+ capabilities\)$/m);
});

test("filters capabilities and rejects unknown arguments", async t => {
  const fixture = await sandbox(t);
  await addCapabilities(fixture);

  const selected = run(cli, ["--project", fixture.project, "--query", "plugin-skill", "--first", "--host", "name"], { env: fixture.env });
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stdout.trim(), "plugin-skill");

  const invalid = run(cli, ["--project", fixture.project, "--not-a-real-option"], { env: fixture.env });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown argument: --not-a-real-option/);
});

test("persists shortcut configuration and rejects duplicates", async t => {
  const fixture = await sandbox(t);

  const saved = run(cli, ["config", "--type-key", "ctrl+t", "--config-key", "f3"], { env: fixture.env });
  assert.equal(saved.status, 0, saved.stderr);
  assert.deepEqual(JSON.parse(await readFile(fixture.config, "utf8")), {
    shortcuts: { type: "ctrl+t", scope: "shift+tab", config: "f3" }
  });

  const duplicate = run(cli, ["config", "--scope-key", "ctrl+t"], { env: fixture.env });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /Picker shortcuts must be different/);
});

test("editor appends the selected reference to an existing prompt", async t => {
  const fixture = await sandbox(t);
  await addCapabilities(fixture);
  const prompt = join(fixture.root, "prompt.txt");
  await write(prompt, "Use");

  const result = run(editor, [prompt], {
    env: {
      ...fixture.env,
      HANGAR_PROJECT: fixture.project,
      HANGAR_HOST: "codex",
      HANGAR_QUERY: "plugin-skill",
      HANGAR_FIRST: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(prompt, "utf8"), "Use $plugin-skill");
});
