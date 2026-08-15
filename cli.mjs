#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { frontmatterField, referenceFor, resolvedCapabilityLocations, scanCapabilities, shorten, tomlField } from "./catalog.mjs";

const ESC = "\u001b[";
const colorsEnabled = !process.env.NO_COLOR;
const color = (code, value) => colorsEnabled ? `${ESC}${code}m${value}${ESC}0m` : value;
const bold = value => color("1", value);
const dim = value => color("2", value);
const cyan = value => color("36", value);
const green = value => color("32", value);
const yellow = value => color("33", value);
const defaultShortcuts = Object.freeze({ type: "tab", scope: "shift+tab", config: "f2" });
const shortcutSettings = Object.freeze([
  { id: "type", label: "Type filter" },
  { id: "scope", label: "Scope filter" },
  { id: "config", label: "Open settings" }
]);

function shortcutConfigPath() {
  if (process.env.HANGAR_CONFIG) return resolve(process.env.HANGAR_CONFIG);
  const configHome = process.env.XDG_CONFIG_HOME ? resolve(process.env.XDG_CONFIG_HOME) : join(homedir(), ".config");
  return join(configHome, "hangar", "config.json");
}

function normalizeShortcut(value) {
  const aliases = new Map([["control", "ctrl"], ["option", "alt"], ["meta", "alt"], ["esc", "escape"], ["return", "enter"]]);
  const parts = String(value || "").trim().toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean).map(part => aliases.get(part) || part);
  const keyName = parts.pop();
  const modifiers = new Set(parts);
  if (!keyName || parts.some(part => !["ctrl", "alt", "shift"].includes(part)) || modifiers.size !== parts.length || !/^[a-z0-9]+$/.test(keyName)) {
    throw new Error(`Invalid shortcut: ${value}. Try tab, shift+tab, ctrl+s, alt+s, or f2`);
  }

  const normalized = [...["ctrl", "alt", "shift"].filter(modifier => modifiers.has(modifier)), keyName].join("+");
  const reservedKeys = new Set(["escape", "enter", "up", "down", "pageup", "pagedown", "backspace"]);
  if (reservedKeys.has(keyName) || normalized === "ctrl+u" || (keyName === "c" && modifiers.has("ctrl"))) {
    throw new Error(`${value} is reserved by the picker`);
  }
  if (!modifiers.has("ctrl") && !modifiers.has("alt") && keyName !== "tab" && !/^f(?:[1-9]|1[0-2])$/.test(keyName)) {
    throw new Error(`${value} would interfere with typing; add Ctrl or Alt`);
  }
  return normalized;
}

function shortcutLabel(value) {
  const labels = new Map([["ctrl", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"], ["tab", "Tab"], ["escape", "Esc"], ["enter", "Enter"]]);
  return value.split("+").map(part => labels.get(part) || part.toUpperCase()).join("+");
}

function shortcutMatches(key, value) {
  const parts = value.split("+");
  const name = parts.at(-1);
  return key.name === name
    && Boolean(key.ctrl) === parts.includes("ctrl")
    && Boolean(key.meta) === parts.includes("alt")
    && Boolean(key.shift) === parts.includes("shift");
}

function shortcutFromKey(text, key) {
  const name = key.name || String(text || "").toLowerCase();
  const modifiers = [key.ctrl && "ctrl", key.meta && "alt", key.shift && "shift"].filter(Boolean);
  return normalizeShortcut([...modifiers, name].join("+"));
}

function validateShortcuts(shortcuts) {
  const normalized = {
    type: normalizeShortcut(shortcuts.type),
    scope: normalizeShortcut(shortcuts.scope),
    config: normalizeShortcut(shortcuts.config)
  };
  if (new Set(Object.values(normalized)).size !== Object.keys(normalized).length) throw new Error("Picker shortcuts must be different");
  return normalized;
}

async function readShortcuts(path = shortcutConfigPath()) {
  let config;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { ...defaultShortcuts };
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${path}`);
    throw error;
  }
  return validateShortcuts({ ...defaultShortcuts, ...config.shortcuts });
}

async function writeShortcuts(path, shortcuts) {
  let config = {};
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${path}`);
      throw error;
    }
  }
  config.shortcuts = shortcuts;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function parseArguments(argv) {
  const commands = new Set(["pick", "list", "doctor", "check", "config", "help"]);
  const options = {
    command: "pick",
    project: process.cwd(),
    query: "",
    kind: "all",
    scope: "all",
    tool: "",
    host: "codex",
    json: false,
    first: false,
    copy: false,
    limit: 14,
    typeKey: "",
    scopeKey: "",
    configKey: "",
    help: false
  };

  let index = 0;
  if (commands.has(argv[0])) {
    options.command = argv[0];
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    const valueAfter = flag => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      return value;
    };

    if (argument === "--") continue;
    if (argument === "--project" || argument === "-C") options.project = valueAfter(argument);
    else if (argument === "--query" || argument === "-q") options.query = valueAfter(argument);
    else if (argument === "--kind" || argument === "-k") options.kind = valueAfter(argument);
    else if (argument === "--scope" || argument === "-s") options.scope = valueAfter(argument);
    else if (argument === "--tool" || argument === "-t") options.tool = valueAfter(argument);
    else if (argument === "--host") options.host = valueAfter(argument);
    else if (argument === "--limit") options.limit = Number(valueAfter(argument));
    else if (argument === "--type-key") options.typeKey = valueAfter(argument);
    else if (argument === "--scope-key") options.scopeKey = valueAfter(argument);
    else if (argument === "--config-key") options.configKey = valueAfter(argument);
    else if (argument === "--json") options.json = true;
    else if (argument === "--first") options.first = true;
    else if (argument === "--copy") options.copy = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!["all", "skill", "agent", "plugin"].includes(options.kind)) throw new Error("--kind must be all, skill, agent, or plugin");
  if (!["all", "global", "project"].includes(options.scope)) throw new Error("--scope must be all, global, or project");
  if (!["codex", "claude", "name", "path"].includes(options.host)) throw new Error("--host must be codex, claude, name, or path");
  if (!Number.isInteger(options.limit) || options.limit < 3 || options.limit > 30) throw new Error("--limit must be between 3 and 30");
  if (options.command !== "config" && (options.typeKey || options.scopeKey || options.configKey)) throw new Error("--type-key, --scope-key, and --config-key are only valid with hangar config");
  options.project = resolve(options.project);
  return options;
}

