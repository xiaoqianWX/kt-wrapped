export interface LocalModelPricingDetails {
  inputCostPerMToken: number;
  cachedInputCostPerMToken?: number;
  // Reported cache writes are treated as unbilled unless a rate is set.
  cacheWriteCostPerMToken?: number;
  outputCostPerMToken: number;
}

export interface LocalModelPricing extends LocalModelPricingDetails {
  longContextPricing?: LocalModelPricingDetails;
  longContextBillingScope?: "session" | "request";
  // Prompt size (input incl. cache reads/writes) above which longContextPricing applies.
  // Defaults to LONG_CONTEXT_INPUT_THRESHOLD.
  longContextInputThreshold?: number;
}

// Maintained pricing table.
// Add/update entries here when model pricing changes.
export const LOCAL_MODEL_PRICING: Record<string, LocalModelPricing> = {
  // GPT-5 family
  "gpt-5": { //deprecated
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.2": {
    inputCostPerMToken: 1.75,
    cachedInputCostPerMToken: 0.175,
    outputCostPerMToken: 14,
  },
  "gpt-5.2-codex": {
    inputCostPerMToken: 1.75,
    cachedInputCostPerMToken: 0.175,
    outputCostPerMToken: 14,
  },
  "gpt-5.3-codex": {
    inputCostPerMToken: 1.75,
    cachedInputCostPerMToken: 0.175,
    outputCostPerMToken: 14,
  },
  "gpt-5.1-codex-mini": {
    inputCostPerMToken: 0.25,
    cachedInputCostPerMToken: 0.025,
    outputCostPerMToken: 2,
  },
  "gpt-5.1-codex-max": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.1": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.1-codex": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5-codex": {
    inputCostPerMToken: 1.25,
    cachedInputCostPerMToken: 0.125,
    outputCostPerMToken: 10,
  },
  "gpt-5.4": {
    inputCostPerMToken: 2.5,
    cachedInputCostPerMToken: 0.25,
    outputCostPerMToken: 15,
    longContextBillingScope: "session",
    longContextPricing: {
      inputCostPerMToken: 5,
      cachedInputCostPerMToken: 0.5,
      outputCostPerMToken: 22.5,
    },
  },
  "gpt-5.4-mini": {
    inputCostPerMToken: 0.75,
    cachedInputCostPerMToken: 0.075,
    outputCostPerMToken: 4.5,
  },
  "gpt-5.5": {
    inputCostPerMToken: 5,
    cachedInputCostPerMToken: 0.5,
    outputCostPerMToken: 30,
  },
  // Standard API rates per 1M tokens, including the >272K input-token request tier.
  // https://developers.openai.com/api/docs/pricing
  // GPT-5.6 Sol's promotional rate is listed through at least November 21, 2026.
  "gpt-5.6-sol": {
    inputCostPerMToken: 4,
    cachedInputCostPerMToken: 0.4,
    outputCostPerMToken: 20,
    longContextPricing: {
      inputCostPerMToken: 8,
      cachedInputCostPerMToken: 0.8,
      outputCostPerMToken: 30,
    },
  },
  "gpt-5.6-terra": {
    inputCostPerMToken: 2,
    cachedInputCostPerMToken: 0.2,
    outputCostPerMToken: 12,
    longContextPricing: {
      inputCostPerMToken: 4,
      cachedInputCostPerMToken: 0.4,
      outputCostPerMToken: 18,
    },
  },
  "gpt-5.6-luna": {
    inputCostPerMToken: 0.2,
    cachedInputCostPerMToken: 0.02,
    outputCostPerMToken: 1.2,
    longContextPricing: {
      inputCostPerMToken: 0.4,
      cachedInputCostPerMToken: 0.04,
      outputCostPerMToken: 1.8,
    },
  },
  "gpt-6-astra": {
    inputCostPerMToken: 10,
    cachedInputCostPerMToken: 1,
    outputCostPerMToken: 50,
    longContextPricing: {
      inputCostPerMToken: 20,
      cachedInputCostPerMToken: 2,
      outputCostPerMToken: 75,
    },
  },
  "gpt-6-sol": {
    inputCostPerMToken: 2,
    cachedInputCostPerMToken: 0.2,
    outputCostPerMToken: 10,
    longContextPricing: {
      inputCostPerMToken: 4,
      cachedInputCostPerMToken: 0.4,
      outputCostPerMToken: 15,
    },
  },
  "gpt-6.1-sol": {
    inputCostPerMToken: 2,
    cachedInputCostPerMToken: 0.1,
    outputCostPerMToken: 10,
    longContextBillingScope: "request",
    longContextPricing: {
      inputCostPerMToken: 4,
      cachedInputCostPerMToken: 0.2,
      outputCostPerMToken: 15,
    },
  },
  "gpt-6-luna": {
    inputCostPerMToken: 0.1,
    cachedInputCostPerMToken: 0.01,
    outputCostPerMToken: 0.5,
    longContextPricing: {
      inputCostPerMToken: 0.2,
      cachedInputCostPerMToken: 0.02,
      outputCostPerMToken: 0.75,
    },
  },

  // Claude family: Anthropic first-party API rates per 1M tokens (5-minute cache writes).
  // https://platform.claude.com/docs/en/about-claude/pricing
  // Claude 4.6+ (except Haiku 5.5) bill the full 1M context at standard rates.
  "claude-fable-5-1": {
    inputCostPerMToken: 10,
    cachedInputCostPerMToken: 0.25,
    cacheWriteCostPerMToken: 12.5,
    outputCostPerMToken: 50,
  },
  "claude-fable-5": {
    inputCostPerMToken: 10,
    cachedInputCostPerMToken: 1,
    cacheWriteCostPerMToken: 12.5,
    outputCostPerMToken: 50,
  },
  "claude-opus-5-5": {
    inputCostPerMToken: 4,
    cachedInputCostPerMToken: 0.2,
    cacheWriteCostPerMToken: 5,
    outputCostPerMToken: 20,
  },
  "claude-opus-5": {
    inputCostPerMToken: 5,
    cachedInputCostPerMToken: 0.5,
    cacheWriteCostPerMToken: 6.25,
    outputCostPerMToken: 25,
  },
  "claude-opus-4-8": {
    inputCostPerMToken: 5,
    cachedInputCostPerMToken: 0.5,
    cacheWriteCostPerMToken: 6.25,
    outputCostPerMToken: 25,
  },
  "claude-opus-4-7": {
    inputCostPerMToken: 5,
    cachedInputCostPerMToken: 0.5,
    cacheWriteCostPerMToken: 6.25,
    outputCostPerMToken: 25,
  },
  "claude-opus-4-6": {
    inputCostPerMToken: 5,
    cachedInputCostPerMToken: 0.5,
    cacheWriteCostPerMToken: 6.25,
    outputCostPerMToken: 25,
  },
  "claude-sonnet-5-5": {
    inputCostPerMToken: 2,
    cachedInputCostPerMToken: 0.1,
    cacheWriteCostPerMToken: 2.5,
    outputCostPerMToken: 10,
  },
  "claude-sonnet-5": {
    inputCostPerMToken: 2,
    cachedInputCostPerMToken: 0.2,
    cacheWriteCostPerMToken: 2.5,
    outputCostPerMToken: 10,
  },
  "claude-sonnet-4-6": {
    inputCostPerMToken: 3,
    cachedInputCostPerMToken: 0.3,
    cacheWriteCostPerMToken: 3.75,
    outputCostPerMToken: 15,
  },
  "claude-haiku-5-5": {
    inputCostPerMToken: 0.1,
    cachedInputCostPerMToken: 0.01,
    cacheWriteCostPerMToken: 0.125,
    outputCostPerMToken: 0.5,
    longContextBillingScope: "request",
    longContextInputThreshold: 100_000,
    longContextPricing: {
      inputCostPerMToken: 0.5,
      cachedInputCostPerMToken: 0.05,
      cacheWriteCostPerMToken: 0.625,
      outputCostPerMToken: 2.5,
    },
  },
  "claude-haiku-4-5": {
    inputCostPerMToken: 1,
    cachedInputCostPerMToken: 0.1,
    cacheWriteCostPerMToken: 1.25,
    outputCostPerMToken: 5,
  },
};
