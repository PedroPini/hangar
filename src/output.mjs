import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { referenceFor } from "../catalog.mjs";
import { bold, cyan, dim, green } from "./ansi.mjs";
import { readShortcuts, shortcutConfigPath, shortcutLabel, validateShortcuts, writeShortcuts } from "./shortcuts.mjs";
import { truncate } from "./text.mjs";

export async function configureShortcuts(options) {
  const path = shortcutConfigPath();
  const current = await readShortcuts(path);
  const shortcuts = validateShortcuts({
    type: options.typeKey || current.type,
    scope: options.scopeKey || current.scope,
    config: options.configKey || current.config
  });
  const changed = Boolean(options.typeKey || options.scopeKey || options.configKey);
  if (changed) await writeShortcuts(path, shortcuts);

  process.stdout.write(`${changed ? `${green("Saved")} ` : ""}${bold("Hangar shortcuts")}\n`);
  process.stdout.write(`${dim("File")}      ${path}\n`);
  process.stdout.write(`${dim("Type")}      ${shortcutLabel(shortcuts.type)}\n`);
  process.stdout.write(`${dim("Scope")}     ${shortcutLabel(shortcuts.scope)}\n`);
  process.stdout.write(`${dim("Settings")}  ${shortcutLabel(shortcuts.config)}\n`);
  if (!changed) process.stdout.write(`\nChange them with --type-key, --scope-key, or --config-key.\n`);
}

export function writeList(catalog, capabilities, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...catalog, capabilities: capabilities.map(capabilityForOutput) }, null, 2)}\n`);
    return;
  }

  const width = Math.max(60, Math.min(process.stdout.columns || 100, 140));
  process.stdout.write(`${bold(`${catalog.projectName} capabilities`)} ${dim(`(${capabilities.length})`)}\n`);
  for (const item of capabilities) {
    const meta = `${item.kind} · ${item.scope} · ${item.tools.join(", ")}`;
    process.stdout.write(`\n${cyan(referenceFor(item, options.host))}  ${bold(item.name)}  ${dim(meta)}\n`);
    process.stdout.write(`${truncate(item.description, width)}\n`);
  }
}

export function capabilityForOutput(capability) {
  const output = { ...capability };
  delete output.searchText;
  return output;
}

export function copyToClipboard(value) {
  const candidates = process.platform === "darwin"
    ? [["pbcopy", []]]
    : process.platform === "win32"
      ? [[join(process.env.SystemRoot || "C:\\Windows", "System32", "clip.exe"), []]]
      : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: value, encoding: "utf8" });
    if (!result.error && result.status === 0) return command;
  }
  throw new Error("No supported clipboard command was found; use the printed reference instead");
}