function help() {
  return `${bold("Hangar")} — find the agents, skills, and plugins already installed on this machine

${bold("Usage")}
  hangar                               Open the terminal picker
  hangar -q pdf                        Open with a search
  hangar -q pdf --first                Print the best match without opening the UI
  hangar list                          Print a compact catalog
  hangar list --json                   Print machine-readable catalog data
  hangar doctor                        Show every directory being searched
  hangar config                        Show or change picker shortcuts

${bold("Filters")}
  -C, --project PATH                   Project whose capabilities should be included
  -q, --query TEXT                     Search names, descriptions, tools, and paths
  -k, --kind all|skill|agent|plugin    Limit capability type
  -s, --scope all|project|global       Limit installation scope
  -t, --tool NAME                      Limit source adapter (for example Cursor or Gemini CLI)
      --host codex|claude|name|path    Format the selected reference (default: codex)
      --copy                           Copy the selected reference to the clipboard

${bold("Picker keys")}
  type to search · ↑/↓ move · Tab changes type · Shift+Tab changes scope
  F2 opens settings by default · choose a shortcut and press Enter to change it
  Enter selects · Ctrl+U clears · Esc cancels

${bold("Shortcut settings")}
  hangar config --type-key ctrl+t
  hangar config --scope-key ctrl+s
  hangar config --config-key f3

The picker renders on stderr and prints only the selected reference on stdout,
so shell scripts can safely capture it: ref=$(hangar)
`;
}

