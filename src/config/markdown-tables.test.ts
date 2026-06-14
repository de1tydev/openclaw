// Covers markdown table config normalization and channel overrides.
import { describe, expect, it, vi } from "vitest";

const listChannelPluginsMock = vi.hoisted(() =>
  vi.fn(() => [
    { id: "feishu", messaging: { defaultMarkdownTableMode: "bullets" as const } },
    { id: "mattermost", messaging: { defaultMarkdownTableMode: "off" as const } },
    { id: "signal", messaging: { defaultMarkdownTableMode: "bullets" as const } },
    { id: "whatsapp", messaging: { defaultMarkdownTableMode: "bullets" as const } },
  ]),
);
const getActivePluginChannelRegistryVersionMock = vi.hoisted(() => vi.fn(() => 1));

vi.mock("../channels/plugins/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../channels/plugins/registry.js")>(
    "../channels/plugins/registry.js",
  );
  return {
    ...actual,
    listChannelPlugins: () => listChannelPluginsMock(),
    normalizeChannelId: (raw?: string | null) => raw?.trim().toLowerCase() || null,
  };
});

vi.mock("../plugins/runtime.js", async () => {
  const actual =
    await vi.importActual<typeof import("../plugins/runtime.js")>("../plugins/runtime.js");
  return {
    ...actual,
    getActivePluginChannelRegistryVersion: () => getActivePluginChannelRegistryVersionMock(),
  };
});

import { DEFAULT_TABLE_MODES, resolveMarkdownTableMode } from "./markdown-tables.js";

describe("DEFAULT_TABLE_MODES", () => {
  it("feishu mode is bullets", () => {
    expect(DEFAULT_TABLE_MODES.get("feishu")).toBe("bullets");
  });

  it("mattermost mode is off", () => {
    expect(DEFAULT_TABLE_MODES.get("mattermost")).toBe("off");
  });

  it("signal mode is bullets", () => {
    expect(DEFAULT_TABLE_MODES.get("signal")).toBe("bullets");
  });

  it("whatsapp mode is bullets", () => {
    expect(DEFAULT_TABLE_MODES.get("whatsapp")).toBe("bullets");
  });

  it("slack has no special default in this seam-only slice", () => {
    expect(DEFAULT_TABLE_MODES.get("slack")).toBeUndefined();
  });
});

describe("resolveMarkdownTableMode", () => {
  it("uses registered channel defaults", () => {
    expect(resolveMarkdownTableMode({ channel: "feishu" })).toBe("bullets");
  });

  it("defaults to code for slack", () => {
    expect(resolveMarkdownTableMode({ channel: "slack" })).toBe("code");
  });

  it("uses account-level table mode before channel-level mode", () => {
    const cfg = {
      channels: {
        feishu: {
          markdown: { tables: "code" as const },
          accounts: {
            main: {
              markdown: { tables: "off" as const },
            },
          },
        },
      },
    };

    expect(resolveMarkdownTableMode({ cfg, channel: "feishu", accountId: "main" })).toBe("off");
    expect(resolveMarkdownTableMode({ cfg, channel: "feishu", accountId: "other" })).toBe("code");
  });

  it("coerces explicit block mode to code for slack", () => {
    const cfg = { channels: { slack: { markdown: { tables: "block" as const } } } };
    expect(resolveMarkdownTableMode({ cfg, channel: "slack" })).toBe("code");
  });

  it("coerces explicit block mode to code for non-slack channels", () => {
    const cfg = { channels: { telegram: { markdown: { tables: "block" as const } } } };
    expect(resolveMarkdownTableMode({ cfg, channel: "telegram" })).toBe("code");
  });
});
