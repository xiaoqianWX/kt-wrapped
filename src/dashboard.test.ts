import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { collectKtDashboardData, type CodexUsageEvent, type KtDashboardData } from "./collector";
import { calculateEventCostsUSD, calculateUsageCostFromEvents } from "./cost";
import { buildDashboardPayload } from "./web/adapter";
import { renderDashboardHtml } from "./web/render";
import { toDayNumber } from "./web/types";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const T0 = new Date(2026, 9, 27, 23, 30).getTime(); // local time, late evening
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();
const LOGO = "data:image/svg+xml;base64,AA==";

function usageEvent(overrides: Partial<CodexUsageEvent>): CodexUsageEvent {
  return {
    sessionKey: "s1",
    timestamp: iso(1),
    model: "gpt-5.4",
    inputTokens: 1000,
    cachedInputTokens: 600,
    cacheWriteTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    totalTokens: 1050,
    ...overrides,
  };
}

describe("dashboard adapter", () => {
  test("splits cached input, keeps local days, falls back to the first prompt", async () => {
    const data: KtDashboardData = {
      sessions: [
        { key: "s1", project: "/work/repo/", start: iso(0), end: iso(10), title: null },
        // Same session id in a second file: spans merge.
        { key: "s1", project: "/work/repo/", start: iso(5), end: iso(45), title: null },
        { key: "idle", project: "/work/idle", start: iso(0), end: iso(0), title: null },
      ],
      events: [
        usageEvent({}),
        usageEvent({ timestamp: iso(41), model: "mystery-model", inputTokens: 2000, cachedInputTokens: 0, outputTokens: 20, totalTokens: 2020 }),
        usageEvent({ sessionKey: "unknown-session" }),
      ],
      prompts: [
        { sessionKey: "s1", timestamp: iso(40), text: "and add tests" },
        { sessionKey: "s1", timestamp: iso(0), text: "please   fix\nthe parser" },
      ],
      toolCalls: [
        { sessionKey: "s1", timestamp: iso(2), name: "read" },
        { sessionKey: "s1", timestamp: iso(3), name: "read" },
        { sessionKey: "s1", timestamp: iso(42), name: "bash" },
      ],
    };

    const payload = await buildDashboardPayload(2026, { data, logo: LOGO });

    expect(payload.sessions).toHaveLength(1); // "idle" has no usage or prompts
    expect(payload.sessions[0]).toMatchObject({ id: "s1", title: "please fix the parser", project: 0, start: T0, end: T0 + 45 * 60_000 });
    expect(payload.projects).toEqual([{ path: "/work/repo", name: "repo" }]);

    const gpt = payload.models.findIndex((m) => m.id === "gpt-5.4");
    const mystery = payload.models.findIndex((m) => m.id === "mystery-model");
    expect(payload.models[gpt].priced).toBe(true);
    expect(payload.models[mystery].priced).toBe(false);

    const day0 = toDayNumber(new Date(T0));
    const gptRow = payload.usage.find((r) => r[3] === gpt)!;
    expect(gptRow.slice(1, 10)).toEqual([day0, 23, gpt, 1, 400, 50, 600, 0, 0]);
    expect(gptRow[10]).toBeCloseTo((400 * 2.5 + 600 * 0.25 + 50 * 15) / 1e6, 9);
    const mysteryRow = payload.usage.find((r) => r[3] === mystery)!;
    expect(mysteryRow[1]).toBe(day0 + 1);
    expect(mysteryRow[10]).toBe(0);
    expect(payload.usage.reduce((s, r) => s + r[4], 0)).toBe(2); // unknown session dropped

    expect(payload.prompts.map((r) => [r[1], r[2], r[3]]).sort()).toEqual([[day0, 23, 1], [day0 + 1, 0, 1]]);
    expect(payload.tools).toEqual(["read", "bash"]);
    expect(payload.toolCalls.reduce((s, r) => s + r[3], 0)).toBe(3);
    expect(payload.hasCacheWrite).toBe(false);
    expect(payload.hasReasoning).toBe(false);
  });

  test("per-event costs add up to the card's cost, including session-scoped long context", async () => {
    const events = [
      usageEvent({ sessionKey: "a", inputTokens: 300_000, cachedInputTokens: 100_000, outputTokens: 1000, totalTokens: 301_000 }),
      usageEvent({ sessionKey: "a", timestamp: iso(5) }),
      usageEvent({ sessionKey: "b", timestamp: iso(6) }),
      usageEvent({ sessionKey: "b", timestamp: iso(7), model: "gpt-5.5", inputTokens: 400_000, cachedInputTokens: 0, outputTokens: 10, totalTokens: 400_010 }),
      usageEvent({ sessionKey: "b", timestamp: iso(8), model: "mystery-model" }),
    ];
    const costs = await calculateEventCostsUSD(events);
    expect(costs[4]).toBeNull();
    // Session "a" crossed the gpt-5.4 threshold, so its small second request is billed at the long-context rate too.
    expect(costs[1]).toBeCloseTo((400 * 5 + 600 * 0.5 + 50 * 22.5) / 1e6, 9);
    expect(costs[2]).toBeCloseTo((400 * 2.5 + 600 * 0.25 + 50 * 15) / 1e6, 9);
    const total = costs.reduce<number>((s, c) => s + (c ?? 0), 0);
    expect(total).toBeCloseTo(await calculateUsageCostFromEvents(events), 9);
  });
});

