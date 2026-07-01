import { OutboundDeliveryError } from "openclaw/plugin-sdk/channel-outbound";
// Feishu tests cover send plugin behavior.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawdbotConfig } from "../runtime-api.js";
import { buildFeishuPostMessagePayload, buildMarkdownCard } from "./send.js";

const {
  mockConvertMarkdownTables,
  mockClientGet,
  mockClientList,
  mockClientPatch,
  mockCreateFeishuClient,
  mockResolveMarkdownTableMode,
  mockResolveFeishuAccount,
  mockRuntimeConvertMarkdownTables,
  mockRuntimeLoggerWarn,
  mockRuntimeResolveMarkdownTableMode,
  mockRuntimeStores,
  mockOpenSyncKeyedStore,
} = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>();
  const openSyncKeyedStore = vi.fn(({ namespace }: { namespace: string }) => {
    let store = stores.get(namespace);
    if (!store) {
      store = new Map<string, unknown>();
      stores.set(namespace, store);
    }
    return {
      register: (key: string, value: unknown) => {
        store.set(key, value);
      },
      registerIfAbsent: (key: string, value: unknown) => {
        if (store.has(key)) {
          return false;
        }
        store.set(key, value);
        return true;
      },
      lookup: (key: string) => store.get(key),
      consume: (key: string) => {
        const value = store.get(key);
        store.delete(key);
        return value;
      },
      delete: (key: string) => store.delete(key),
      entries: () =>
        Array.from(store.entries()).map(([key, value]) => ({ key, value, createdAt: 0 })),
      clear: () => store.clear(),
    };
  });
  return {
    mockConvertMarkdownTables: vi.fn((text: string) => text),
    mockClientGet: vi.fn(),
    mockClientList: vi.fn(),
    mockClientPatch: vi.fn(),
    mockCreateFeishuClient: vi.fn(),
    mockResolveMarkdownTableMode: vi.fn(() => "preserve"),
    mockResolveFeishuAccount: vi.fn(),
    mockRuntimeConvertMarkdownTables: vi.fn((text: string) => text),
    mockRuntimeLoggerWarn: vi.fn(),
    mockRuntimeResolveMarkdownTableMode: vi.fn(() => "preserve"),
    mockRuntimeStores: stores,
    mockOpenSyncKeyedStore: openSyncKeyedStore,
  };
});

vi.mock("openclaw/plugin-sdk/markdown-table-runtime", () => ({
  resolveMarkdownTableMode: mockResolveMarkdownTableMode,
}));

vi.mock("openclaw/plugin-sdk/text-chunking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/text-chunking")>();
  return {
    ...actual,
    convertMarkdownTables: mockConvertMarkdownTables,
  };
});

vi.mock("./client.js", () => ({
  createFeishuClient: mockCreateFeishuClient,
}));

vi.mock("./accounts.js", () => ({
  resolveFeishuAccount: mockResolveFeishuAccount,
  resolveFeishuRuntimeAccount: mockResolveFeishuAccount,
}));

vi.mock("./runtime.js", () => ({
  getFeishuRuntime: () => ({
    channel: {
      text: {
        resolveMarkdownTableMode: mockRuntimeResolveMarkdownTableMode,
        convertMarkdownTables: mockRuntimeConvertMarkdownTables,
      },
    },
    state: {
      openSyncKeyedStore: mockOpenSyncKeyedStore,
    },
    logging: {
      getChildLogger: () => ({
        warn: mockRuntimeLoggerWarn,
      }),
    },
  }),
}));

let buildStructuredCard: typeof import("./send.js").buildStructuredCard;
let editMessageFeishu: typeof import("./send.js").editMessageFeishu;
let getMessageFeishu: typeof import("./send.js").getMessageFeishu;
let listFeishuThreadMessages: typeof import("./send.js").listFeishuThreadMessages;
let recordFeishuStreamingCardContent: typeof import("./streaming-card-content-index.js").recordFeishuStreamingCardContent;
let recordLegacyFeishuStreamingCardContentForTests: typeof import("./streaming-card-content-index.js").testingHooks.recordLegacyFeishuStreamingCardContentForTests;
let resetFeishuStreamingCardContentMemoryForTests: typeof import("./streaming-card-content-index.js").testingHooks.resetFeishuStreamingCardContentMemoryForTests;
let resetFeishuStreamingCardContentIndexForTests: typeof import("./streaming-card-content-index.js").testingHooks.resetFeishuStreamingCardContentIndexForTests;
let resolveFeishuCardTemplate: typeof import("./send.js").resolveFeishuCardTemplate;
let sendCardFeishu: typeof import("./send.js").sendCardFeishu;
let sendMarkdownCardFeishu: typeof import("./send.js").sendMarkdownCardFeishu;
let sendMessageFeishu: typeof import("./send.js").sendMessageFeishu;
let sendStructuredCardFeishu: typeof import("./send.js").sendStructuredCardFeishu;
let updateCardFeishu: typeof import("./send.js").updateCardFeishu;

