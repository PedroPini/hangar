import { resolve } from "node:path";
import { bold } from "./ansi.mjs";

export function parseArguments(argv) {
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

export function help() {
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
