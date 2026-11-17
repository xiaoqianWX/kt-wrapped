// KohakuTerrarium adapter for the dashboard: turns ~/.kohakuterrarium/sessions into a DashboardPayload.

import { basename } from "node:path";
import { collectKtDashboardData, type KtDashboardData } from "../collector";
import { calculateEventCostsUSD } from "../cost";
import { colors } from "../image/design-tokens";
import { loadLogoDataUrl } from "../image/generator";
import { fetchModelsData, getModelDisplayName } from "../models";
import {
  toDayNumber,
  type DashboardPayload,
  type DashboardProject,
  type DashboardSession,
  type DashboardTheme,
  type PromptRow,
  type ToolRow,
  type UsageRow,
} from "./types";

export const DASHBOARD_PACKAGE = "kt-wrapped";

const THEME: DashboardTheme = {
  scheme: "light",
  background: colors.background,
  surface: colors.surface,
  surfaceHover: colors.surfaceHover,
  border: colors.surfaceBorder,
  text: colors.text.primary,
  textSecondary: colors.text.secondary,
  textMuted: colors.text.muted,
  accent: colors.accent.primary,
  heatmap: [
    colors.heatmap.empty,
    colors.heatmap.level1,
    colors.heatmap.level2,
    colors.heatmap.level3,
    colors.heatmap.level4,
    colors.heatmap.level5,
    colors.heatmap.level6,
    colors.heatmap.level7,
  ],
  // Icy blue first, then muted companions that stay readable on the paper-white surface.
  series: ["#4E92DA", "#6BC7A5", "#E7A86B", "#9C8BD9", "#E08A9A", "#B2C2D3"],
};

export interface DashboardOverrides {
  /** Pre-collected data (tests) instead of running the Python collector. */
  data?: KtDashboardData;
  /** Session directory passed to the collector. */
  sessionDir?: string;
  logo?: string;
}

