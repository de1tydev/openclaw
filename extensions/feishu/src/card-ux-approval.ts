import type {
  ExecApprovalDecision,
  PluginApprovalRequest,
  PluginApprovalResolved,
} from "openclaw/plugin-sdk/approval-runtime";
import {
  buildPluginApprovalPendingReplyPayload,
  buildPluginApprovalResolvedReplyPayload,
} from "openclaw/plugin-sdk/approval-runtime";
// Feishu plugin module implements card ux approval behavior.
import type { OpenClawConfig, ReplyPayload } from "../runtime-api.js";
import { normalizeFeishuTarget, resolveReceiveIdType } from "./targets.js";

const DEFAULT_PLUGIN_DECISIONS = ["allow-once", "allow-always", "deny"] as const;

function resolveAllowedDecisions(
  allowedDecisions?: readonly string[] | null,
): readonly ExecApprovalDecision[] {
  if (!allowedDecisions?.length) {
    return DEFAULT_PLUGIN_DECISIONS;
  }
  const seen = new Set<ExecApprovalDecision>();
  const result: ExecApprovalDecision[] = [];
  for (const d of allowedDecisions) {
    if ((d === "allow-once" || d === "allow-always" || d === "deny") && !seen.has(d)) {
      seen.add(d);
      result.push(d);
    }
  }
  return result.length > 0 ? result : DEFAULT_PLUGIN_DECISIONS;
}
import { createFeishuCardInteractionEnvelope } from "./card-interaction.js";
import { buildFeishuCardButton, buildFeishuCardInteractionContext } from "./card-ux-shared.js";

export const FEISHU_APPROVAL_REQUEST_ACTION = "feishu.quick_actions.request_approval";
export const FEISHU_APPROVAL_CONFIRM_ACTION = "feishu.approval.confirm";
export const FEISHU_APPROVAL_CANCEL_ACTION = "feishu.approval.cancel";

export function createApprovalCard(params: {
  operatorOpenId: string;
  chatId?: string;
  command: string;
  prompt: string;
  expiresAt: number;
  chatType?: "p2p" | "group";
  sessionKey?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Record<string, unknown> {
  const context = buildFeishuCardInteractionContext(params);

  return {
    schema: "2.0",
    config: {
      width_mode: "fill",
    },
    header: {
      title: {
        tag: "plain_text",
        content: "Confirm action",
      },
      template: "orange",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: params.prompt,
        },
        {
          tag: "action",
          actions: [
            buildFeishuCardButton({
              label: params.confirmLabel ?? "Confirm",
              type: "primary",
              value: createFeishuCardInteractionEnvelope({
                k: "quick",
                a: FEISHU_APPROVAL_CONFIRM_ACTION,
                q: params.command,
                c: context,
              }),
            }),
            buildFeishuCardButton({
              label: params.cancelLabel ?? "Cancel",
              value: createFeishuCardInteractionEnvelope({
                k: "button",
                a: FEISHU_APPROVAL_CANCEL_ACTION,
                c: context,
              }),
            }),
          ],
        },
      ],
    },
  };
}

const FEISHU_PLUGIN_APPROVAL_CONFIRM_ACTION = "feishu.plugin_approval.confirm";
const FEISHU_PLUGIN_APPROVAL_REJECT_ACTION = "feishu.plugin_approval.reject";

