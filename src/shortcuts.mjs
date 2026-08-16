import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const defaultShortcuts = Object.freeze({ type: "tab", scope: "shift+tab", config: "f2" });
export const shortcutSettings = Object.freeze([
  { id: "type", label: "Type filter" },
  { id: "scope", label: "Scope filter" },
  { id: "config", label: "Open settings" }
]);

export function shortcutConfigPath() {
  if (process.env.HANGAR_CONFIG) return resolve(process.env.HANGAR_CONFIG);
  const configHome = process.env.XDG_CONFIG_HOME ? resolve(process.env.XDG_CONFIG_HOME) : join(homedir(), ".config");
  return join(configHome, "hangar", "config.json");
}

export function normalizeShortcut(value) {
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

export function shortcutLabel(value) {
  const labels = new Map([["ctrl", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"], ["tab", "Tab"], ["escape", "Esc"], ["enter", "Enter"]]);
  return value.split("+").map(part => labels.get(part) || part.toUpperCase()).join("+");
}

export function shortcutMatches(key, value) {
  const parts = value.split("+");
  const name = parts.at(-1);
  return key.name === name
    && Boolean(key.ctrl) === parts.includes("ctrl")
    && Boolean(key.meta) === parts.includes("alt")
    && Boolean(key.shift) === parts.includes("shift");
}

export function shortcutFromKey(text, key) {
  const name = key.name || String(text || "").toLowerCase();
  const modifiers = [key.ctrl && "ctrl", key.meta && "alt", key.shift && "shift"].filter(Boolean);
  return normalizeShortcut([...modifiers, name].join("+"));
}

export function validateShortcuts(shortcuts) {
  const normalized = {
    type: normalizeShortcut(shortcuts.type),
    scope: normalizeShortcut(shortcuts.scope),
    config: normalizeShortcut(shortcuts.config)
  };
  if (new Set(Object.values(normalized)).size !== Object.keys(normalized).length) throw new Error("Picker shortcuts must be different");
  return normalized;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The only place a config file is turned into an object. Anything that would not survive
// a round trip through JSON.stringify is rejected here rather than silently discarded.
function parseConfig(text, path) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${path}`);
  }
  if (!isPlainObject(config)) throw new Error(`${path} must contain a JSON object`);
  if (config.shortcuts !== undefined && !isPlainObject(config.shortcuts)) {
    throw new Error(`"shortcuts" in ${path} must be a JSON object`);
  }
  return config;
}

async function readConfig(path) {
  try {
    return parseConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readShortcuts(path = shortcutConfigPath()) {
  const config = await readConfig(path);
  if (!config) return { ...defaultShortcuts };
  return validateShortcuts({ ...defaultShortcuts, ...config.shortcuts });
}

export async function writeShortcuts(path, shortcuts) {
  const config = await readConfig(path) || {};
  config.shortcuts = shortcuts;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
