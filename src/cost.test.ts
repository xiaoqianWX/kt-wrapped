import { describe, expect, test } from "bun:test";
import type { CodexUsageEvent } from "./collector";
import { calculateUsageCostFromEvents } from "./cost";

function createEvent(overrides: Partial<CodexUsageEvent>): CodexUsageEvent {
  return {
    sessionKey: "session-a",
    timestamp: "2026-03-10T00:00:00.000Z",
    model: "gpt-5.4",
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

describe("calculateUsageCostFromEvents", () => {
  test("does not trigger long-context pricing from session-cumulative totals alone", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        inputTokens: 105_071,
        cachedInputTokens: 102_656,
        outputTokens: 2_618,
        totalTokens: 2_718_114,
      }),
    ]);

    expect(cost).toBeCloseTo(0.0709715, 8);
  });

  test("does not trigger long-context pricing when a compacted session stays below the threshold", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        inputTokens: 260_000,
        outputTokens: 40_000,
        totalTokens: 300_000,
      }),
      createEvent({
        inputTokens: 250_000,
        outputTokens: 60_000,
        totalTokens: 310_000,
      }),
    ]);

    expect(cost).toBeCloseTo(2.775, 8);
  });

  test("applies long-context pricing to the full GPT-5.4 session once any request crosses the threshold", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        inputTokens: 300_000,
        cachedInputTokens: 100_000,
        outputTokens: 100_000,
        totalTokens: 400_000,
      }),
      createEvent({
        inputTokens: 10_000,
        outputTokens: 10_000,
        totalTokens: 20_000,
      }),
    ]);

    expect(cost).toBeCloseTo(3.575, 8);
  });

  test("keeps normal and long-context GPT-5.4 sessions separate", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        sessionKey: "session-a",
        inputTokens: 280_000,
        outputTokens: 20_000,
        totalTokens: 300_000,
      }),
      createEvent({
        sessionKey: "session-b",
        inputTokens: 200_000,
        outputTokens: 20_000,
        totalTokens: 220_000,
      }),
    ]);

    expect(cost).toBeCloseTo(2.65, 8);
  });

  test.each([
    ["gpt-6-sol", 2.06],
    ["gpt-6.1-sol", 2.04],
  ])("uses request-scoped long-context pricing for %s", async (model, expectedCost) => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        model,
        inputTokens: 300_000,
        cachedInputTokens: 100_000,
        cacheWriteTokens: 100_000,
        outputTokens: 100_000,
        totalTokens: 400_000,
      }),
      createEvent({
        model,
        inputTokens: 10_000,
        outputTokens: 10_000,
        totalTokens: 20_000,
      }),
    ]);

    expect(cost).toBeCloseTo(expectedCost, 8);
  });

  test("uses GPT-6.1 Sol's long-context rates only above 272K input tokens", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        model: "gpt-6.1-sol",
        inputTokens: 272_000,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 10_000,
        outputTokens: 1_000,
        totalTokens: 273_000,
      }),
      createEvent({
        model: "gpt-6.1-sol",
        inputTokens: 272_001,
        cachedInputTokens: 200_000,
        cacheWriteTokens: 10_000,
        outputTokens: 1_000,
        totalTokens: 273_001,
      }),
    ]);

    expect(cost).toBeCloseTo(0.457004, 8);
  });

  test("uses Claude Haiku 5.5's higher rates only for prompts above 100K tokens", async () => {
    const cost = await calculateUsageCostFromEvents([
      createEvent({
        model: "claude-haiku-5-5",
        inputTokens: 100_000,
        cachedInputTokens: 80_000,
        cacheWriteTokens: 10_000,
        outputTokens: 1_000,
        totalTokens: 101_000,
      }),
      createEvent({
        model: "claude-haiku-5-5",
        inputTokens: 100_001,
        cachedInputTokens: 80_000,
        cacheWriteTokens: 10_000,
        outputTokens: 1_000,
        totalTokens: 101_001,
      }),
    ]);

    expect(cost).toBeCloseTo(0.00355 + 0.0177505, 10);
  });
});
