#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  const code = typeof result.status === "number" ? result.status : 0;
  process.exit(code);
}

const localEntry = path.join(projectRoot, "src", "index.ts");
if (fs.existsSync(localEntry)) {
  run("bun", [localEntry, ...process.argv.slice(2)]);
}

const platformMap = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};
const archMap = {
  x64: "x64",
  arm64: "arm64",
};

let platform = platformMap[os.platform()];
if (!platform) {
  platform = os.platform();
}
let arch = archMap[os.arch()];
if (!arch) {
  arch = os.arch();
}

const base = "kt-wrapped-" + platform + "-" + arch;
const binary = platform === "windows" ? "kt-wrapped.exe" : "kt-wrapped";

function findBinary(startDir) {
  let current = startDir;
  for (;;) {
    const modules = path.join(current, "node_modules");
    if (fs.existsSync(modules)) {
      const entries = fs.readdirSync(modules);
      for (const entry of entries) {
        if (!entry.startsWith(base)) {
          continue;
        }
        const candidate = path.join(modules, entry, "bin", binary);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

const resolved = findBinary(__dirname);
if (!resolved) {
  console.error(
    'Unable to find a runnable kt-wrapped binary. For local development, run "bun src/index.ts".'
  );
  process.exit(1);
}

run(resolved, process.argv.slice(2));
