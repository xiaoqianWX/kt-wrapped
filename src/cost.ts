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
    const key = billingGroupKey(event, policy.scope, hasLongContextPrompt);
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

/**
 * Per-event cost for the dashboard, priced exactly like the card: events are grouped the
 * same way, so a session-scoped long-context rate applies to every event in that session.
 * null = no price for the model.
 */
export async function calculateEventCostsUSD(events: CodexUsageEvent[]): Promise<Array<number | null>> {
  const policyByModel = new Map<string, { scope: "session" | "request"; threshold: number }>();
  const keys: string[] = [];
  const longContextByKey = new Map<string, boolean>();

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
    const key = billingGroupKey(event, policy.scope, hasLongContextPrompt);
    keys.push(key);
    longContextByKey.set(key, (longContextByKey.get(key) ?? false) || hasLongContextPrompt);
  }

  const pricingCache = new Map<string, Awaited<ReturnType<typeof getModelPricing>>>();
  const costs: Array<number | null> = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const longContext = longContextByKey.get(keys[i]) ?? false;
    const cacheKey = `${event.model}\u0000${longContext}`;
    if (!pricingCache.has(cacheKey)) {
      pricingCache.set(cacheKey, await getModelPricing(event.model, { longContext }));
    }
    const pricing = pricingCache.get(cacheKey);
    if (!pricing) {
      costs.push(null);
      continue;
    }
    const cost = calculateCostUSD(
      {
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        outputTokens: event.outputTokens,
      },
      pricing
    );
    costs.push(Number.isFinite(cost) ? cost : 0);
  }
  return costs;
}

function billingGroupKey(event: CodexUsageEvent, scope: "session" | "request", hasLongContextPrompt: boolean): string {
  return `${event.sessionKey}\u0000${event.model}\u0000${scope === "session" ? "session" : hasLongContextPrompt}`;
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
