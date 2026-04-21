import type { CodexUsageEvent } from "./collector";
import { LONG_CONTEXT_INPUT_THRESHOLD, calculateCostUSD, getModelPricing } from "./pricing";

type SessionModelUsageTotals = {
  modelId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  hasLongContextPrompt: boolean;
};

export async function calculateUsageCostFromEvents(events: CodexUsageEvent[]): Promise<number> {
  // GPT-5.4 long-context pricing is session-scoped, so we can't price after collapsing everything to a model total.
  const sessionModelUsageTotals = new Map<string, SessionModelUsageTotals>();

  for (const event of events) {
    const key = `${event.sessionKey}\u0000${event.model}`;
    const usage = getOrCreateSessionModelUsage(sessionModelUsageTotals, key, event.model);
    usage.inputTokens += event.inputTokens;
    usage.cachedInputTokens += event.cachedInputTokens;
    usage.outputTokens += event.outputTokens;
    usage.reasoningTokens += event.reasoningOutputTokens;
    usage.totalTokens += getEventTotal(event);
    if (usesLongContextPricing(event)) {
      usage.hasLongContextPrompt = true;
    }
  }

  let totalCost = 0;

  for (const usage of sessionModelUsageTotals.values()) {
    if (
      usage.inputTokens === 0 &&
      usage.cachedInputTokens === 0 &&
      usage.outputTokens === 0 &&
      usage.reasoningTokens === 0
    ) {
      continue;
    }

    const pricing = await getModelPricing(usage.modelId, { longContext: usage.hasLongContextPrompt });
    if (!pricing) continue;

    const cost = calculateCostUSD(
      {
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
      },
      pricing
    );

    if (Number.isFinite(cost)) {
      totalCost += cost;
    }
  }

  return totalCost;
}

function getOrCreateSessionModelUsage(
  map: Map<string, SessionModelUsageTotals>,
  key: string,
  modelId: string
): SessionModelUsageTotals {
  const existing = map.get(key);
  if (existing) return existing;

  const fresh = {
    modelId,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    hasLongContextPrompt: false,
  };
  map.set(key, fresh);
  return fresh;
}

function getEventTotal(event: CodexUsageEvent): number {
  const computed = event.inputTokens + event.outputTokens;
  return Math.max(event.totalTokens, computed);
}

function usesLongContextPricing(event: CodexUsageEvent): boolean {
  // `inputTokens` is populated from Codex's per-request `last_token_usage` when available,
  // so we intentionally key the threshold off that request-sized signal instead of a
  // session-cumulative total.
  return event.inputTokens > LONG_CONTEXT_INPUT_THRESHOLD;
}
