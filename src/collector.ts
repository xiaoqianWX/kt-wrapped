// Data collector - reads KohakuTerrarium session storage via a Python helper

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";
import collectorSource from "../scripts/collect_kt_usage.py" with { type: "text" };

const KT_SESSIONS_PATH = join(os.homedir(), ".kohakuterrarium", "sessions");
const COLLECTOR_SCRIPT = fileURLToPath(new URL("../scripts/collect_kt_usage.py", import.meta.url));

export interface CodexUsageEvent {
  sessionKey: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexUsageData {
  events: CodexUsageEvent[];
  dailyActivity: Map<string, number>;
  totalMessages: number;
  totalSessions: number;
  projects: Set<string>;
  earliestSessionDate: Date | null;
}

interface CollectorPayload {
  events: CodexUsageEvent[];
  dailyActivity: Record<string, number>;
  totalMessages: number;
  totalSessions: number;
  projects: string[];
  earliestSessionDate: string | null;
}

export async function checkKtDataExists(): Promise<boolean> {
  try {
    const info = await stat(KT_SESSIONS_PATH);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function collectKtUsageData(year: number): Promise<CodexUsageData> {
  const payload = await runCollectorScript(year);
  return {
    events: payload.events,
    dailyActivity: new Map(Object.entries(payload.dailyActivity ?? {})),
    totalMessages: payload.totalMessages ?? 0,
    totalSessions: payload.totalSessions ?? 0,
    projects: new Set(payload.projects ?? []),
    earliestSessionDate: payload.earliestSessionDate
      ? new Date(payload.earliestSessionDate)
      : null,
  };
}

async function runCollectorScript(year: number): Promise<CollectorPayload> {
  // Source checkouts run the script on disk; compiled binaries only have the embedded copy.
  if (await isFile(COLLECTOR_SCRIPT)) {
    return runCollectorScriptAt(COLLECTOR_SCRIPT, year);
  }

  const tempDir = await mkdtemp(join(os.tmpdir(), "kt-wrapped-"));
  try {
    const scriptPath = join(tempDir, "collect_kt_usage.py");
    await writeFile(scriptPath, collectorSource);
    return await runCollectorScriptAt(scriptPath, year);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function runCollectorScriptAt(scriptPath: string, year: number): Promise<CollectorPayload> {
  const pythonCandidates = Array.from(
    new Set(
      [process.env.PYTHON, process.env.PYTHON3, "python3", "python"].filter(
        (value): value is string => Boolean(value)
      )
    )
  );

  let lastError = "";

  for (const python of pythonCandidates) {
    try {
      const proc = Bun.spawn([python, scriptPath, "--year", String(year)], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        lastError = stderr.trim() || stdout.trim() || `${python} exited with ${exitCode}`;
        continue;
      }

      return JSON.parse(stdout) as CollectorPayload;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    lastError ||
      "Unable to run KT usage collector. Set PYTHON or KT_WRAPPED_KT_SRC if needed."
  );
}
