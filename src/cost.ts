import type { CodexUsageEvent } from "./collector";
import {
  calculateCostUSD,
  getLongContextBillingScope,
  getLongContextInputThreshold,
  getModelPricing,
} from "./pricing";

type SessionModelUsageTotals = {
  modelId: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  hasLongContextPrompt: boolean;
};

export async function calculateUsageCostFromEvents(events: CodexUsageEvent[]): Promise<number> {
  // GPT-5.4 uses the long-context rate for its full session; newer models apply it per request.
  const sessionModelUsageTotals = new Map<string, SessionModelUsageTotals>();
  const policyByModel = new Map<string, { scope: "session" | "request"; threshold: number }>();

  for (const event of events) {
    let policy = policyByModel.get(event.model);
    if (!policy) {
      policy = {
        scope: getLongContextBillingScope(event.model),
        threshold: getLongContextInputThreshold(event.model),
      };
      policyByModel.set(event.model, policy);
    }
    const hasLongContextPrompt = usesLongContextPricing(event, policy.threshold);
    const sessionScoped = policy.scope === "session";
    const key = `${event.sessionKey}\u0000${event.model}\u0000${sessionScoped ? "session" : hasLongContextPrompt}`;
    const usage = getOrCreateSessionModelUsage(sessionModelUsageTotals, key, event.model);
    usage.inputTokens += event.inputTokens;
    usage.cachedInputTokens += event.cachedInputTokens;
    usage.cacheWriteTokens += event.cacheWriteTokens;
    usage.outputTokens += event.outputTokens;
    usage.reasoningTokens += event.reasoningOutputTokens;
    usage.totalTokens += getEventTotal(event);
    if (hasLongContextPrompt) {
      usage.hasLongContextPrompt = true;
    }
  }

  let totalCost = 0;

  for (const usage of sessionModelUsageTotals.values()) {
    if (
      usage.inputTokens === 0 &&
      usage.cachedInputTokens === 0 &&
      usage.cacheWriteTokens === 0 &&
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
        cacheWriteTokens: usage.cacheWriteTokens,
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
    cacheWriteTokens: 0,
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

function usesLongContextPricing(event: CodexUsageEvent, threshold: number): boolean {
  // `inputTokens` is populated from Codex's per-request `last_token_usage` when available,
  // so we intentionally key the threshold off that request-sized signal instead of a
  // session-cumulative total.
  return event.inputTokens > threshold;
}
