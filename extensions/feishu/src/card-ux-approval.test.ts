// Feishu tests cover plugin approval card ux behavior.
import { describe, expect, it } from "vitest";
import { createPluginApprovalCard, feishuPluginApprovalRender } from "./card-ux-approval.js";

describe("createPluginApprovalCard", () => {
  const baseParams = {
    approvalId: "plugin:test-123",
    title: "Apply workspace skill proposal",
    description: "Apply a pending workspace skill proposal into live workspace skills.",
    toolName: "skill_workshop",
    pluginId: "skill-workshop",
    agentId: "saber-cn",
    expiresAtMs: Date.now() + 120_000,
    nowMs: Date.now(),
    allowedDecisions: ["allow-once", "deny"] as const,
    sessionKey: "agent:saber-cn:feishu:direct:ou_test",
    chatId: "oc_test123",
    chatType: "p2p" as const,
  };

  it("produces a valid Feishu card JSON structure", () => {
    const card = createPluginApprovalCard(baseParams);
    expect(card.schema).toBe("2.0");
    expect((card.config as Record<string, unknown>).width_mode).toBe("fill");

    const header = card.header as Record<string, unknown>;
    expect((header.title as Record<string, unknown>).content).toContain("Plugin approval required");
    expect(header.template).toBe("orange");

    const body = card.body as Record<string, unknown>;
    const elements = body.elements as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(2);
    expect(elements[0].tag).toBe("markdown");
    expect(elements[1].tag).toBe("action");
  });

  it("includes title, description, tool, plugin, and agent in markdown", () => {
    const card = createPluginApprovalCard(baseParams);
    const body = card.body as Record<string, unknown>;
    const elements = body.elements as Array<Record<string, unknown>>;
    const md = elements[0].content as string;

    expect(md).toContain("**Apply workspace skill proposal**");
    expect(md).toContain("Apply a pending workspace skill proposal into live workspace skills.");
    expect(md).toContain("Tool: `skill_workshop`");
    expect(md).toContain("Plugin: skill-workshop");
    expect(md).toContain("Agent: saber-cn");
    expect(md).toContain("ID: `plugin:test-123`");
    expect(md).toContain("Expires in: 120s");
  });

  it("encodes /approve command in button value.q", () => {
    const card = createPluginApprovalCard(baseParams);
    const body = card.body as Record<string, unknown>;
    const elements = body.elements as Array<Record<string, unknown>>;
    const actionEl = elements[1];
    const actions = actionEl.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(2);

    const approveAction = actions.find((a) => a.type === "primary");
    expect(approveAction).toBeDefined();
    const approveValue = approveAction!.value as Record<string, unknown>;
    expect(approveValue.q).toBe("/approve plugin:test-123 allow-once");
    expect(approveValue.k).toBe("plugin_approval");
    expect(approveValue.m).toEqual({
      approvalId: "plugin:test-123",
      allowedDecisions: "allow-once,deny",
    });
    expect(approveValue.c).toEqual(
      expect.objectContaining({
        h: "oc_test123",
        s: "agent:saber-cn:feishu:direct:ou_test",
        t: "p2p",
      }),
    );

    const rejectAction = actions.find((a) => a.type === "danger");
    expect(rejectAction).toBeDefined();
    const rejectValue = rejectAction!.value as Record<string, unknown>;
    expect(rejectValue.q).toBe("/approve plugin:test-123 deny");
    expect(rejectValue.k).toBe("plugin_approval");
    expect(rejectValue.m).toEqual({
      approvalId: "plugin:test-123",
      allowedDecisions: "allow-once,deny",
    });
  });

  it("handles allow-once and allow-always as separate buttons", () => {
    const card = createPluginApprovalCard({
      ...baseParams,
      allowedDecisions: ["allow-once", "allow-always", "deny"] as const,
    });
    const body = card.body as Record<string, unknown>;
    const elements = body.elements as Array<Record<string, unknown>>;
    const actions = elements[1].actions as Array<Record<string, unknown>>;

    const approveOnce = actions.find(
      (a) => (a.value as Record<string, unknown>).q === "/approve plugin:test-123 allow-once",
    );
    expect(approveOnce).toBeDefined();
    expect((approveOnce!.value as Record<string, unknown>).q).toBe(
      "/approve plugin:test-123 allow-once",
    );

    const approveAlways = actions.find(
      (a) => (a.value as Record<string, unknown>).q === "/approve plugin:test-123 allow-always",
    );
    expect(approveAlways).toBeDefined();

    const reject = actions.find(
      (a) => (a.value as Record<string, unknown>).q === "/approve plugin:test-123 deny",
    );
    expect(reject).toBeDefined();
  });

  it("gracefully omits optional fields when null", () => {
    const card = createPluginApprovalCard({
      approvalId: "plugin:abc",
      title: "Simple",
      description: "Test",
      toolName: null,
      pluginId: null,
      agentId: null,
      expiresAtMs: Date.now() + 60_000,
      nowMs: Date.now(),
      allowedDecisions: ["allow-once", "deny"] as const,
    });
    const body = card.body as Record<string, unknown>;
    const md = (body.elements as Array<Record<string, unknown>>)[0].content as string;
    expect(md).not.toContain("Tool:");
    expect(md).not.toContain("Plugin:");
    expect(md).not.toContain("Agent:");
    expect(md).toContain("ID: `plugin:abc`");
  });

  it("calculates correct expiry seconds", () => {
    const card = createPluginApprovalCard({
      ...baseParams,
      nowMs: 1_000_000,
      expiresAtMs: 1_060_000,
    });
    const body = card.body as Record<string, unknown>;
    const md = (body.elements as Array<Record<string, unknown>>)[0].content as string;
    expect(md).toContain("Expires in: 60s");
  });

  it("clamps negative expiry to 0s", () => {
    const card = createPluginApprovalCard({
      ...baseParams,
      nowMs: 2_000_000,
      expiresAtMs: 1_000_000,
    });
    const body = card.body as Record<string, unknown>;
    const md = (body.elements as Array<Record<string, unknown>>)[0].content as string;
    expect(md).toContain("Expires in: 0s");
  });
});

