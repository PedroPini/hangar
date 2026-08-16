import { emitKeypressEvents } from "node:readline";
import { ESC } from "./ansi.mjs";
import { renderPicker } from "./picker.mjs";
import { shortcutConfigPath, shortcutFromKey, shortcutLabel, shortcutMatches, shortcutSettings, validateShortcuts, writeShortcuts } from "./shortcuts.mjs";

export async function interactivePick(catalog, options, shortcuts) {
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
    const onResize = () => {
      try {
        renderPicker(state);
      } catch (error) {
        fail(error);
      }
    };
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