describe("buildFeishuPostMessagePayload", () => {
  it("prepends structured mention targets as native post at elements", () => {
    const payload = buildFeishuPostMessagePayload({
      messageText: "hello **world**",
      mentions: [
        { openId: "ou_alice", name: "Alice", key: "@_user_1" },
        { openId: " ou_bob ", name: " Bob ", key: "@_user_2" },
      ],
    });

    expect(payload.msgType).toBe("post");
    expect(JSON.parse(payload.content)).toEqual({
      zh_cn: {
        content: [
          [
            { tag: "at", user_id: "ou_alice", user_name: "Alice" },
            { tag: "at", user_id: "ou_bob", user_name: "Bob" },
            { tag: "md", text: "hello **world**" },
          ],
        ],
      },
    });
  });

  it("leaves body-supplied at tags literal in the markdown element", () => {
    const payload = buildFeishuPostMessagePayload({
      messageText: 'please keep <at user_id="ou_body">Body User</at> literal',
      mentions: [{ openId: "ou_target", name: "Target User", key: "@_user_1" }],
    });

    expect(JSON.parse(payload.content)).toEqual({
      zh_cn: {
        content: [
          [
            { tag: "at", user_id: "ou_target", user_name: "Target User" },
            { tag: "md", text: 'please keep <at user_id="ou_body">Body User</at> literal' },
          ],
        ],
      },
    });
  });
});

