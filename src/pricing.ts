import {
  LOCAL_MODEL_PRICING,
  type LocalModelPricing,
  type LocalModelPricingDetails,
} from "./pricing-data";

export interface ModelPricing {
  inputCostPerMToken: number;
  cachedInputCostPerMToken: number;
  cacheWriteCostPerMToken?: number;
  outputCostPerMToken: number;
}

export interface ModelPricingOptions {
  longContext?: boolean;
}

export interface TokenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
}

const MILLION = 1_000_000;
export const LONG_CONTEXT_INPUT_THRESHOLD = 272_000;

const PROVIDER_PREFIXES = [
  "openai/",
  "azure/",
  "openrouter/openai/",
  "anthropic/",
  "openrouter/anthropic/",
];
const MODEL_ALIASES = new Map<string, string>([
  ["gpt-5-codex", "gpt-5"],
  ["gpt-5.6", "gpt-5.6-sol"],
  // The Daybreak Blue alias currently points to GPT-5.6 Sol.
  ["gpt-daybreak-blue-latest", "gpt-5.6-sol"],
]);

const LOCAL_PRICING_MAP = new Map<string, LocalModelPricing>(Object.entries(LOCAL_MODEL_PRICING));

export async function getModelPricing(model: string, options: ModelPricingOptions = {}): Promise<ModelPricing | null> {
  const record = findLocalPricing(model);
  return record ? normalizePricing(record, options) : null;
}

export function getLongContextBillingScope(model: string): "session" | "request" {
  return findLocalPricing(model)?.longContextBillingScope ?? "request";
}

export function getLongContextInputThreshold(model: string): number {
  return findLocalPricing(model)?.longContextInputThreshold ?? LONG_CONTEXT_INPUT_THRESHOLD;
}

export function calculateCostUSD(usage: TokenUsageTotals, pricing: ModelPricing): number {
  const cachedInput = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const remainingInput = Math.max(usage.inputTokens - cachedInput, 0);
  // Cache writes are unbilled unless the model has a cache-write rate (Claude).
  const cacheWrite = Math.min(Math.max(usage.cacheWriteTokens ?? 0, 0), remainingInput);
  const nonCachedInput = remainingInput - cacheWrite;

  const inputCost = (nonCachedInput / MILLION) * pricing.inputCostPerMToken;
  const cachedCost = (cachedInput / MILLION) * pricing.cachedInputCostPerMToken;
  const cacheWriteCost = (cacheWrite / MILLION) * (pricing.cacheWriteCostPerMToken ?? 0);
  const outputCost = (usage.outputTokens / MILLION) * pricing.outputCostPerMToken;

  return inputCost + cachedCost + cacheWriteCost + outputCost;
}

function findLocalPricing(model: string): LocalModelPricing | undefined {
  for (const candidate of createCandidates(model)) {
    const record = LOCAL_PRICING_MAP.get(candidate);
    if (record) return record;
  }
  return undefined;
}

function createCandidates(model: string): string[] {
  const candidates = new Set<string>();
  const normalizedModel = stripProviderPrefix(model);
  const snapshotBaseModel = stripSnapshotSuffix(normalizedModel);
  // OpenRouter spells Claude versions with dots (claude-opus-4.8); Anthropic uses dashes.
  const dashedClaudeModel = snapshotBaseModel.startsWith("claude-")
    ? snapshotBaseModel.replace(/\./g, "-")
    : snapshotBaseModel;
  const modelVariants = new Set([model, normalizedModel, snapshotBaseModel, dashedClaudeModel]);

  for (const variant of modelVariants) {
    if (!variant) continue;
    candidates.add(variant);

    const alias = MODEL_ALIASES.get(variant);
    if (alias) {
      candidates.add(alias);
    }

    for (const prefix of PROVIDER_PREFIXES) {
      candidates.add(`${prefix}${variant}`);
      if (alias) {
        candidates.add(`${prefix}${alias}`);
      }
    }
  }

  return Array.from(candidates);
}

function stripProviderPrefix(model: string): string {
  for (const prefix of PROVIDER_PREFIXES) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

function stripSnapshotSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
}

function normalizePricing(
  record: LocalModelPricing,
  options: ModelPricingOptions
): ModelPricing {
  if (options.longContext && record.longContextPricing) {
    return toModelPricing(record.longContextPricing, record);
  }

  return toModelPricing(record);
}

function toModelPricing(
  details: LocalModelPricingDetails,
  fallback?: LocalModelPricingDetails
): ModelPricing {
  return {
    inputCostPerMToken: details.inputCostPerMToken,
    cachedInputCostPerMToken:
      details.cachedInputCostPerMToken ??
      fallback?.cachedInputCostPerMToken ??
      fallback?.inputCostPerMToken ??
      details.inputCostPerMToken,
    cacheWriteCostPerMToken: details.cacheWriteCostPerMToken ?? fallback?.cacheWriteCostPerMToken,
    outputCostPerMToken: details.outputCostPerMToken,
  };
}