describe("feishuPluginApprovalRender", () => {
  it("buildPendingPayload returns a ReplyPayload with feishu card", () => {
    const request = {
      id: "plugin:render-test",
      request: {
        title: "Test render",
        description: "Render test",
        toolName: "skill_workshop",
        pluginId: "skill-workshop",
        agentId: "saber",
        sessionKey: "agent:test:feishu:direct:ou_test",
      },
      createdAtMs: Date.now() - 5000,
      expiresAtMs: Date.now() + 115_000,
    };

    const payload = feishuPluginApprovalRender.buildPendingPayload({
      cfg: {} as any,
      request,
      target: { channel: "feishu", to: "user:ou_test" },
      nowMs: Date.now(),
    });

    expect(payload).toBeDefined();
    expect(typeof payload.text).toBe("string");
    expect(payload.channelData).toBeDefined();
    const feishuData = (payload.channelData as Record<string, unknown>).feishu as
      | Record<string, unknown>
      | undefined;
    expect(feishuData).toBeDefined();
    expect(feishuData?.card).toBeDefined();
    const card = feishuData!.card as Record<string, unknown>;
    expect(card.schema).toBe("2.0");
    expect((card.header as Record<string, unknown>).template).toBe("orange");
  });

  it("binds pending cards to Feishu chat targets", () => {
    const request = {
      id: "plugin:group-target",
      request: {
        title: "Test render",
        description: "Render test",
        allowedDecisions: ["allow-once", "deny"] as const,
      },
      createdAtMs: Date.now() - 5000,
      expiresAtMs: Date.now() + 115_000,
    };

    const payload = feishuPluginApprovalRender.buildPendingPayload({
      cfg: {} as any,
      request,
      target: { channel: "feishu", to: "chat:oc_group_1" },
      nowMs: Date.now(),
    });
    const feishuData = (payload.channelData as Record<string, unknown>).feishu as
      | Record<string, unknown>
      | undefined;
    const card = feishuData?.card as Record<string, unknown>;
    const body = card.body as Record<string, unknown>;
    const actions = (body.elements as Array<Record<string, unknown>>)[1].actions as Array<
      Record<string, unknown>
    >;
    const approveValue = actions.find((a) => a.type === "primary")!.value as Record<
      string,
      unknown
    >;
    expect(approveValue.c).toEqual(
      expect.objectContaining({
        h: "oc_group_1",
        t: "group",
      }),
    );
  });

  it("binds pending cards to Feishu open_id DM targets", () => {
    const request = {
      id: "plugin:dm-target",
      request: {
        title: "Test render",
        description: "Render test",
        allowedDecisions: ["allow-once"] as const,
      },
      createdAtMs: Date.now() - 5000,
      expiresAtMs: Date.now() + 115_000,
    };

    const payload = feishuPluginApprovalRender.buildPendingPayload({
      cfg: {} as any,
      request,
      target: { channel: "feishu", to: "user:ou_owner" },
      nowMs: Date.now(),
    });
    const feishuData = (payload.channelData as Record<string, unknown>).feishu as
      | Record<string, unknown>
      | undefined;
    const card = feishuData?.card as Record<string, unknown>;
    const body = card.body as Record<string, unknown>;
    const actions = (body.elements as Array<Record<string, unknown>>)[1].actions as Array<
      Record<string, unknown>
    >;
    const approveValue = actions.find((a) => a.type === "primary")!.value as Record<
      string,
      unknown
    >;
    expect(approveValue.c).toEqual(
      expect.objectContaining({
        u: "ou_owner",
        t: "p2p",
      }),
    );
  });

  it("buildResolvedPayload returns a text ReplyPayload", () => {
    const resolved = {
      id: "plugin:resolve-test",
      decision: "allow-once" as const,
      resolvedBy: "ou_test_user",
      ts: Date.now(),
    };

    const payload = feishuPluginApprovalRender.buildResolvedPayload({
      cfg: {} as any,
      resolved,
      target: { channel: "feishu", to: "user:ou_test" },
    });

    expect(payload).toBeDefined();
    expect(typeof payload.text).toBe("string");
    expect(payload.text).toContain("allowed once");
    expect(payload.text).toContain("plugin:resolve-test");
  });
});

describe("button value encode/decode round-trip", () => {
  it("approves with allow-once encode correctly", () => {
    const card = createPluginApprovalCard({
      approvalId: "plugin:roundtrip",
      title: "T",
      description: "D",
      expiresAtMs: Date.now() + 120_000,
      nowMs: Date.now(),
      allowedDecisions: ["allow-once", "deny"] as const,
    });

    const body = card.body as Record<string, unknown>;
    const actions = (body.elements as Array<Record<string, unknown>>)[1].actions as Array<
      Record<string, unknown>
    >;
    const approveValue = actions.find((a) => a.type === "primary")!.value as Record<
      string,
      unknown
    >;

    // Simulate what dispatchSyntheticCommand would see
    const command = approveValue.q as string;
    expect(command).toBe("/approve plugin:roundtrip allow-once");

    const rejectValue = actions.find((a) => a.type === "danger")!.value as Record<string, unknown>;
    const rejectCommand = rejectValue.q as string;
    expect(rejectCommand).toBe("/approve plugin:roundtrip deny");
  });
});
