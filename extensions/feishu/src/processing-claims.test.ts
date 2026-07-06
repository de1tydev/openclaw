// Feishu tests cover in-flight processing claim behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { testingHooks, tryBeginFeishuMessageProcessing } from "./processing-claims.js";

describe("Feishu message processing claims", () => {
  afterEach(() => {
    vi.useRealTimers();
    testingHooks.resetFeishuMessageProcessingClaimsForTests();
  });

  it("keeps a claim active after the old 5 minute dedupe window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    expect(tryBeginFeishuMessageProcessing("om_claim_ttl", "default")).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(tryBeginFeishuMessageProcessing("om_claim_ttl", "default")).toBe(false);
  });

  it("expires a claim after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    expect(tryBeginFeishuMessageProcessing("om_claim_expired", "default")).toBe(true);

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    expect(tryBeginFeishuMessageProcessing("om_claim_expired", "default")).toBe(true);
  });
});
