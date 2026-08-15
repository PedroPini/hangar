#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const promptFile = process.argv.slice(2).reverse().find(argument => !argument.startsWith("+") && existsSync(argument));
if (!promptFile) {
  process.stderr.write("Hangar editor: Codex did not provide a prompt file.\n");
  process.exitCode = 1;
} else {
  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  const args = [cli, "--project", process.env.HANGAR_PROJECT || process.cwd(), "--host", process.env.HANGAR_HOST || "codex"];
  const query = process.env.HANGAR_QUERY;
  if (query) args.push("--query", query);
  if (process.env.HANGAR_FIRST === "1") args.push("--first");

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"]
  });

  if (result.status === 0) {
    const reference = result.stdout.trim();
    if (reference) {
      const prompt = readFileSync(promptFile, "utf8");
      const separator = !prompt || /\s$/.test(prompt) ? "" : " ";
      writeFileSync(promptFile, `${prompt}${separator}${reference}`, "utf8");
    }
  } else if (result.status !== 130) {
    process.exitCode = result.status || 1;
  }
}
