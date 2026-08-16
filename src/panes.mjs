import { referenceFor } from "../catalog.mjs";
import { bold, cyan, dim, green, yellow } from "./ansi.mjs";
import { matchingCapabilities } from "./search.mjs";
import { shortcutConfigPath, shortcutLabel, shortcutSettings } from "./shortcuts.mjs";
import { badge, clippedWrap, labeledPathLines, pad, truncate, truncateFromStart, visibleLength, wrapPath } from "./text.mjs";

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

export function filterLine(label, entries, active, hint, width) {
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

export function listPane(state, matches, width, height, showScope = true) {
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

export function sidebarPane(state, counts, width, height) {
  const baseOptions = { ...state.options, tool: "" };
  const available = matchingCapabilities(state.catalog.capabilities, baseOptions);
  const toolCounts = new Map();
  const collections = new Map();
  for (const item of available) {
    for (const tool of item.tools) toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    for (const collection of item.collections) {
      const current = collections.get(collection.id) || { ...collection, count: 0 };
      current.count += 1;
      collections.set(collection.id, current);
    }
  }
  const toolNames = [...toolCounts.keys()].sort();
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
    ...toolNames.map(tool => sidebarOption(tool, toolCounts.get(tool), Boolean(state.options.tool) && tool.toLowerCase().includes(state.options.tool.toLowerCase()), width)),
    "",
    sidebarHeading("Settings", shortcutLabel(state.shortcuts.config), width),
    state.showConfig ? `${cyan("┃")} ${bold(truncate("hangar config", Math.max(1, width - 2)))}` : dim(truncate("  hangar config", width))
  ];
  return [...lines, ...Array(Math.max(0, height - lines.length)).fill("")].slice(0, height);
}

export function settingsPane(state, width, height) {
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

export function libraryPane(state, matches, width, height) {
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

export function detailPane(item, options, width, height) {
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

export function previewPane(item, options, width, height) {
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
