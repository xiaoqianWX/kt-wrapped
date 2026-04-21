// Data collector - reads KohakuTerrarium session storage via a Python helper

import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";

const KT_SESSIONS_PATH = join(os.homedir(), ".kohakuterrarium", "sessions");
const COLLECTOR_SCRIPT = fileURLToPath(new URL("../scripts/collect_kt_usage.py", import.meta.url));

export interface CodexUsageEvent {
  sessionKey: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
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
      const proc = Bun.spawn([python, COLLECTOR_SCRIPT, "--year", String(year)], {
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
