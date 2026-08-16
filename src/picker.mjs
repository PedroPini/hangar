import { ESC, bold, cyan, dim } from "./ansi.mjs";
import { detailPane, filterLine, libraryPane, listPane, previewPane, settingsPane, sidebarPane } from "./panes.mjs";
import { filterCounts, matchingCapabilities } from "./search.mjs";
import { shortcutLabel } from "./shortcuts.mjs";
import { labeledPathLines, pad, truncate, truncateFromStart } from "./text.mjs";

export function renderPicker(state) {
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
