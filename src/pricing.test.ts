import { describe, expect, test } from "bun:test";
import { LOCAL_MODEL_PRICING } from "./pricing-data";
import { calculateCostUSD, getModelPricing } from "./pricing";

function normalizeLocalPricing(modelId: string) {
  const record = LOCAL_MODEL_PRICING[modelId];
  if (!record) return null;

  const details = record;

  return {
    inputCostPerMToken: details.inputCostPerMToken,
    cachedInputCostPerMToken: details.cachedInputCostPerMToken ?? details.inputCostPerMToken,
    outputCostPerMToken: details.outputCostPerMToken,
  };
}

function normalizeLongContextPricing(modelId: string) {
  const record = LOCAL_MODEL_PRICING[modelId];
  if (!record?.longContextPricing) return null;

  const details = record.longContextPricing;

  return {
    inputCostPerMToken: details.inputCostPerMToken,
    cachedInputCostPerMToken:
      details.cachedInputCostPerMToken ??
      record.cachedInputCostPerMToken ??
      record.inputCostPerMToken,
    outputCostPerMToken: details.outputCostPerMToken,
  };
}

describe("pricing", () => {
  test("calculates known GPT-5.4 base pricing", async () => {
    const pricing = await getModelPricing("gpt-5.4");

    expect(pricing).not.toBeNull();
    expect(pricing).toEqual({
      inputCostPerMToken: 2.5,
      cachedInputCostPerMToken: 0.25,
      outputCostPerMToken: 15,
    });

    const cost = calculateCostUSD(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 500_000,
      },
      pricing!
    );

    expect(cost).toBeCloseTo(9.55, 8);
  });

  test("applies GPT-5.4 long-context pricing to snapshot model ids", async () => {
    const expected = normalizeLongContextPricing("gpt-5.4");
    const pricing = await getModelPricing("openai/gpt-5.4-2026-03-01", { longContext: true });

    expect(expected).not.toBeNull();
    expect(pricing).toEqual(expected);
  });

  test("returns null for unsupported models", async () => {
    const pricing = await getModelPricing("totally-not-a-real-model");

    expect(pricing).toBeNull();
  });

  test("resolves GPT-5.4 mini pricing when the local table entry exists", async () => {
    const expected = normalizeLocalPricing("gpt-5.4-mini");
    if (!expected) return;

    const pricing = await getModelPricing("openai/gpt-5.4-mini-2026-03-01");

    expect(pricing).toEqual(expected);
  });

  test("rejects close-but-wrong model names", async () => {
    const pricing = await getModelPricing("openai/gpt-5.4-min");

    expect(pricing).toBeNull();
  });
});
