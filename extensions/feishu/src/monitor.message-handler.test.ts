// Feishu tests cover monitor.message handler plugin behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClawdbotConfig, PluginRuntime } from "../runtime-api.js";
import type { FeishuMessageEvent } from "./event-types.js";
import { createFeishuMessageReceiveHandler } from "./monitor.message-handler.js";
import { testingHooks } from "./processing-claims.js";

type MessageReceiveHandlerContext = Parameters<typeof createFeishuMessageReceiveHandler>[0];
type HandleMessageParams = Parameters<MessageReceiveHandlerContext["handleMessage"]>[0];

function createTextEvent(params: {
  messageId: string;
  senderOpenId: string;
  senderType: "bot" | "user";
}): FeishuMessageEvent {
  return {
    sender: {
      sender_id: { open_id: params.senderOpenId },
      sender_type: params.senderType,
    },
    message: {
      message_id: params.messageId,
      chat_id: "oc_chat_1",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
    },
  };
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  if (!resolve || !reject) {
    throw new Error("Expected deferred controls to be initialized");
  }
  return { promise, resolve, reject };
}

function createHandler(overrides: Partial<MessageReceiveHandlerContext> = {}) {
  let onFlush: ((entries: FeishuMessageEvent[]) => Promise<void>) | undefined;
  const enqueue = vi.fn(async (event: FeishuMessageEvent) => {
    await onFlush?.([event]);
  });
  const log = vi.fn();
  const error = vi.fn();
  const channelRuntime = {
    commands: {
      isControlCommandMessage: () => false,
    },
    debounce: {
      resolveInboundDebounceMs: () => 0,
      createInboundDebouncer: vi.fn((params: { onFlush: typeof onFlush }) => {
        onFlush = params.onFlush;
        return { enqueue };
      }),
    },
  } as unknown as PluginRuntime["channel"];
  const handleMessage = vi.fn(async (_params: HandleMessageParams) => {});
  const hasProcessedMessage = vi.fn(async () => false);

  const handler = createFeishuMessageReceiveHandler({
    cfg: {} as ClawdbotConfig,
    channelRuntime,
    accountId: "default",
    chatHistories: new Map(),
    handleMessage,
    resolveDebounceText: () => "hello",
    hasProcessedMessage,
    recordProcessedMessage: vi.fn(async () => true),
    getBotOpenId: () => "ou_bot",
    runtime: { log, error } as unknown as MessageReceiveHandlerContext["runtime"],
    ...overrides,
  });

  return { handler, handleMessage, enqueue, hasProcessedMessage, log, error };
}

afterEach(() => {
  testingHooks.resetFeishuMessageProcessingClaimsForTests();
  vi.restoreAllMocks();
});

describe("createFeishuMessageReceiveHandler self-message filtering", () => {
  it("drops the current bot before debounce and processing claims", async () => {
    const { handler, handleMessage, enqueue } = createHandler();

    await handler(
      createTextEvent({
        messageId: "om_reused",
        senderOpenId: "ou_bot",
        senderType: "bot",
      }),
    );
    await handler(
      createTextEvent({
        messageId: "om_reused",
        senderOpenId: "ou_user",
        senderType: "user",
      }),
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(handleMessage.mock.calls[0]?.[0]?.event.sender.sender_id.open_id).toBe("ou_user");
  });

  it("keeps peer bot and user messages flowing to dispatch", async () => {
    const { handler, handleMessage, enqueue } = createHandler();

    await handler(
      createTextEvent({
        messageId: "om_other_bot",
        senderOpenId: "ou_other_bot",
        senderType: "bot",
      }),
    );
    await handler(
      createTextEvent({
        messageId: "om_user",
        senderOpenId: "ou_user",
        senderType: "user",
      }),
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(handleMessage).toHaveBeenCalledTimes(2);
    expect(
      handleMessage.mock.calls.map(([params]) => params.event.sender.sender_id.open_id),
    ).toEqual(["ou_other_bot", "ou_user"]);
  });
});

describe("createFeishuMessageReceiveHandler persistent inbound dedupe", () => {
  it("drops already processed messages before enqueue and releases the claim for retries", async () => {
    const hasProcessedMessage = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { handler, handleMessage, enqueue } = createHandler({ hasProcessedMessage });
    const event = createTextEvent({
      messageId: "om_persistent_duplicate_then_retry",
      senderOpenId: "ou_user",
      senderType: "user",
    });

    await handler(event);

    expect(hasProcessedMessage).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(0);
    expect(handleMessage).toHaveBeenCalledTimes(0);

    await handler(event);

    expect(hasProcessedMessage).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });

  it("drops duplicate deliveries while the persistent dedupe check is in flight", async () => {
    const persistentCheck = createDeferred<boolean>();
    const hasProcessedMessage = vi.fn(() => persistentCheck.promise);
    const { handler, handleMessage, enqueue } = createHandler({ hasProcessedMessage });
    const event = createTextEvent({
      messageId: "om_inflight_persistent_check",
      senderOpenId: "ou_user",
      senderType: "user",
    });

    const first = handler(event);
    await Promise.resolve();
    await handler(event);

    expect(hasProcessedMessage).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(0);
    expect(handleMessage).toHaveBeenCalledTimes(0);

    persistentCheck.resolve(false);
    await first;

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });

  it("releases the processing claim when the persistent dedupe check fails", async () => {
    const hasProcessedMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("dedupe store unavailable"))
      .mockResolvedValueOnce(false);
    const { handler, handleMessage, enqueue, error } = createHandler({ hasProcessedMessage });
    const event = createTextEvent({
      messageId: "om_persistent_check_error",
      senderOpenId: "ou_user",
      senderType: "user",
    });

    await handler(event);

    expect(hasProcessedMessage).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(0);
    expect(handleMessage).toHaveBeenCalledTimes(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        "feishu[default]: error handling message: Error: dedupe store unavailable",
      ),
    );

    await handler(event);

    expect(hasProcessedMessage).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});