async function configureShortcuts(options) {
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

function queryScore(capability, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const scopeScore = capability.scope === "project" ? 100 : 0;
    const kindScore = capability.kind === "skill" ? 2 : 0;
    const collectionScore = capability.collections.length ? 0 : 10;
    return scopeScore + kindScore + collectionScore;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const identity = capability.id.toLowerCase();
  const fuzzyTokenScore = token => {
    let cursor = -1;
    let score = 0;
    let previous = -2;
    for (const character of token) {
      cursor = identity.indexOf(character, cursor + 1);
      if (cursor < 0) return -1;
      score += cursor === previous + 1 ? 4 : 1;
      if (cursor === 0 || /[\s_-]/.test(identity[cursor - 1])) score += 3;
      previous = cursor;
    }
    return score;
  };

  const tokenScores = tokens.map(token => capability.searchText.includes(token) ? 12 : fuzzyTokenScore(token));
  if (tokenScores.some(score => score < 0)) return -1;

  let score = capability.scope === "project" ? 5 : 0;
  score += tokenScores.reduce((total, tokenScore) => total + tokenScore, 0);
  if (capability.id === normalized) score += 120;
  if (capability.id.startsWith(normalized)) score += 80;
  if (capability.name.toLowerCase().startsWith(normalized)) score += 60;
  if (capability.name.toLowerCase().includes(normalized)) score += 30;
  for (const token of tokens) {
    if (capability.id.startsWith(token)) score += 12;
    if (capability.description.toLowerCase().includes(token)) score += 3;
  }
  return score;
}

function matchingCapabilities(capabilities, options) {
  return capabilities
    .filter(item => options.kind === "all" || item.kind === options.kind)
    .filter(item => options.scope === "all" || item.scope === options.scope)
    .filter(item => !options.tool || item.tools.some(tool => tool.toLowerCase().includes(options.tool.toLowerCase())))
    .map(item => ({ item, score: queryScore(item, options.query) }))
    .filter(result => result.score >= 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .map(result => result.item);
}

function visibleLength(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function truncate(value, width) {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

function truncateFromStart(value, width) {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `…${value.slice(-(width - 1))}`;
}

function wrapText(value, width) {
  if (!value || width <= 0) return [];
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width));
      line = "";
    } else if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapPath(value, width) {
  if (!value || width <= 0) return [];
  const lines = [];
  let remaining = value;
  while (remaining.length > width) {
    let split = remaining.slice(0, width + 1).lastIndexOf("/");
    if (split < Math.floor(width * 0.4)) split = width;
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split);
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function labeledPathLines(value, width, label = "From ") {
  const pathLines = wrapPath(value, Math.max(1, width - label.length));
  return pathLines.map((line, index) => `${index ? " ".repeat(label.length) : dim(label)}${line}`);
}

function clippedWrap(value, width, limit) {
  if (limit <= 0) return [];
  const wrapped = wrapText(value, width);
  const lines = wrapped.slice(0, limit);
  if (wrapped.length > limit && lines.length) {
    const last = lines.length - 1;
    lines[last] = lines[last].length < width ? `${lines[last]}…` : `${lines[last].slice(0, Math.max(0, width - 1))}…`;
  }
  return lines;
}

function pad(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function badge(value, tone = "dim") {
  const label = `[${value.toUpperCase()}]`;
  if (tone === "cyan") return cyan(label);
  if (tone === "green") return green(label);
  if (tone === "yellow") return yellow(label);
  return dim(label);
}

function isProjectOverride(item) {
  return item.scope === "project" && item.sources.some(source => source.scope === "global");
}

function scopeBadge(item) {
  return item.scope === "project" ? badge("project", "green") : badge("global");
}

function pluginContents(item) {
  const skills = item.contents?.skills || 0;
  const agents = item.contents?.agents || 0;
  if (!skills && !agents) return "No bundled skills or agents";
  return `${skills} ${skills === 1 ? "skill" : "skills"} · ${agents} ${agents === 1 ? "agent" : "agents"}`;
}

function actionLabel(item) {
  if (item.kind !== "plugin") return "USE";
  return item.manifest ? "MANIFEST" : "PLUGIN LOCATION";
}

function filterCounts(capabilities, options) {
  const count = overrides => matchingCapabilities(capabilities, { ...options, ...overrides }).length;
  return {
    kinds: {
      all: count({ kind: "all" }),
      skill: count({ kind: "skill" }),
      agent: count({ kind: "agent" }),
      plugin: count({ kind: "plugin" })
    },
    scopes: {
      all: count({ scope: "all" }),
      project: count({ scope: "project" }),
      global: count({ scope: "global" })
    }
  };
}

function filterLine(label, entries, active, hint, width) {
  const rendered = entries.map(([value, title, count]) => {
    const text = `${title} ${count}`;
    return value === active ? cyan(bold(`[${text}]`)) : dim(text);
  }).join("  ");
  const prefix = `${bold(label.padEnd(6))}${rendered}`;
  return visibleLength(prefix) + hint.length + 3 <= width ? `${prefix}   ${dim(hint)}` : prefix;
}

function groupLabel(scope, count, width) {
  const text = scope === "project" ? `PROJECT · THIS PROJECT (${count})` : `GLOBAL · EVERY PROJECT (${count})`;
  const label = truncate(text, Math.max(1, width - 2));
  return scope === "project" ? green(bold(label)) : dim(bold(label));
}

function capabilityRow(item, selected, width, showScope = true) {
  const prefix = selected ? cyan(showScope ? "›" : "┃") : " ";
  const scope = showScope ? (item.scope === "project" ? "[PROJECT]" : "[GLOBAL]") : "";
  const scopeWidth = scope ? scope.length + 1 : 0;
  const kind = item.kind === "skill" ? "Skill" : item.kind === "agent" ? "Agent" : "Plugin";
  const override = isProjectOverride(item) ? " · Override" : "";
  const fixedWidth = 2 + scopeWidth + kind.length + override.length + 1;
  const nameWidth = Math.max(4, width - fixedWidth);
  const name = truncate(item.name, nameWidth);
  const gap = " ".repeat(Math.max(1, width - 2 - scopeWidth - name.length - kind.length - override.length));
  const styledScope = scope ? `${item.scope === "project" ? green(scope) : dim(scope)} ` : "";
  const styledName = selected ? cyan(bold(name)) : name;
  const styledKind = selected ? bold(kind) : dim(kind);
  const styledOverride = override ? yellow(override) : "";
  return `${prefix} ${styledScope}${styledName}${gap}${styledKind}${styledOverride}`;
}

function listPane(state, matches, width, height, showScope = true) {
  const lines = [];
  if (!matches.length) {
    lines.push("");
    lines.push(yellow("  No matching capabilities"));
    lines.push(dim(`  ${state.options.query ? "Backspace to broaden the search." : "Change Type or Scope to see more."}`));
    return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
  }

  const visibleItems = Math.max(1, Math.min(state.options.limit, height - 2));
  const maxOffset = Math.max(0, matches.length - visibleItems);
  state.offset = Math.max(0, Math.min(state.offset, maxOffset));
  if (state.selected < state.offset) state.offset = state.selected;
  if (state.selected >= state.offset + visibleItems) state.offset = state.selected - visibleItems + 1;
  state.pageSize = visibleItems;

  const counts = {
    project: matches.filter(item => item.scope === "project").length,
    global: matches.filter(item => item.scope === "global").length
  };
  let previousScope = "";
  for (const [index, item] of matches.slice(state.offset, state.offset + visibleItems).entries()) {
    if (item.scope !== previousScope) {
      lines.push(groupLabel(item.scope, counts[item.scope], width));
      previousScope = item.scope;
    }
    lines.push(capabilityRow(item, state.offset + index === state.selected, width, showScope));
  }

  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function sidebarOption(label, count, active, width) {
  const countText = String(count);
  const labelWidth = Math.max(1, width - countText.length - 3);
  const name = truncate(label, labelWidth);
  const gap = " ".repeat(Math.max(1, width - name.length - countText.length - 2));
  const marker = active ? cyan("┃") : " ";
  return `${marker} ${active ? bold(name) : dim(name)}${gap}${active ? cyan(countText) : dim(countText)}`;
}

function sidebarHeading(label, hint, width) {
  const heading = label.toUpperCase();
  if (!hint || heading.length + hint.length + 1 > width) return dim(bold(truncate(heading, width)));
  return `${dim(bold(heading))}${" ".repeat(width - heading.length - hint.length)}${dim(hint)}`;
}

function sidebarPane(state, counts, width, height) {
  const baseOptions = { ...state.options, tool: "" };
  const available = matchingCapabilities(state.catalog.capabilities, baseOptions);
  const toolNames = [...new Set(available.flatMap(item => item.tools))].sort();
  const collections = new Map();
  for (const item of available) {
    for (const collection of item.collections) {
      const current = collections.get(collection.id) || { ...collection, count: 0 };
      current.count += 1;
      collections.set(collection.id, current);
    }
  }
  const collectionRows = [...collections.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  const visibleCollections = collectionRows.slice(0, 4);
  const lines = [
    sidebarHeading("Library", shortcutLabel(state.shortcuts.type), width),
    sidebarOption("All", counts.kinds.all, state.options.kind === "all", width),
    sidebarOption("Skills", counts.kinds.skill, state.options.kind === "skill", width),
    sidebarOption("Agents", counts.kinds.agent, state.options.kind === "agent", width),
    sidebarOption("Plugins", counts.kinds.plugin, state.options.kind === "plugin", width),
    "",
    sidebarHeading("Scope", shortcutLabel(state.shortcuts.scope), width),
    sidebarOption("All", counts.scopes.all, state.options.scope === "all", width),
    sidebarOption("Project", counts.scopes.project, state.options.scope === "project", width),
    sidebarOption("Global", counts.scopes.global, state.options.scope === "global", width),
    "",
    ...(visibleCollections.length ? [
      sidebarHeading("Plugins", "", width),
      ...visibleCollections.map(collection => sidebarOption(collection.name, collection.count, false, width)),
      ...(collectionRows.length > visibleCollections.length ? [dim(truncate(`  +${collectionRows.length - visibleCollections.length} more`, width))] : []),
      ""
    ] : []),
    sidebarHeading("Available in", "", width),
    ...toolNames.map(tool => sidebarOption(tool, available.filter(item => item.tools.includes(tool)).length, Boolean(state.options.tool) && tool.toLowerCase().includes(state.options.tool.toLowerCase()), width)),
    "",
    sidebarHeading("Settings", shortcutLabel(state.shortcuts.config), width),
    state.showConfig ? `${cyan("┃")} ${bold(truncate("hangar config", Math.max(1, width - 2)))}` : dim(truncate("  hangar config", width))
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function settingsPane(state, width, height) {
  const activeSetting = shortcutSettings[state.settingsSelected];
  if (state.captureShortcut) {
    const captureSetting = shortcutSettings.find(setting => setting.id === state.captureShortcut);
    const message = state.settingsMessage ? clippedWrap(state.settingsMessage, width, 3).map(line => yellow(line)) : [];
    const lines = [
      dim("SETTINGS"),
      bold(truncate(`Change ${captureSetting.label}`, width)),
      dim(truncate(`Current: ${shortcutLabel(state.shortcuts[captureSetting.id])}`, width)),
      "",
      cyan(bold(truncate("Press the new shortcut now…", width))),
      dim("Esc cancels"),
      ...(message.length ? ["", ...message] : [])
    ];
    return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
  }

  const settingRows = shortcutSettings.map((setting, index) => {
    const keyLabel = shortcutLabel(state.shortcuts[setting.id]);
    const labelWidth = Math.max(1, width - keyLabel.length - 4);
    const label = truncate(setting.label, labelWidth);
    const gap = " ".repeat(Math.max(1, width - label.length - keyLabel.length - 2));
    const row = `${index === state.settingsSelected ? "›" : " "} ${label}${gap}${keyLabel}`;
    return index === state.settingsSelected ? cyan(bold(row)) : dim(row);
  });
  const message = state.settingsMessage
    ? clippedWrap(state.settingsMessage, width, 2).map(line => state.settingsError ? yellow(line) : green(line))
    : [];
  const configPathLines = wrapPath(shortcutConfigPath(), width);
  const lines = [
    dim("SETTINGS"),
    bold("Hangar shortcuts"),
    dim("↑↓ choose · Enter changes"),
    dim(`${shortcutLabel(state.shortcuts.config)} or Esc returns`),
    "",
    ...settingRows,
    ...(message.length ? ["", ...message] : []),
    "",
    dim("CLI ALTERNATIVE"),
    `hangar config --${activeSetting.id}-key KEY`,
    "",
    dim("CONFIG FILE"),
    ...configPathLines
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function libraryPane(state, matches, width, height) {
  const count = String(matches.length);
  const inputWidth = Math.max(1, width - count.length - 5);
  const input = state.options.query
    ? truncateFromStart(state.options.query, inputWidth)
    : dim(truncate("filter capabilities", inputWidth));
  const search = `${cyan("/")} ${input}${cyan("▌")}`;
  const lines = [
    `${pad(search, Math.max(1, width - count.length - 1))}${dim(count)}`,
    dim("─".repeat(width)),
    ...listPane(state, matches, width, Math.max(1, height - 2), false)
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function detailPane(item, options, width, height) {
  if (!item) {
    const lines = [dim("SELECTED"), "", dim("Choose a capability to inspect it.")];
    return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
  }

  const override = isProjectOverride(item);
  const isPlugin = item.kind === "plugin";
  const sourceLines = isPlugin ? [] : wrapPath(item.path, width);
  const referenceLines = isPlugin ? wrapPath(referenceFor(item, options.host), width) : [truncate(referenceFor(item, options.host), width)];
  const relationshipLines = item.kind === "plugin"
    ? ["", dim("BUNDLED CAPABILITIES"), pluginContents(item)]
    : item.collections.length
      ? ["", dim("PLUGIN"), ...clippedWrap(item.collections.map(collection => collection.name).join(" · "), width, 2)]
      : [];
  if (height < 18 + sourceLines.length + relationshipLines.length + referenceLines.length - 1) return previewPane(item, options, width, height);
  const fixedLines = 17 + sourceLines.length + relationshipLines.length + referenceLines.length - 1;
  const descriptionLines = clippedWrap(item.detail, width, Math.max(1, Math.min(5, height - fixedLines)));
  const scopeText = item.scope === "project" ? "Only this project" : "Every project";
  const status = [scopeBadge(item), badge(item.kind, "cyan")];
  if (override) status.push(badge("project override", "yellow"));
  const lines = [
    dim("SELECTED"),
    bold(truncate(item.name, width)),
    ...sourceLines.map(line => dim(line)),
    status.join(" "),
    "",
    dim("WHAT IT DOES"),
    ...descriptionLines,
    "",
    dim(actionLabel(item)),
    ...referenceLines.map(line => green(line)),
    "",
    dim("AVAILABLE IN"),
    truncate(item.tools.join(" · "), width),
    ...relationshipLines,
    "",
    dim("SCOPE"),
    scopeText,
    "",
    dim("SOURCE COPIES"),
    `${item.sourceCount} ${item.sourceCount === 1 ? "location" : "locations"} · ${item.variantCount} ${item.variantCount === 1 ? "variant" : "variants"}`
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function previewPane(item, options, width, height) {
  if (!item) {
    const lines = [dim("SELECTED"), "", dim("Choose a result to see how to use it.")];
    return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
  }

  const reference = referenceFor(item, options.host);
  const override = isProjectOverride(item);
  const isPlugin = item.kind === "plugin";
  const pathLines = isPlugin ? [] : wrapPath(item.path, width);
  const referenceLines = isPlugin ? wrapPath(reference, width) : [truncate(reference, width)];
  const relationshipLine = item.kind === "plugin"
    ? `${dim("BUNDLED  ")}${truncate(pluginContents(item), Math.max(1, width - 9))}`
    : item.collections.length
      ? `${dim("PLUGIN  ")}${truncate(item.collections.map(collection => collection.name).join(" + "), Math.max(1, width - 8))}`
      : "";
  if (height < 11 + pathLines.length + referenceLines.length - 1 + Boolean(relationshipLine)) {
    const status = `${item.scope === "project" ? "PROJECT" : "GLOBAL"} · ${item.kind.toUpperCase()}${override ? " · OVERRIDE" : ""}`;
    const actionLines = isPlugin
      ? [dim(actionLabel(item)), ...referenceLines.map(line => green(line))]
      : [`${dim("USE ")}${green(truncate(reference, Math.max(1, width - 4)))}`];
    const sourceLines = isPlugin ? [] : labeledPathLines(item.path, width);
    const descriptionLines = clippedWrap(item.detail, width, Math.max(0, height - 2 - actionLines.length - sourceLines.length - Boolean(relationshipLine)));
    const lines = [
      dim(truncate(`SELECTED · ${status}`, width)),
      bold(truncate(item.name, width)),
      ...descriptionLines,
      ...actionLines,
      ...(relationshipLine ? [relationshipLine] : []),
      ...sourceLines
    ];
    return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
  }

  const statusParts = [scopeBadge(item), badge(item.kind, "cyan")];
  if (override) statusParts.push(badge("project override", "yellow"));
  const fixedLineCount = 9 + pathLines.length + referenceLines.length + Boolean(relationshipLine) - Number(isPlugin);
  const descriptionLimit = Math.max(1, height - fixedLineCount);
  const descriptionLines = clippedWrap(item.detail, width, descriptionLimit);
  const lines = [
    dim("SELECTED"),
    bold(truncate(item.name, width)),
    statusParts.join(" "),
    "",
    dim("WHAT IT DOES"),
    ...descriptionLines,
    "",
    dim(actionLabel(item)),
    ...referenceLines.map(line => green(line)),
    `${dim("AVAILABLE IN  ")}${truncate(item.tools.join(" + "), Math.max(1, width - 14))}`,
    ...(relationshipLine ? [relationshipLine] : []),
    ...(!isPlugin ? [dim("SOURCE"), ...pathLines] : [])
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

function writeList(catalog, capabilities, options) {
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

function capabilityForOutput(capability) {
  const output = { ...capability };
  delete output.searchText;
  return output;
}

function copyToClipboard(value) {
  const candidates = process.platform === "darwin"
    ? [["pbcopy", []]]
    : process.platform === "win32"
      ? [["clip", []]]
      : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: value, encoding: "utf8" });
    if (!result.error && result.status === 0) return command;
  }
  throw new Error("No supported clipboard command was found; use the printed reference instead");
}

function renderPicker(state) {
  const width = Math.max(42, Math.min(process.stderr.columns || 100, 140));
  const height = Math.max(18, process.stderr.rows || 30);
  const rankedMatches = matchingCapabilities(state.catalog.capabilities, state.options);
  const matches = state.options.scope === "all"
    ? [...rankedMatches.filter(item => item.scope === "project"), ...rankedMatches.filter(item => item.scope === "global")]
    : rankedMatches;
  state.matches = matches;
  state.selected = Math.max(0, Math.min(state.selected, matches.length - 1));
  const counts = filterCounts(state.catalog.capabilities, state.options);
  const lines = [];
  const selectedItem = matches[state.selected];
  const typeKey = shortcutLabel(state.shortcuts.type);
  const scopeKey = shortcutLabel(state.shortcuts.scope);
  const configKey = shortcutLabel(state.shortcuts.config);

  if (width >= 118) {
    const total = state.catalog.capabilities.length;
    const projectCount = state.catalog.capabilities.filter(item => item.scope === "project").length;
    const summary = `${total} loaded · ${projectCount} project · ${total - projectCount} global`;
    const titleWidth = Math.max(1, width - summary.length - 1);
    const title = state.catalog.projectName.toLowerCase() === "hangar" ? "Hangar" : `Hangar  ${state.catalog.projectName}`;
    lines.push(`${pad(bold(truncate(title, titleWidth)), width - summary.length)}${dim(summary)}`);
    lines.push(dim(truncate(state.catalog.project, width)));
    lines.push(dim("─".repeat(width)));

    const bodyHeight = Math.max(4, height - 5);
    const leftWidth = Math.max(24, Math.floor(width * 0.22));
    const centerWidth = Math.max(46, Math.floor(width * 0.43));
    const rightWidth = width - leftWidth - centerWidth - 6;
    const sidebar = sidebarPane(state, counts, leftWidth, bodyHeight);
    const library = libraryPane(state, matches, centerWidth, bodyHeight);
    const details = state.showConfig ? settingsPane(state, rightWidth, bodyHeight) : detailPane(selectedItem, state.options, rightWidth, bodyHeight);
    for (let index = 0; index < bodyHeight; index += 1) {
      lines.push(`${pad(sidebar[index], leftWidth)}${dim(" │ ")}${pad(library[index], centerWidth)}${dim(" │ ")}${details[index]}`);
    }

    lines.push(dim("─".repeat(width)));
    const footer = state.captureShortcut
      ? "Press new shortcut · Esc cancels"
      : state.showConfig
        ? `↑↓ choose · Enter change · ${configKey}/Esc back`
      : `↑↓ move   Enter select   ${typeKey} type   ${scopeKey} scope   ${configKey} config   type to filter   Ctrl+U clear   Esc close`;
    lines.push(dim(truncate(footer, width)));
    process.stderr.write(`${ESC}H${ESC}2J${lines.slice(0, height).join("\n")}`);
    return;
  }

  const resultCount = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
  const titleWidth = Math.max(1, width - resultCount.length - 1);
  const title = state.catalog.projectName.toLowerCase() === "hangar" ? "Hangar" : `Hangar · ${state.catalog.projectName}`;
  lines.push(`${pad(bold(truncate(title, titleWidth)), width - resultCount.length)}${dim(resultCount)}`);
  lines.push(dim(truncate(state.catalog.project, width)));
  lines.push("");

  const searchWidth = Math.max(1, width - 10);
  const searchValue = state.options.query
    ? truncateFromStart(state.options.query, searchWidth - 1)
    : dim(truncate("Search by name, job, tool, or path…", searchWidth - 1));
  lines.push(`${bold("Search ›")} ${searchValue}${cyan("▌")}`);
  const kindEntries = width < 48
    ? [["all", "All", counts.kinds.all], ["skill", "Skl", counts.kinds.skill], ["agent", "Agt", counts.kinds.agent], ["plugin", "Plug", counts.kinds.plugin]]
    : [["all", "All", counts.kinds.all], ["skill", "Skills", counts.kinds.skill], ["agent", "Agents", counts.kinds.agent], ["plugin", "Plugins", counts.kinds.plugin]];
  lines.push(filterLine("TYPE", kindEntries, state.options.kind, shortcutLabel(state.shortcuts.type), width));
  lines.push(filterLine("SCOPE", [["all", "All", counts.scopes.all], ["project", "Project", counts.scopes.project], ["global", "Global", counts.scopes.global]], state.options.scope, shortcutLabel(state.shortcuts.scope), width));
  lines.push(dim("─".repeat(width)));

  const bodyHeight = Math.max(4, height - 9);
  if (width >= 92) {
    const leftWidth = Math.max(52, Math.floor(width * 0.58));
    const rightWidth = width - leftWidth - 3;
    const list = listPane(state, matches, leftWidth, bodyHeight);
    const preview = state.showConfig ? settingsPane(state, rightWidth, bodyHeight) : previewPane(selectedItem, state.options, rightWidth, bodyHeight);
    for (let index = 0; index < bodyHeight; index += 1) {
      lines.push(`${pad(list[index], leftWidth)}${dim(" │ ")}${preview[index]}`);
    }
  } else {
    const preferredPreviewHeight = Math.max(5, Math.min(state.showConfig ? 10 : 7, Math.floor(bodyHeight * 0.5)));
    const requiredPreviewHeight = state.showConfig ? 10 : selectedItem ? 3 + labeledPathLines(selectedItem.path, width).length : 5;
    const previewHeight = Math.min(Math.max(3, bodyHeight - 2), Math.max(preferredPreviewHeight, requiredPreviewHeight));
    const listHeight = Math.max(1, bodyHeight - previewHeight);
    lines.push(...listPane(state, matches, width, listHeight));
    lines.push(...(state.showConfig ? settingsPane(state, width, previewHeight) : previewPane(selectedItem, state.options, width, previewHeight)));
  }

  lines.push(dim("─".repeat(width)));
  const fullFooter = state.captureShortcut
    ? "Press the new shortcut · Esc cancels"
    : state.showConfig
      ? `↑↓ choose · Enter change · ${configKey} or Esc returns`
    : `↑↓ move   Enter choose   ${typeKey} type   ${scopeKey} scope   ${configKey} config   Ctrl+U clear   Esc close`;
  const footerOptions = state.captureShortcut
    ? [fullFooter, "Press shortcut · Esc cancel"]
    : state.showConfig
      ? [fullFooter, `↑↓ choose  ↵ change  ${configKey}/Esc back`]
    : [fullFooter, `↑↓ move  ↵ choose  ${typeKey} type  ${scopeKey} scope  ${configKey} cfg  Esc`, `${typeKey} type  ${scopeKey} scope  ${configKey} config`];
  const footer = footerOptions.find(value => value.length <= width) || footerOptions.at(-1);
  lines.push(dim(truncate(footer, width)));

  process.stderr.write(`${ESC}H${ESC}2J${lines.slice(0, height).join("\n")}`);
}

async function interactivePick(catalog, options, shortcuts) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("Interactive picking needs a terminal; add --first for non-interactive use");
  }

  const state = {
    catalog,
    options: { ...options },
    shortcuts,
    selected: 0,
    offset: 0,
    pageSize: options.limit,
    matches: [],
    showConfig: false,
    settingsSelected: 0,
    captureShortcut: "",
    settingsMessage: "",
    settingsError: false,
    savingShortcut: false
  };
  const wasRaw = process.stdin.isRaw;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stderr.write(`${ESC}?1049h${ESC}?25l`);
  renderPicker(state);

  return await new Promise((resolveSelection, reject) => {
    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stderr.off("resize", onResize);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stderr.write(`${ESC}?25h${ESC}?1049l`);
    };
    const finish = selection => {
      cleanup();
      resolveSelection(selection);
    };
    const fail = error => {
      cleanup();
      reject(error);
    };
    const onResize = () => renderPicker(state);
    const onKeypress = async (text, key = {}) => {
      try {
        if (key.ctrl && key.name === "c") return finish(null);
        if (state.savingShortcut) return;
        if (state.captureShortcut) {
          if (key.name === "escape") {
            state.captureShortcut = "";
            state.settingsMessage = "Shortcut change cancelled";
            state.settingsError = false;
            renderPicker(state);
            return;
          }

          let nextShortcuts;
          try {
            const shortcut = shortcutFromKey(text, key);
            nextShortcuts = validateShortcuts({ ...state.shortcuts, [state.captureShortcut]: shortcut });
          } catch (error) {
            state.settingsMessage = error.message;
            state.settingsError = true;
            renderPicker(state);
            return;
          }

          const changedSetting = shortcutSettings.find(setting => setting.id === state.captureShortcut);
          state.savingShortcut = true;
          await writeShortcuts(shortcutConfigPath(), nextShortcuts);
          state.shortcuts = nextShortcuts;
          state.captureShortcut = "";
          state.settingsMessage = `Saved ${changedSetting.label} as ${shortcutLabel(nextShortcuts[changedSetting.id])}`;
          state.settingsError = false;
          state.savingShortcut = false;
          renderPicker(state);
          return;
        }
        if (shortcutMatches(key, state.shortcuts.config)) {
          state.showConfig = !state.showConfig;
          state.settingsMessage = "";
          state.settingsError = false;
          renderPicker(state);
          return;
        }
        if (state.showConfig) {
          if (key.name === "escape") {
            state.showConfig = false;
            state.settingsMessage = "";
            state.settingsError = false;
          } else if (key.name === "up") {
            state.settingsSelected = (state.settingsSelected + shortcutSettings.length - 1) % shortcutSettings.length;
          } else if (key.name === "down") {
            state.settingsSelected = (state.settingsSelected + 1) % shortcutSettings.length;
          } else if (key.name === "return" || key.name === "enter") {
            state.captureShortcut = shortcutSettings[state.settingsSelected].id;
            state.settingsMessage = "";
            state.settingsError = false;
          }
          renderPicker(state);
          return;
        }
        if (key.name === "escape") return finish(null);
        if (key.name === "return" || key.name === "enter") return finish(state.matches[state.selected] || null);
        if (key.name === "up") state.selected = Math.max(0, state.selected - 1);
        else if (key.name === "down") state.selected = Math.min(Math.max(0, state.matches.length - 1), state.selected + 1);
        else if (key.name === "pageup") state.selected = Math.max(0, state.selected - state.pageSize);
        else if (key.name === "pagedown") state.selected = Math.min(Math.max(0, state.matches.length - 1), state.selected + state.pageSize);
        else if (shortcutMatches(key, state.shortcuts.type)) {
          const kinds = ["all", "skill", "agent", "plugin"];
          state.options.kind = kinds[(kinds.indexOf(state.options.kind) + 1) % kinds.length];
          state.selected = 0;
          state.offset = 0;
        } else if (shortcutMatches(key, state.shortcuts.scope)) {
          state.options.scope = state.options.scope === "all" ? "project" : state.options.scope === "project" ? "global" : "all";
          state.selected = 0;
          state.offset = 0;
        } else if (key.name === "backspace") {
          state.options.query = [...state.options.query].slice(0, -1).join("");
          state.selected = 0;
          state.offset = 0;
        } else if (key.ctrl && key.name === "u") {
          state.options.query = "";
          state.selected = 0;
          state.offset = 0;
        } else if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text)) {
          state.options.query += text;
          state.selected = 0;
          state.offset = 0;
        }
        renderPicker(state);
      } catch (error) {
        fail(error);
      }
    };

    process.stdin.on("keypress", onKeypress);
    process.stderr.on("resize", onResize);
  });
}

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
