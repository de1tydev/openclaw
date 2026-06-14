// Feishu tests cover native markdown table card rendering.
import { describe, expect, it } from "vitest";
import {
  buildFeishuMarkdownTableCards,
  containsFeishuMarkdownTable,
} from "./markdown-table-card.js";

function requireFirstCard(
  markdown: string,
  limits?: Parameters<typeof buildFeishuMarkdownTableCards>[1],
) {
  const cards = buildFeishuMarkdownTableCards(markdown, limits);
  expect(cards).not.toBeNull();
  return cards![0];
}

function cardElements(card: Record<string, unknown>): Record<string, unknown>[] {
  const body = card.body as { elements?: Record<string, unknown>[] };
  return body.elements ?? [];
}

describe("Feishu markdown table cards", () => {
  it("renders a simple pipe table as a native Feishu table element", () => {
    const rendered = requireFirstCard("| A | B |\n|---|---:|\n| 1 | 2 |");
    const table = cardElements(rendered.card)[0] as {
      tag?: string;
      columns?: Array<Record<string, unknown>>;
      rows?: Array<Record<string, unknown>>;
    };

    expect(table.tag).toBe("table");
    expect(table.columns).toEqual([
      expect.objectContaining({
        name: "col_0",
        display_name: "A",
        data_type: "lark_md",
        horizontal_align: "left",
      }),
      expect.objectContaining({
        name: "col_1",
        display_name: "B",
        data_type: "lark_md",
        horizontal_align: "right",
      }),
    ]);
    expect(table.rows).toEqual([{ col_0: "1", col_1: "2" }]);
  });

  it("preserves prose before and after a native table", () => {
    const rendered = requireFirstCard("Before\n\n| A |\n|---|\n| 1 |\n\nAfter");
    expect(cardElements(rendered.card)).toEqual([
      { tag: "markdown", content: "Before" },
      expect.objectContaining({ tag: "table" }),
      { tag: "markdown", content: "After" },
    ]);
    expect(rendered.recoverableText).toContain("Before");
    expect(rendered.recoverableText).toContain("After");
  });

  it("does not split escaped pipes or pipes inside inline code", () => {
    const rendered = requireFirstCard("| A | B |\n|---|---|\n| a \\| b | `x | y` |");
    const table = cardElements(rendered.card)[0] as { rows?: Array<Record<string, unknown>> };

    expect(table.rows).toEqual([{ col_0: "a | b", col_1: "`x | y`" }]);
  });

  it("ignores tables inside fenced and indented code", () => {
    const fenced = "```md\n| A | B |\n|---|---|\n| 1 | 2 |\n```";
    const indented = "    | A | B |\n    |---|---|\n    | 1 | 2 |";

    expect(containsFeishuMarkdownTable(fenced)).toBe(false);
    expect(containsFeishuMarkdownTable(indented)).toBe(false);
    expect(buildFeishuMarkdownTableCards(fenced)).toBeNull();
    expect(buildFeishuMarkdownTableCards(indented)).toBeNull();
  });

  it("falls back when a table exceeds the configured column cap", () => {
    const rendered = buildFeishuMarkdownTableCards("| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |", {
      limits: { maxColumns: 2 },
    });

    expect(rendered).toBeNull();
  });

  it("splits more than five tables into multiple cards", () => {
    const table = "| A |\n|---|\n| 1 |";
    const markdown = Array.from({ length: 6 }, () => table).join("\n\n");
    const cards = buildFeishuMarkdownTableCards(markdown);

    expect(cards).not.toBeNull();
    expect(cards).toHaveLength(2);
    expect(cardElements(cards![0].card).filter((element) => element.tag === "table")).toHaveLength(
      5,
    );
    expect(cardElements(cards![1].card).filter((element) => element.tag === "table")).toHaveLength(
      1,
    );
  });

  it("splits oversized table row sets by payload bytes", () => {
    const rows = Array.from({ length: 8 }, (_, index) => `| row-${index} | ${"x".repeat(80)} |`);
    const markdown = ["| Name | Value |", "|---|---|", ...rows].join("\n");
    const cards = buildFeishuMarkdownTableCards(markdown, {
      limits: { maxPayloadBytes: 1_250 },
    });

    expect(cards).not.toBeNull();
    expect(cards!.length).toBeGreaterThan(1);
    expect(cards!.every((card) => card.payloadBytes <= 1_250)).toBe(true);
  });
});
