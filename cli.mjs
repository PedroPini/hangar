#!/usr/bin/env node

import assert from "node:assert/strict";
import { referenceFor, resolvedCapabilityLocations, scanCapabilities } from "./catalog.mjs";
import { dim, green, yellow } from "./src/ansi.mjs";
import { interactivePick } from "./src/keys.mjs";
import { help, parseArguments } from "./src/options.mjs";
import { capabilityForOutput, configureShortcuts, copyToClipboard, writeList } from "./src/output.mjs";
import { frontmatterField, shorten, tomlField } from "./src/parse.mjs";
import { matchingCapabilities } from "./src/search.mjs";
import { normalizeShortcut, readShortcuts } from "./src/shortcuts.mjs";

async function runCheck(project) {
  const sample = `---\nname: sample-skill\ndescription: >\n  Does one useful thing.\n  Keeps the summary readable.\n---\n# Ignored heading`;
  assert.equal(frontmatterField(sample, "name"), "sample-skill");
  assert.equal(frontmatterField(sample, "description"), "Does one useful thing. Keeps the summary readable.");
  assert.equal(shorten(frontmatterField(sample, "description")), "Does one useful thing.");
  assert.equal(shorten("\u001b]0;owned\u0007Visible metadata"), "Visible metadata.");
  assert.equal(tomlField('name = "reviewer"\ndescription = "Checks real changes."', "description"), "Checks real changes.");
  assert.throws(() => normalizeShortcut("ctrl+up"), /reserved by the picker/);
  assert.throws(() => normalizeShortcut("ctrl+shift+c"), /reserved by the picker/);
  assert.equal(referenceFor({ kind: "skill", id: "sample-skill" }, "codex"), "$sample-skill");
  assert.equal(referenceFor({ kind: "skill", id: "sample-skill" }, "claude"), "/sample-skill");
  assert.equal(referenceFor({ kind: "agent", id: "reviewer" }, "codex"), "@reviewer");
  assert.equal(referenceFor({ kind: "plugin", id: "sample-plugin", path: "~/.plugins/sample/plugin.json" }, "codex"), "~/.plugins/sample/plugin.json");
  const result = await scanCapabilities(project);
  assert.ok(Array.isArray(result.capabilities));
  assert.ok(result.capabilities.every(item => item.name && item.path && item.description));
  process.stdout.write(`PASS: catalog, project discovery, and CLI (${result.capabilities.length} capabilities)\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help || options.command === "help") {
    process.stdout.write(help());
    return;
  }
  if (options.command === "config") {
    await configureShortcuts(options);
    return;
  }
  if (options.command === "doctor") {
    for (const location of await resolvedCapabilityLocations(options.project)) {
      process.stdout.write(`${location.scope.padEnd(7)} ${location.kind.padEnd(5)} ${location.tool.padEnd(11)} ${location.directory}\n`);
    }
    return;
  }
  if (options.command === "check") {
    await runCheck(options.project);
    return;
  }

  const catalog = await scanCapabilities(options.project);
  const matches = matchingCapabilities(catalog.capabilities, options);
  if (options.command === "list") {
    writeList(catalog, matches, options);
    return;
  }

  const selected = options.first ? matches[0] : await interactivePick(catalog, options, await readShortcuts());
  if (!selected) {
    if (options.first) throw new Error("No capability matched the requested filters");
    process.exitCode = 130;
    return;
  }

  const reference = referenceFor(selected, options.host);
  if (options.copy) {
    const command = copyToClipboard(reference);
    process.stderr.write(`${green("Copied")} ${reference} ${dim(`with ${command}`)}\n`);
  }
  process.stdout.write(`${options.json ? JSON.stringify(capabilityForOutput(selected), null, 2) : reference}\n`);
}

main().catch(error => {
  process.stderr.write(`${yellow("Hangar error:")} ${error.message}\n`);
  process.exitCode = 1;
});
