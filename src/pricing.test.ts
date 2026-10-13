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

  test("resolves GPT-5.5 pricing when the local table entry exists", async () => {
    const expected = normalizeLocalPricing("gpt-5.5");
    if (!expected) return;

    const pricing = await getModelPricing("openai/gpt-5.5-2026-04-24");

    expect(pricing).toEqual(expected);
  });

  test.each([
    ["gpt-5.6-sol", [4, 0.4, 20], [8, 0.8, 30]],
    ["gpt-5.6-terra", [2, 0.2, 12], [4, 0.4, 18]],
    ["gpt-5.6-luna", [0.2, 0.02, 1.2], [0.4, 0.04, 1.8]],
    ["gpt-6-astra", [10, 1, 50], [20, 2, 75]],
    ["gpt-6-sol", [2, 0.2, 10], [4, 0.4, 15]],
    ["gpt-6.1-sol", [2, 0.1, 10], [4, 0.2, 15]],
    ["gpt-6-luna", [0.1, 0.01, 0.5], [0.2, 0.02, 0.75]],
  ])("resolves %s standard short- and long-context pricing", async (model, short, long) => {
    const modelId = `openai/${model}-2026-09-22`;
    const toPricing = (rates: number[]) => ({
      inputCostPerMToken: rates[0],
      cachedInputCostPerMToken: rates[1],
      outputCostPerMToken: rates[2],
    });

    expect(await getModelPricing(model)).toEqual(toPricing(short));
    expect(await getModelPricing(model, { longContext: true })).toEqual(toPricing(long));
    expect(await getModelPricing(modelId)).toEqual(toPricing(short));
    expect(await getModelPricing(modelId, { longContext: true })).toEqual(toPricing(long));
  });

  test("resolves the GPT-5.6 alias to Sol", async () => {
    expect(await getModelPricing("gpt-5.6")).toEqual(await getModelPricing("gpt-5.6-sol"));
    expect(await getModelPricing("gpt-daybreak-blue-latest")).toEqual(await getModelPricing("gpt-5.6-sol"));
  });

  test("excludes reported cache writes from GPT-6 input cost", async () => {
    const pricing = await getModelPricing("gpt-6-sol");

    expect(pricing).not.toBeNull();
    expect(calculateCostUSD({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      cacheWriteTokens: 300_000,
      outputTokens: 100_000,
    }, pricing!)).toBeCloseTo(2.04, 8);

    expect(calculateCostUSD({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 100_000,
    }, pricing!)).toBeCloseTo(2.64, 8);
  });

  test.each([
    ["claude-fable-5-1", [10, 0.25, 12.5, 50]],
    ["claude-opus-5-5", [4, 0.2, 5, 20]],
    ["anthropic/claude-opus-4.8", [5, 0.5, 6.25, 25]],
    ["claude-sonnet-5-5", [2, 0.1, 2.5, 10]],
    ["claude-haiku-4-5-20251001", [1, 0.1, 1.25, 5]],
  ])("resolves %s Claude pricing", async (model, rates) => {
    expect(await getModelPricing(model)).toEqual({
      inputCostPerMToken: rates[0],
      cachedInputCostPerMToken: rates[1],
      cacheWriteCostPerMToken: rates[2],
      outputCostPerMToken: rates[3],
    });
  });

  test("bills Claude cache writes at the cache-write rate", async () => {
    const pricing = await getModelPricing("claude-opus-5-5");

    expect(pricing).not.toBeNull();
    expect(calculateCostUSD({
      inputTokens: 1_000_000,
      cachedInputTokens: 300_000,
      cacheWriteTokens: 100_000,
      outputTokens: 100_000,
    }, pricing!)).toBeCloseTo(0.6 * 4 + 0.3 * 0.2 + 0.1 * 5 + 0.1 * 20, 8);
  });

  test("rejects close-but-wrong model names", async () => {
    const pricing = await getModelPricing("openai/gpt-5.4-min");

    expect(pricing).toBeNull();
    expect(await getModelPricing("gpt-6.1")).toBeNull();
    expect(await getModelPricing("gpt-6.1-sol-mini")).toBeNull();
  });
});