export function createPluginApprovalCard(params: {
  approvalId: string;
  title: string;
  description: string;
  toolName?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  expiresAtMs: number;
  nowMs: number;
  allowedDecisions: readonly string[];
  sessionKey?: string | null;
  chatId?: string;
  chatType?: "p2p" | "group";
  operatorOpenId?: string;
}): Record<string, unknown> {
  const {
    approvalId,
    title,
    description,
    toolName,
    pluginId,
    agentId,
    expiresAtMs,
    nowMs,
    allowedDecisions,
    sessionKey,
    chatId,
    chatType,
    operatorOpenId,
  } = params;

  const icon = "\u{1F6E1}\u{FE0F}";
  const expiresIn = Math.max(0, Math.round((expiresAtMs - nowMs) / 1000));

  const mdLines: string[] = [];
  mdLines.push(`**${icon} Plugin approval required**`);
  mdLines.push("");
  mdLines.push(`**${title}**`);
  mdLines.push(description);
  if (toolName) {
    mdLines.push("Tool: `" + toolName + "`");
  }
  if (pluginId) {
    mdLines.push(`Plugin: ${pluginId}`);
  }
  if (agentId) {
    mdLines.push(`Agent: ${agentId}`);
  }
  mdLines.push("ID: `" + approvalId + "`");
  mdLines.push(`Expires in: ${expiresIn}s`);

  const context = buildFeishuCardInteractionContext({
    operatorOpenId: operatorOpenId ?? "",
    chatId,
    expiresAt: expiresAtMs,
    chatType,
    sessionKey: sessionKey ?? undefined,
  });
  const metadata = {
    approvalId,
    allowedDecisions: allowedDecisions.join(","),
  };

  const actions: Array<Record<string, unknown>> = [];
  for (const decision of allowedDecisions) {
    if (decision === "deny") {
      actions.push(
        buildFeishuCardButton({
          label: "\u274C Reject",
          type: "danger",
          value: createFeishuCardInteractionEnvelope({
            k: "plugin_approval",
            a: FEISHU_PLUGIN_APPROVAL_REJECT_ACTION,
            q: `/approve ${approvalId} deny`,
            m: metadata,
            c: context,
          }),
        }),
      );
    } else {
      const label = decision === "allow-always" ? "\u2705 Approve always" : "\u2705 Approve";
      actions.push(
        buildFeishuCardButton({
          label,
          type: "primary",
          value: createFeishuCardInteractionEnvelope({
            k: "plugin_approval",
            a: FEISHU_PLUGIN_APPROVAL_CONFIRM_ACTION,
            q: `/approve ${approvalId} ${decision}`,
            m: metadata,
            c: context,
          }),
        }),
      );
    }
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      title: { tag: "plain_text", content: `${icon} Plugin approval required` },
      template: "orange",
    },
    body: {
      elements: [
        { tag: "markdown", content: mdLines.join("\n") },
        { tag: "action", actions },
      ],
    },
  };
}

/** Build a Feishu-specific pending plugin approval card as a ReplyPayload. */
function buildFeishuPluginPendingPayload(params: {
  cfg: OpenClawConfig;
  request: PluginApprovalRequest;
  target: { channel: string; to: string };
  nowMs: number;
}): ReplyPayload {
  const { request, nowMs } = params;
  const allowedDecisions = resolveAllowedDecisions(request.request.allowedDecisions);
  const targetContext = resolvePluginApprovalTargetContext(params.target.to);
  const card = createPluginApprovalCard({
    approvalId: request.id,
    title: request.request.title,
    description: request.request.description,
    toolName: request.request.toolName,
    pluginId: request.request.pluginId,
    agentId: request.request.agentId,
    expiresAtMs: request.expiresAtMs,
    nowMs,
    allowedDecisions,
    sessionKey: request.request.sessionKey,
    ...targetContext,
  });
  return buildPluginApprovalPendingReplyPayload({
    request,
    nowMs,
    allowedDecisions,
    channelData: { feishu: { card } },
  });
}

function resolvePluginApprovalTargetContext(target: string): {
  operatorOpenId?: string;
  chatId?: string;
  chatType?: "p2p" | "group";
} {
  const normalized = normalizeFeishuTarget(target);
  if (!normalized) {
    return {};
  }
  const receiveIdType = resolveReceiveIdType(target);
  if (receiveIdType === "chat_id") {
    return {
      chatId: normalized,
      chatType: "group",
    };
  }
  if (receiveIdType === "open_id") {
    return {
      operatorOpenId: normalized,
      chatType: "p2p",
    };
  }
  return {};
}

/** Build a Feishu-specific resolved plugin approval text payload. */
function buildFeishuPluginResolvedPayload(params: {
  cfg: OpenClawConfig;
  resolved: PluginApprovalResolved;
  target: { channel: string; to: string };
}): ReplyPayload {
  return buildPluginApprovalResolvedReplyPayload({
    resolved: params.resolved,
  });
}

/** Plugin approval render adapter for the Feishu channel. */
export const feishuPluginApprovalRender = {
  buildPendingPayload: buildFeishuPluginPendingPayload,
  buildResolvedPayload: buildFeishuPluginResolvedPayload,
} satisfies {
  buildPendingPayload: (params: {
    cfg: OpenClawConfig;
    request: PluginApprovalRequest;
    target: { channel: string; to: string };
    nowMs: number;
  }) => ReplyPayload;
  buildResolvedPayload: (params: {
    cfg: OpenClawConfig;
    resolved: PluginApprovalResolved;
    target: { channel: string; to: string };
  }) => ReplyPayload;
};