describe("getMessageFeishu", () => {
  beforeAll(async () => {
    ({
      buildStructuredCard,
      editMessageFeishu,
      getMessageFeishu,
      listFeishuThreadMessages,
      resolveFeishuCardTemplate,
      sendCardFeishu,
      sendMarkdownCardFeishu,
      sendMessageFeishu,
      sendStructuredCardFeishu,
      updateCardFeishu,
    } = await import("./send.js"));
    ({
      recordFeishuStreamingCardContent,
      testingHooks: {
        recordLegacyFeishuStreamingCardContentForTests,
        resetFeishuStreamingCardContentIndexForTests,
        resetFeishuStreamingCardContentMemoryForTests,
      },
    } = await import("./streaming-card-content-index.js"));
  });

  afterAll(() => {
    vi.doUnmock("openclaw/plugin-sdk/markdown-table-runtime");
    vi.doUnmock("openclaw/plugin-sdk/text-chunking");
    vi.doUnmock("./client.js");
    vi.doUnmock("./accounts.js");
    vi.doUnmock("./runtime.js");
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMarkdownTableMode.mockReturnValue("preserve");
    mockConvertMarkdownTables.mockImplementation((text: string) => text);
    mockRuntimeResolveMarkdownTableMode.mockReturnValue("preserve");
    mockRuntimeConvertMarkdownTables.mockImplementation((text: string) => text);
    mockRuntimeLoggerWarn.mockReset();
    mockRuntimeStores.clear();
    mockOpenSyncKeyedStore.mockClear();
    resetFeishuStreamingCardContentIndexForTests?.();
    mockResolveFeishuAccount.mockReturnValue({
      accountId: "default",
      configured: true,
    });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create: vi.fn(),
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
  });

  it("sends markdown tables as native Feishu table cards", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_card" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    await sendMarkdownCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_card",
      text: "| A | B |\n|---|---|\n| 1 | 2 |",
      accountId: "main",
    });

    const content = JSON.parse(create.mock.calls[0][0].data.content);
    expect(content.body.elements[0]).toEqual(
      expect.objectContaining({
        tag: "table",
        columns: [
          expect.objectContaining({ display_name: "A", name: "col_0" }),
          expect.objectContaining({ display_name: "B", name: "col_1" }),
        ],
        rows: [{ col_0: "1", col_1: "2" }],
      }),
    );
    expect(mockConvertMarkdownTables).not.toHaveBeenCalled();
  });

  it("sends markdown tables as native structured cards with headers", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_structured" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    await sendStructuredCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_card",
      text: "| A | B |\n|---|---|\n| 1 | 2 |",
      header: { title: "agent" },
    });

    const content = JSON.parse(create.mock.calls[0][0].data.content);
    expect(content.body.elements[0]).toEqual(
      expect.objectContaining({
        tag: "table",
        rows: [{ col_0: "1", col_1: "2" }],
      }),
    );
    expect(content.header.title.content).toBe("agent");
    expect(mockConvertMarkdownTables).not.toHaveBeenCalled();
  });

  it("falls back to post content when the first native table card is rejected", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ code: 9499, msg: "invalid card" })
      .mockResolvedValueOnce({ code: 0, data: { message_id: "om_fallback" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
    mockConvertMarkdownTables.mockReturnValue("fallback table");

    const result = await sendMarkdownCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_card",
      text: "| A | B |\n|---|---|\n| 1 | 2 |",
      accountId: "main",
    });

    expect(result.messageId).toBe("om_fallback");
    expect(create.mock.calls[0][0].data.msg_type).toBe("interactive");
    expect(create.mock.calls[1][0].data.msg_type).toBe("post");
    const post = JSON.parse(create.mock.calls[1][0].data.content);
    expect(post.zh_cn.content[0][0].text).toBe("fallback table");
  });

  it("reports partial delivery when a later native table card fails", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, data: { message_id: "om_table_1" } })
      .mockResolvedValueOnce({ code: 9499, msg: "invalid card" });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
    const text = Array.from(
      { length: 6 },
      (_, index) => `| A${index} | B${index} |\n|---|---|\n| 1 | 2 |`,
    ).join("\n\n");

    let thrown: unknown;
    try {
      await sendMarkdownCardFeishu({
        cfg: {} as ClawdbotConfig,
        to: "oc_card",
        text,
        accountId: "main",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OutboundDeliveryError);
    expect(thrown).toMatchObject({
      name: "OutboundDeliveryError",
      results: [expect.objectContaining({ channel: "feishu", messageId: "om_table_1" })],
      sentBeforeError: true,
    });
  });

  it("preserves reply thread fields when sending native table cards", async () => {
    const reply = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_reply_card" } });
    const create = vi.fn();
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          reply,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    await sendStructuredCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_card",
      text: "| A | B |\n|---|---|\n| 1 | 2 |",
      replyToMessageId: "om_parent",
      replyInThread: true,
      accountId: "main",
    });

    expect(create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      path: { message_id: "om_parent" },
      data: expect.objectContaining({
        msg_type: "interactive",
        reply_in_thread: true,
        uuid: expect.any(String),
      }),
    });
    const content = JSON.parse(reply.mock.calls[0][0].data.content);
    expect(content.body.elements[0]).toEqual(expect.objectContaining({ tag: "table" }));
  });

  it("uses the same Feishu uuid when retrying a transient reply failure", async () => {
    const reply = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ code: 0, data: { message_id: "om_retry_ok" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create: vi.fn(),
          reply,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    await sendStructuredCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_card",
      text: "retry me",
      replyToMessageId: "om_parent",
      accountId: "main",
    });

    expect(reply).toHaveBeenCalledTimes(2);
    const firstUuid = reply.mock.calls[0][0].data.uuid;
    const secondUuid = reply.mock.calls[1][0].data.uuid;
    expect(firstUuid).toEqual(expect.any(String));
    expect(secondUuid).toBe(firstUuid);
  });

  it("sends text without requiring Feishu runtime text helpers", async () => {
    mockRuntimeResolveMarkdownTableMode.mockImplementation(() => {
      throw new Error("Feishu runtime not initialized");
    });
    mockRuntimeConvertMarkdownTables.mockImplementation(() => {
      throw new Error("Feishu runtime not initialized");
    });
    mockClientPatch.mockResolvedValueOnce({ code: 0 });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create: vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_send" } }),
          reply: vi.fn(),
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    const result = await sendMessageFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_send",
      text: "hello",
    });

    expect(mockResolveMarkdownTableMode).toHaveBeenCalledWith({
      cfg: {},
      channel: "feishu",
    });
    expect(mockConvertMarkdownTables).toHaveBeenCalledWith("hello", "preserve");
    expect(typeof result.receipt.sentAt).toBe("number");
    expect(result).toEqual({
      messageId: "om_send",
      chatId: "oc_send",
      receipt: {
        primaryPlatformMessageId: "om_send",
        platformMessageIds: ["om_send"],
        parts: [
          {
            platformMessageId: "om_send",
            kind: "text",
            index: 0,
            raw: {
              channel: "feishu",
              messageId: "om_send",
              chatId: "oc_send",
              conversationId: "oc_send",
            },
            threadId: "oc_send",
          },
        ],
        threadId: "oc_send",
        sentAt: result.receipt.sentAt,
        raw: [
          {
            channel: "feishu",
            messageId: "om_send",
            chatId: "oc_send",
            conversationId: "oc_send",
          },
        ],
      },
    });
  });

  it("sends automatic mentions as native post elements without rewriting body text", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_mentions" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          reply: vi.fn(),
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    const result = await sendMessageFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_send",
      text: 'body <at user_id="ou_body">Body User</at>',
      mentions: [{ openId: "ou_target", name: "Target User", key: "@_user_1" }],
    });

    expect(mockConvertMarkdownTables).toHaveBeenCalledWith(
      'body <at user_id="ou_body">Body User</at>',
      "preserve",
    );
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: expect.objectContaining({
        receive_id: "oc_send",
        msg_type: "post",
        content: JSON.stringify({
          zh_cn: {
            content: [
              [
                { tag: "at", user_id: "ou_target", user_name: "Target User" },
                { tag: "md", text: 'body <at user_id="ou_body">Body User</at>' },
              ],
            ],
          },
        }),
      }),
    });
    expect(typeof result.receipt.sentAt).toBe("number");
    expect(result).toEqual({
      messageId: "om_mentions",
      chatId: "oc_send",
      receipt: {
        primaryPlatformMessageId: "om_mentions",
        platformMessageIds: ["om_mentions"],
        parts: [
          {
            platformMessageId: "om_mentions",
            kind: "text",
            index: 0,
            raw: {
              channel: "feishu",
              messageId: "om_mentions",
              chatId: "oc_send",
              conversationId: "oc_send",
            },
            threadId: "oc_send",
          },
        ],
        threadId: "oc_send",
        sentAt: result.receipt.sentAt,
        raw: [
          {
            channel: "feishu",
            messageId: "om_mentions",
            chatId: "oc_send",
            conversationId: "oc_send",
          },
        ],
      },
    });
  });

  it("extracts text content from interactive card elements", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_1",
            chat_id: "oc_1",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [
                  { tag: "markdown", content: "hello markdown" },
                  { tag: "div", text: { content: "hello div" } },
                ],
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_1",
    });

    expect(mockClientGet).toHaveBeenCalledWith({
      params: { card_msg_content_type: "user_card_content" },
      path: { message_id: "om_1" },
    });
    expect(result).toEqual({
      messageId: "om_1",
      chatId: "oc_1",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "hello markdown\nhello div",
      rawContent: expect.any(String),
      contentType: "interactive",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("extracts native table card content as recoverable markdown", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_table_card",
            chat_id: "oc_table_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                schema: "2.0",
                body: {
                  elements: [
                    {
                      tag: "table",
                      columns: [
                        { name: "col_0", display_name: "Name", horizontal_align: "left" },
                        { name: "col_1", display_name: "Score", horizontal_align: "right" },
                      ],
                      rows: [
                        { col_0: "Ada | Lovelace", col_1: 10 },
                        { col_0: "`Grace | Hopper`", col_1: 9 },
                      ],
                    },
                  ],
                },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_table_card",
    });

    expect(result?.content).toBe(
      "| Name | Score |\n| --- | ---: |\n| Ada \\| Lovelace | 10 |\n| `Grace \\| Hopper` | 9 |",
    );
  });

  it("does not treat client-upgrade interactive fallback text as recovered card content", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_legacy_card",
            chat_id: "oc_legacy_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                title: "saber",
                elements: [
                  [
                    { tag: "img", image_key: "img_v3" },
                    { tag: "text", text: "请升级至最新版本客户端，以查看内容" },
                    { tag: "text", text: "" },
                  ],
                ],
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_legacy_card",
    });

    expect(result?.content).toBe("[Interactive Card]");
    expect(result?.contentType).toBe("interactive");
    expect(mockRuntimeLoggerWarn).toHaveBeenCalledWith("feishu outbound card content index miss", {
      fallbackKind: "client-upgrade",
      messageId: "om_legacy_card",
      cardId: undefined,
      accountId: "default",
      chatId: "oc_legacy_card",
    });
  });

  it("hydrates card-reference interactive messages from the streaming card content index", async () => {
    recordFeishuStreamingCardContent({
      cardId: "card_ref_1",
      messageId: "om_stream_ref",
      accountId: "main",
      chatId: "oc_stream_ref",
      text: "real final streaming content",
    });
    mockResolveFeishuAccount.mockReturnValue({
      accountId: "main",
      configured: true,
    });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_stream_ref",
            chat_id: "oc_stream_ref",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_ref_1" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_stream_ref",
      accountId: "main",
    });

    expect(result?.content).toBe("real final streaming content");
  });

  it("hydrates fallback-only interactive card text when the index has better content", async () => {
    recordFeishuStreamingCardContent({
      cardId: "card_legacy_1",
      messageId: "om_legacy_card_indexed",
      accountId: "default",
      chatId: "oc_legacy_card",
      text: "真实的最终流式内容",
    });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_legacy_card_indexed",
            chat_id: "oc_legacy_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                title: "saber",
                elements: [[{ tag: "text", text: "请升级至最新版本客户端，以查看内容" }]],
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_legacy_card_indexed",
    });

    expect(result?.content).toBe("真实的最终流式内容");
  });

  it("does not hydrate indexed card content across chat scopes", async () => {
    recordFeishuStreamingCardContent({
      cardId: "card_wrong_chat",
      messageId: "om_wrong_chat",
      accountId: "main",
      chatId: "oc_original_chat",
      text: "content from another chat",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_wrong_chat",
            chat_id: "oc_other_chat",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_wrong_chat" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_wrong_chat",
      accountId: "main",
    });

    expect(result?.content).toBe("[Interactive Card]");
    expect(mockRuntimeLoggerWarn).toHaveBeenCalledWith("feishu outbound card content index miss", {
      fallbackKind: "card-reference",
      messageId: "om_wrong_chat",
      cardId: "card_wrong_chat",
      accountId: "main",
      chatId: "oc_other_chat",
    });
  });

  it("does not let older streaming index writes overwrite newer content", async () => {
    const now = Date.now();
    recordFeishuStreamingCardContent({
      cardId: "card_sequence",
      messageId: "om_sequence",
      accountId: "main",
      chatId: "oc_sequence",
      text: "new content",
      updatedAt: now,
      sequence: 2,
    });
    recordFeishuStreamingCardContent({
      cardId: "card_sequence",
      messageId: "om_sequence",
      accountId: "main",
      chatId: "oc_sequence",
      text: "old content",
      updatedAt: now - 1,
      sequence: 1,
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_sequence",
            chat_id: "oc_sequence",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_sequence" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_sequence",
      accountId: "main",
    });

    expect(result?.content).toBe("new content");
  });

  it("hydrates streaming card stubs from persisted plugin state after memory cache reset", async () => {
    recordFeishuStreamingCardContent({
      cardId: "card_persisted_ref",
      messageId: "om_stream_persisted_ref",
      accountId: "default",
      chatId: "oc_stream_persisted_ref",
      text: "persisted streaming content",
    });
    resetFeishuStreamingCardContentMemoryForTests?.();
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_stream_persisted_ref",
            chat_id: "oc_stream_persisted_ref",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                type: "card",
                data: { card_id: "card_persisted_ref" },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_stream_persisted_ref",
    });

    expect(result?.content).toBe("persisted streaming content");
    expect(mockOpenSyncKeyedStore).toHaveBeenCalledWith({
      namespace: "outbound-card-content",
      maxEntries: 20_000,
      defaultTtlMs: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("hydrates static structured card fallback from the outbound card content index", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { message_id: "om_structured_index" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });

    await sendStructuredCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_structured_index",
      text: "structured source text",
      accountId: "main",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_structured_index",
            chat_id: "oc_structured_index",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [[{ tag: "text", text: "请升级至最新版本客户端，以查看内容" }]],
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_structured_index",
      accountId: "main",
    });

    expect(result?.content).toBe("structured source text");
  });

  it("hydrates static markdown card fallback from the outbound card content index", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ code: 0, data: { message_id: "om_markdown_index" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });

    await sendMarkdownCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_markdown_index",
      text: "markdown source text",
      accountId: "main",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_markdown_index",
            chat_id: "oc_markdown_index",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_markdown" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_markdown_index",
      accountId: "main",
    });

    expect(result?.content).toBe("markdown source text");
  });

  it("indexes direct card sends only when explicit recoverable text is supplied", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_direct_index" } });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });

    await sendCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_direct_index",
      card: { schema: "2.0" },
      accountId: "main",
      recoverableText: "direct recoverable text",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_direct_index",
            chat_id: "oc_direct_index",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_direct" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_direct_index",
      accountId: "main",
    });

    expect(result?.content).toBe("direct recoverable text");
  });

  it("does not index placeholder unknown message ids", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: {} });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          create,
          get: mockClientGet,
          list: mockClientList,
          patch: mockClientPatch,
        },
      },
    });

    await sendCardFeishu({
      cfg: {} as ClawdbotConfig,
      to: "oc_unknown_index",
      card: { schema: "2.0" },
      recoverableText: "must not persist",
    });

    expect(mockRuntimeStores.get("outbound-card-content")?.size ?? 0).toBe(0);
  });

  it("does not hydrate outbound card content across account scopes", async () => {
    recordFeishuStreamingCardContent({
      cardId: "card_account_scoped",
      messageId: "om_account_scoped",
      accountId: "main",
      text: "main account content",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "other", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_account_scoped",
            chat_id: "oc_account_scoped",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_account_scoped" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_account_scoped",
      accountId: "other",
    });

    expect(result?.content).toBe("[Interactive Card]");
  });

  it("keeps legacy streaming-card-content records readable", async () => {
    recordLegacyFeishuStreamingCardContentForTests({
      cardId: "card_legacy_namespace",
      messageId: "om_legacy_namespace",
      accountId: "main",
      text: "legacy namespace content",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_legacy_namespace",
            chat_id: "oc_legacy_namespace",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_legacy_namespace" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_legacy_namespace",
      accountId: "main",
    });

    expect(result?.content).toBe("legacy namespace content");
  });

  it("does not hydrate legacy streaming records by card id across message scopes", async () => {
    recordLegacyFeishuStreamingCardContentForTests({
      cardId: "card_legacy_cross_chat",
      messageId: "om_legacy_original",
      accountId: "main",
      text: "legacy content from another message",
    });
    mockResolveFeishuAccount.mockReturnValue({ accountId: "main", configured: true });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_legacy_other",
            chat_id: "oc_legacy_other",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                type: "card",
                data: { card_id: "card_legacy_cross_chat" },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_legacy_other",
      accountId: "main",
    });

    expect(result?.content).toBe("[Interactive Card]");
    expect(mockRuntimeLoggerWarn).toHaveBeenCalledWith("feishu outbound card content index miss", {
      fallbackKind: "card-reference",
      messageId: "om_legacy_other",
      cardId: "card_legacy_cross_chat",
      accountId: "main",
      chatId: "oc_legacy_other",
    });
  });

  it("keeps the safe interactive fallback when the streaming card content index misses", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_stream_miss",
            chat_id: "oc_stream_miss",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_missing" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_stream_miss",
    });

    expect(result?.content).toBe("[Interactive Card]");
    expect(mockRuntimeLoggerWarn).toHaveBeenCalledWith("feishu outbound card content index miss", {
      fallbackKind: "card-reference",
      messageId: "om_stream_miss",
      cardId: "card_missing",
      accountId: "default",
      chatId: "oc_stream_miss",
    });
  });

  it("returns the safe fallback when client-upgrade interactive text is not indexed", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_upgrade_miss",
            chat_id: "oc_upgrade_miss",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [[{ tag: "text", text: "请升级至最新版本客户端，以查看内容" }]],
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_upgrade_miss",
    });

    expect(result?.content).toBe("[Interactive Card]");
    expect(mockRuntimeLoggerWarn).toHaveBeenCalledWith("feishu outbound card content index miss", {
      fallbackKind: "client-upgrade",
      messageId: "om_upgrade_miss",
      cardId: undefined,
      accountId: "default",
      chatId: "oc_upgrade_miss",
    });
  });

  it("falls through empty interactive card element arrays and locale variants", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_i18n_card",
            chat_id: "oc_i18n_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [],
                body: { elements: [] },
                i18n_elements: {
                  zh_cn: [],
                  en_us: [
                    {
                      tag: "markdown",
                      content: "hello ${count} {{label}} {{metadata}}",
                    },
                  ],
                },
                template_variable: {
                  count: 2,
                  label: "tasks",
                  metadata: { ignored: true },
                },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_i18n_card",
    });

    expect(result).toEqual({
      messageId: "om_i18n_card",
      chatId: "oc_i18n_card",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "hello 2 tasks {{metadata}}",
      rawContent: expect.any(String),
      contentType: "interactive",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("falls back to post-format content when interactive card elements are empty", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_post_card",
            chat_id: "oc_post_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                elements: [],
                post: {
                  zh_cn: {
                    title: "Card summary",
                    content: [[{ tag: "md", text: "**fallback** body" }]],
                  },
                },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_post_card",
    });

    expect(result).toEqual({
      messageId: "om_post_card",
      chatId: "oc_post_card",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "Card summary\n\n**fallback** body",
      rawContent: expect.any(String),
      contentType: "interactive",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("extracts text content from post messages", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_post",
            chat_id: "oc_post",
            msg_type: "post",
            body: {
              content: JSON.stringify({
                zh_cn: {
                  title: "Summary",
                  content: [[{ tag: "text", text: "post body" }]],
                },
              }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_post",
    });

    expect(result).toEqual({
      messageId: "om_post",
      chatId: "oc_post",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "Summary\n\npost body",
      rawContent: expect.any(String),
      contentType: "post",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("returns text placeholder instead of raw JSON for unsupported message types", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_file",
            chat_id: "oc_file",
            msg_type: "file",
            body: {
              content: JSON.stringify({ file_key: "file_v3_123" }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_file",
    });

    expect(result).toEqual({
      messageId: "om_file",
      chatId: "oc_file",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "[file message]",
      rawContent: JSON.stringify({ file_key: "file_v3_123" }),
      contentType: "file",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("supports single-object response shape from Feishu API", async () => {
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        message_id: "om_single",
        chat_id: "oc_single",
        msg_type: "text",
        body: {
          content: JSON.stringify({ text: "single payload" }),
        },
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_single",
    });

    expect(result).toEqual({
      messageId: "om_single",
      chatId: "oc_single",
      chatType: undefined,
      senderId: undefined,
      senderOpenId: undefined,
      senderType: undefined,
      content: "single payload",
      rawContent: expect.any(String),
      contentType: "text",
      createTime: undefined,
      threadId: undefined,
    });
  });

  it("reuses the same content parsing for thread history messages", async () => {
    mockClientList.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_root",
            msg_type: "text",
            body: {
              content: JSON.stringify({ text: "root starter" }),
            },
          },
          {
            message_id: "om_card",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({
                body: {
                  elements: [{ tag: "markdown", content: "hello from card 2.0" }],
                },
              }),
            },
            sender: {
              id: "app_1",
              sender_type: "app",
            },
            create_time: "1710000000000",
          },
          {
            message_id: "om_file",
            msg_type: "file",
            body: {
              content: JSON.stringify({ file_key: "file_v3_123" }),
            },
            sender: {
              id: "ou_1",
              sender_type: "user",
            },
            create_time: "1710000001000",
          },
        ],
      },
    });

    const result = await listFeishuThreadMessages({
      cfg: {} as ClawdbotConfig,
      threadId: "omt_1",
      rootMessageId: "om_root",
    });

    expect(mockClientList).toHaveBeenCalledWith({
      params: {
        container_id_type: "thread",
        container_id: "omt_1",
        sort_type: "ByCreateTimeDesc",
        page_size: 21,
        card_msg_content_type: "user_card_content",
      },
    });
    expect(result).toEqual([
      {
        messageId: "om_file",
        senderId: "ou_1",
        senderType: "user",
        contentType: "file",
        content: "[file message]",
        createTime: 1710000001000,
      },
      {
        messageId: "om_card",
        senderId: "app_1",
        senderType: "app",
        contentType: "interactive",
        content: "hello from card 2.0",
        createTime: 1710000000000,
      },
    ]);
  });

  it("does not partially parse malformed thread history create_time values", async () => {
    mockClientList.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_text",
            msg_type: "text",
            body: {
              content: JSON.stringify({ text: "partial time" }),
            },
            sender: {
              id: "ou_1",
              sender_type: "user",
            },
            create_time: "1710000000000ms",
          },
        ],
      },
    });

    const result = await listFeishuThreadMessages({
      cfg: {} as ClawdbotConfig,
      threadId: "omt_1",
      rootMessageId: "om_root",
    });

    expect(result).toEqual([
      {
        messageId: "om_text",
        senderId: "ou_1",
        senderType: "user",
        contentType: "text",
        content: "partial time",
        createTime: undefined,
      },
    ]);
  });
});