export async function buildDashboardPayload(defaultYear: number, overrides: DashboardOverrides = {}): Promise<DashboardPayload> {
  const [data, logo] = await Promise.all([
    overrides.data ?? collectKtDashboardData(overrides.sessionDir),
    overrides.logo ?? loadLogoDataUrl(),
    fetchModelsData(),
  ]);

  // Sessions with something to show, oldest first.
  const active = new Set<string>();
  for (const event of data.events) active.add(event.sessionKey);
  for (const prompt of data.prompts) active.add(prompt.sessionKey);

  const firstPrompt = new Map<string, { ts: number; text: string }>();
  for (const prompt of data.prompts) {
    const ts = Date.parse(prompt.timestamp);
    const text = prompt.text.trim();
    if (!text || !Number.isFinite(ts)) continue;
    const current = firstPrompt.get(prompt.sessionKey);
    if (!current || ts < current.ts) firstPrompt.set(prompt.sessionKey, { ts, text });
  }

  const sessionIndex = new Map<string, number>();
  const projectIndex = new Map<string, number>();
  const projects: DashboardProject[] = [];
  const sessions: DashboardSession[] = [];
  // A session id can appear in more than one file (copies, forks): merge their spans.
  const merged = new Map<string, { key: string; project: string; title: string | null; startMs: number; endMs: number }>();
  for (const s of data.sessions) {
    const startMs = Date.parse(s.start);
    const endMs = Date.parse(s.end);
    if (!active.has(s.key) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const current = merged.get(s.key);
    if (!current) {
      merged.set(s.key, { key: s.key, project: s.project, title: s.title, startMs, endMs });
      continue;
    }
    current.startMs = Math.min(current.startMs, startMs);
    current.endMs = Math.max(current.endMs, endMs);
    current.project ||= s.project;
    current.title ||= s.title;
  }
  const metas = [...merged.values()].sort((a, b) => a.startMs - b.startMs);

  for (const meta of metas) {
    let project = -1;
    const path = meta.project.replace(/[\\/]+$/, "");
    if (path) {
      project = projectIndex.get(path) ?? -1;
      if (project < 0) {
        project = projects.length;
        projectIndex.set(path, project);
        projects.push({ path, name: basename(path) || path });
      }
    }
    sessionIndex.set(meta.key, sessions.length);
    const prompt = firstPrompt.get(meta.key);
    sessions.push({
      id: meta.key,
      title: meta.title?.trim() || (prompt ? shortTitle(prompt.text) : null),
      project,
      start: meta.startMs,
      end: meta.endMs,
      branch: null,
    });
  }
  disambiguateProjectNames(projects);

  const costs = await calculateEventCostsUSD(data.events);
  const modelIndex = new Map<string, number>();
  const modelIds: string[] = [];
  const modelPriced: boolean[] = [];
  const usageRows = new Map<string, UsageRow>();
  let hasCacheWrite = false;
  let hasReasoning = false;

  data.events.forEach((event, i) => {
    const s = sessionIndex.get(event.sessionKey);
    const date = new Date(event.timestamp);
    if (s === undefined || Number.isNaN(date.getTime())) return;

    let m = modelIndex.get(event.model);
    if (m === undefined) {
      m = modelIds.length;
      modelIndex.set(event.model, m);
      modelIds.push(event.model);
      modelPriced.push(false);
    }
    if (costs[i] !== null) modelPriced[m] = true;

    // KT reports prompt_tokens including cache reads/writes (OpenAI style); the dashboard
    // wants them split, clamped the same way the card's cost calculation does.
    const cacheRead = Math.min(event.cachedInputTokens, event.inputTokens);
    const cacheWrite = Math.min(Math.max(event.cacheWriteTokens, 0), Math.max(event.inputTokens - cacheRead, 0));
    const input = event.inputTokens - cacheRead - cacheWrite;
    if (cacheWrite > 0) hasCacheWrite = true;
    if (event.reasoningOutputTokens > 0) hasReasoning = true;

    const day = toDayNumber(date);
    const hour = date.getHours();
    const key = `${s}|${day}|${hour}|${m}`;
    const row = usageRows.get(key) ?? ([s, day, hour, m, 0, 0, 0, 0, 0, 0, 0] as UsageRow);
    row[4] += 1;
    row[5] += input;
    row[6] += event.outputTokens;
    row[7] += cacheRead;
    row[8] += cacheWrite;
    row[9] += event.reasoningOutputTokens;
    row[10] += costs[i] ?? 0;
    usageRows.set(key, row);
  });

  const promptRows = new Map<string, PromptRow>();
  for (const prompt of data.prompts) {
    const s = sessionIndex.get(prompt.sessionKey);
    const date = new Date(prompt.timestamp);
    if (s === undefined || Number.isNaN(date.getTime())) continue;
    const day = toDayNumber(date);
    const hour = date.getHours();
    const key = `${s}|${day}|${hour}`;
    const row = promptRows.get(key) ?? ([s, day, hour, 0] as PromptRow);
    row[3] += 1;
    promptRows.set(key, row);
  }

  const toolIndex = new Map<string, number>();
  const tools: string[] = [];
  const toolRows = new Map<string, ToolRow>();
  for (const call of data.toolCalls) {
    const s = sessionIndex.get(call.sessionKey);
    const date = new Date(call.timestamp);
    if (s === undefined || Number.isNaN(date.getTime())) continue;
    let t = toolIndex.get(call.name);
    if (t === undefined) {
      t = tools.length;
      toolIndex.set(call.name, t);
      tools.push(call.name);
    }
    const day = toDayNumber(date);
    const key = `${s}|${day}|${t}`;
    const row = toolRows.get(key) ?? ([s, day, t, 0] as ToolRow);
    row[3] += 1;
    toolRows.set(key, row);
  }

  return {
    version: 1,
    product: {
      name: "KohakuTerrarium",
      url: "kt-wrapped • kohakuterrarium",
      logo,
      command: "npx kt-wrapped",
    },
    theme: THEME,
    generatedAt: Date.now(),
    defaultYear,
    costNote: "Estimated from kt-wrapped's local API price table",
    hasCacheWrite,
    hasReasoning,
    models: modelIds.map((id, i) => ({ id, name: getModelDisplayName(id), priced: modelPriced[i] })),
    projects,
    sessions,
    tools,
    usage: [...usageRows.values()].map(roundCost),
    prompts: [...promptRows.values()],
    toolCalls: [...toolRows.values()],
  };
}

export function shortTitle(text: string): string {
  const oneLine = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
}

function disambiguateProjectNames(projects: DashboardProject[]) {
  const byName = new Map<string, DashboardProject[]>();
  for (const project of projects) byName.set(project.name, [...(byName.get(project.name) ?? []), project]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const project of group) {
      const parts = project.path.split(/[\\/]/).filter(Boolean);
      project.name = parts.slice(-2).join("/") || project.path;
    }
  }
}

function roundCost(row: UsageRow): UsageRow {
  row[10] = Math.round(row[10] * 1e6) / 1e6;
  return row;
}
