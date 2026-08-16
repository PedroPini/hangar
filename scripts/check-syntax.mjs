#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = globSync(["*.mjs", "src/*.mjs"]).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
process.stdout.write(`Checked ${files.length} modules\n`);