describe("editMessageFeishu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeStores.clear();
    resetFeishuStreamingCardContentIndexForTests?.();
    mockResolveFeishuAccount.mockReturnValue({
      accountId: "default",
      configured: true,
    });
    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          patch: mockClientPatch,
        },
      },
    });
  });

  it("patches post content for text edits", async () => {
    mockRuntimeResolveMarkdownTableMode.mockImplementation(() => {
      throw new Error("Feishu runtime not initialized");
    });
    mockRuntimeConvertMarkdownTables.mockImplementation(() => {
      throw new Error("Feishu runtime not initialized");
    });
    mockClientPatch.mockResolvedValueOnce({ code: 0 });

    const result = await editMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_edit",
      text: "updated body",
    });

    expect(mockClientPatch).toHaveBeenCalledWith({
      path: { message_id: "om_edit" },
      data: {
        content: JSON.stringify({
          zh_cn: {
            content: [
              [
                {
                  tag: "md",
                  text: "updated body",
                },
              ],
            ],
          },
        }),
      },
    });
    expect(result).toEqual({ messageId: "om_edit", contentType: "post" });
  });

  it("patches interactive content for card edits", async () => {
    mockClientPatch.mockResolvedValueOnce({ code: 0 });

    const result = await editMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_card",
      card: { schema: "2.0" },
    });

    expect(mockClientPatch).toHaveBeenCalledWith({
      path: { message_id: "om_card" },
      data: {
        content: JSON.stringify({ schema: "2.0" }),
      },
    });
    expect(result).toEqual({ messageId: "om_card", contentType: "interactive" });
  });

  it("invalidates indexed card content when an interactive edit has no recoverable text", async () => {
    recordFeishuStreamingCardContent({
      messageId: "om_card_stale",
      accountId: "default",
      text: "stale card body",
    });
    recordLegacyFeishuStreamingCardContentForTests({
      messageId: "om_card_stale",
      accountId: "default",
      text: "legacy stale card body",
    });
    mockClientPatch.mockResolvedValueOnce({ code: 0 });

    await editMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_card_stale",
      card: { schema: "2.0" },
    });

    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          get: mockClientGet,
        },
      },
    });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_card_stale",
            chat_id: "oc_card_stale",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_stale" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_card_stale",
    });

    expect(result?.content).toBe("[Interactive Card]");
  });

  it("updates indexed card content when a card update supplies recoverable text", async () => {
    mockClientPatch.mockResolvedValueOnce({ code: 0 });

    await updateCardFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_card_update",
      card: { schema: "2.0" },
      chatId: "oc_card_update",
      recoverableText: "updated recoverable body",
    });

    mockCreateFeishuClient.mockReturnValue({
      im: {
        message: {
          get: mockClientGet,
        },
      },
    });
    mockClientGet.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_card_update",
            chat_id: "oc_card_update",
            msg_type: "interactive",
            body: {
              content: JSON.stringify({ type: "card", data: { card_id: "card_update" } }),
            },
          },
        ],
      },
    });

    const result = await getMessageFeishu({
      cfg: {} as ClawdbotConfig,
      messageId: "om_card_update",
    });

    expect(result?.content).toBe("updated recoverable body");
  });
});

