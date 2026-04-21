export interface LocalModelPricingDetails {
  inputCostPerMToken: number;
  cachedInputCostPerMToken?: number;
  outputCostPerMToken: number;
}

export interface LocalModelPricing extends LocalModelPricingDetails {
  longContextPricing?: LocalModelPricingDetails;
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
};