// Build real session stores with KohakuTerrarium's SessionStore when it is importable.
const FIXTURE_SCRIPT = `
import os, shutil, sys
from pathlib import Path
for c in [os.environ.get("KT_WRAPPED_KT_SRC"), str(Path.home() / "Downloads" / "KohakuTerrarium" / "src")]:
    if c and Path(c).expanduser().exists():
        sys.path.insert(0, str(Path(c).expanduser()))
try:
    from kohakuterrarium.session.store import SessionStore
except ImportError:
    sys.exit(3)
if len(sys.argv) < 3:
    sys.exit(0)
out = Path(sys.argv[1]); t0 = float(sys.argv[2])
s = SessionStore(out / "general_aaaa1111.kohakutr")
s.init_meta("general_aaaa1111", "agent", "cfg.yaml", "/work/repo/", ["swe"])
s.append_event("swe", "activity:session_info", {"model": "gpt-5.4", "llm_name": "", "ts": t0})
s.append_event("swe", "user_input", {"content": "please fix the parser", "ts": t0 + 1})
s.append_event("swe", "trigger_fired", {"ts": t0 + 2})
s.append_event("swe", "token_usage", {"prompt_tokens": 1000, "cached_tokens": 600, "completion_tokens": 50, "total_tokens": 1050, "ts": t0 + 3})
s.append_event("swe", "tool_call", {"name": "read[2a1220]", "call_id": "call_1", "args": {}, "ts": t0 + 4})
s.append_event("swe", "user_input", {"content": [{"type": "image_url", "image_url": {"url": "data:"}}], "ts": t0 + 2400})
s.append_event("swe", "token_usage", {"prompt_tokens": 2000, "cached_tokens": 0, "completion_tokens": 20, "total_tokens": 2020, "ts": t0 + 2401})
s.close(update_status=False)
# A copied store repeats every event; the dashboard must count them once.
shutil.copy(out / "general_aaaa1111.kohakutr", out / "general_aaaa1111-copy.kohakutr")
s = SessionStore(out / "swe_bbbb2222.kohakutr")
s.init_meta("swe_bbbb2222", "agent", "cfg.yaml", "/other/repo", ["swe"])
s.append_event("swe", "plugin_hook_timing", {"ts": t0})
s.close(update_status=False)
`;
const PYTHON = process.env.PYTHON || process.env.PYTHON3 || "python3";

function kohakuAvailable(): boolean {
  try {
    const proc = Bun.spawnSync([PYTHON, "-c", FIXTURE_SCRIPT], { stdout: "ignore", stderr: "ignore" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

describe("dashboard collector (KohakuTerrarium session stores)", () => {
  test.skipIf(!kohakuAvailable())("reads prompts, usage and tool calls once each", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "kt-dash-"));
    dirs.push(dir);
    const script = join(dir, "fixture.py");
    await writeFile(script, FIXTURE_SCRIPT);
    const sessionDir = join(dir, "sessions");
    await mkdir(sessionDir);
    const proc = Bun.spawn([PYTHON, script, sessionDir, String(T0 / 1000)], { stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);

    const data = await collectKtDashboardData(sessionDir);
    expect(data.events.map((e) => [e.model, e.inputTokens, e.cachedInputTokens])).toEqual([
      ["gpt-5.4", 1000, 600],
      ["gpt-5.4", 2000, 0],
    ]);
    // trigger_fired is not a prompt; an image-only prompt still counts.
    expect(data.prompts.map((p) => p.text)).toEqual(["please fix the parser", "[image]"]);
    expect(data.toolCalls).toEqual([{ sessionKey: "general_aaaa1111", timestamp: expect.any(String), name: "read" }]);

    const payload = await buildDashboardPayload(2026, { data, logo: LOGO });
    expect(payload.sessions.map((s) => [s.id, s.title])).toEqual([["general_aaaa1111", "please fix the parser"]]);
    const day0 = toDayNumber(new Date(T0));
    expect(payload.prompts.map((r) => r[1]).sort()).toEqual([day0, day0 + 1]);
  });
});

describe("dashboard render", () => {
  test("inlines data safely and fills every placeholder", async () => {
    const data: KtDashboardData = {
      sessions: [{ key: "s1", project: "/w", start: iso(0), end: iso(1), title: "</script><script>alert(1)</script> $& $1" }],
      events: [usageEvent({})],
      prompts: [],
      toolCalls: [],
    };
    const payload = await buildDashboardPayload(2026, { data, logo: LOGO });
    const html = renderDashboardHtml(payload, [{ weight: 400, data: new Uint8Array([1, 2, 3]).buffer }]);

    for (const token of ["__DATA__", "/*__THEME__*/", "/*__FONTS__*/", "__TITLE__"]) expect(html).not.toContain(token);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain("--hm-7:");
    expect(html).toContain("font/ttf;base64,AQID");
    const start = html.indexOf('type="application/json">') + 24;
    const json = html.slice(start, html.indexOf("</script>", start));
    expect(JSON.parse(json).sessions[0].title).toBe("</script><script>alert(1)</script> $& $1");
  });
});