describe("resolveFeishuCardTemplate", () => {
  it("accepts supported Feishu templates", () => {
    expect(resolveFeishuCardTemplate(" purple ")).toBe("purple");
  });

  it("drops unsupported free-form identity themes", () => {
    expect(resolveFeishuCardTemplate("space lobster")).toBeUndefined();
  });
});

function expectSchema2WidthConfig(card: unknown) {
  const typedCard = card as {
    config: {
      width_mode?: string;
      enable_forward?: boolean;
      wide_screen_mode?: boolean;
    };
  };

  expect(typedCard.config.width_mode).toBe("fill");
  expect(typedCard.config.enable_forward).toBeUndefined();
  expect(typedCard.config.wide_screen_mode).toBeUndefined();
}

describe("Feishu card schema config", () => {
  it.each([
    {
      name: "structured card",
      build: () => buildStructuredCard("hello"),
    },
    {
      name: "markdown card",
      build: () => buildMarkdownCard("hello"),
    },
  ])("$name uses schema-2.0 width config instead of legacy wide screen mode", ({ build }) => {
    expectSchema2WidthConfig(build());
  });
});

describe("buildStructuredCard", () => {
  it("falls back to blue when the header template is unsupported", () => {
    const card = buildStructuredCard("hello", {
      header: {
        title: "Agent",
        template: "space lobster",
      },
    });

    expect(card).toEqual({
      schema: "2.0",
      config: { width_mode: "fill" },
      body: { elements: [{ tag: "markdown", content: "hello" }] },
      header: {
        title: { tag: "plain_text", content: "Agent" },
        template: "blue",
      },
    });
  });
});
