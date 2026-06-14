// Feishu plugin module implements native markdown table card rendering.

export type FeishuMarkdownTableCard = {
  card: Record<string, unknown>;
  recoverableText: string;
  payloadBytes: number;
};

type FeishuTableAlignment = "left" | "center" | "right";

type TableSegment = {
  kind: "table";
  headers: string[];
  alignments: FeishuTableAlignment[];
  rows: string[][];
  source: string;
};

type ProseSegment = {
  kind: "prose";
  text: string;
};

type MarkdownTableSegment = TableSegment | ProseSegment;

type BuildFeishuMarkdownTableCardOptions = {
  header?: {
    title: string;
    template?: string;
  };
  note?: string;
  limits?: Partial<FeishuMarkdownTableCardLimits>;
};

type FeishuMarkdownTableCardLimits = {
  maxTablesPerCard: number;
  maxColumns: number;
  maxPayloadBytes: number;
  pageSize: number;
  maxCards: number;
};

const DEFAULT_LIMITS: FeishuMarkdownTableCardLimits = {
  maxTablesPerCard: 5,
  maxColumns: 15,
  maxPayloadBytes: 30_000,
  pageSize: 10,
  maxCards: 8,
};

const TABLE_SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

function resolveLimits(
  overrides: BuildFeishuMarkdownTableCardOptions["limits"],
): FeishuMarkdownTableCardLimits {
  return {
    ...DEFAULT_LIMITS,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(
        ([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    ),
  };
}

function jsonPayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isIndentedCodeLine(line: string): boolean {
  return line.startsWith("    ") || line.startsWith("\t");
}

function resolveMarkdownFence(line: string, currentFence: string): string {
  const stripped = line.trim();
  if (currentFence) {
    const marker = currentFence[0];
    const minLength = currentFence.length;
    const closeRe =
      marker === "`"
        ? new RegExp("^`{" + minLength + ",}\\s*$")
        : new RegExp("^~{" + minLength + ",}\\s*$");
    return closeRe.test(stripped) ? "" : currentFence;
  }
  const match = /^ {0,3}(`{3,}|~{3,})([^`~]*)\s*$/.exec(line);
  return match?.[1] ?? "";
}

function scanMarkdownTableRow(line: string): { cells: string[]; delimiterCount: number } {
  let stripped = line.trim();
  const hasOpeningBoundary = stripped.startsWith("|");
  const hasClosingBoundary = stripped.endsWith("|") && !stripped.endsWith("\\|");
  let delimiterCount = hasOpeningBoundary || hasClosingBoundary ? 1 : 0;
  if (hasOpeningBoundary) {
    stripped = stripped.slice(1);
  }
  if (hasClosingBoundary) {
    stripped = stripped.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let codeDelimiter = "";
  for (let index = 0; index < stripped.length; ) {
    const char = stripped[index];
    if (char === "\\") {
      const next = stripped[index + 1];
      if (next === "|") {
        current += "|";
        index += 2;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (char === "`") {
      let end = index;
      while (stripped[end] === "`") {
        end += 1;
      }
      const run = stripped.slice(index, end);
      current += run;
      codeDelimiter = codeDelimiter ? (run === codeDelimiter ? "" : codeDelimiter) : run;
      index = end;
      continue;
    }

    if (char === "|" && !codeDelimiter) {
      cells.push(current.trim());
      current = "";
      delimiterCount += 1;
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }
  cells.push(current.trim());
  return { cells, delimiterCount };
}

function splitMarkdownTableRow(line: string): string[] {
  return scanMarkdownTableRow(line).cells;
}

function hasMarkdownTableDelimiter(line: string): boolean {
  return scanMarkdownTableRow(line).delimiterCount > 0;
}

function parseMarkdownTableSeparator(line: string): FeishuTableAlignment[] | null {
  const cells = splitMarkdownTableRow(line);
  if (
    cells.length === 0 ||
    !cells.every((cell) => TABLE_SEPARATOR_CELL_RE.test(cell.replace(/ /g, "")))
  ) {
    return null;
  }
  return cells.map((cell) => {
    const compact = cell.replace(/ /g, "");
    if (compact.startsWith(":") && compact.endsWith(":")) {
      return "center";
    }
    if (compact.endsWith(":")) {
      return "right";
    }
    return "left";
  });
}

function normalizeTableRow(cells: string[], width: number): string[] {
  if (cells.length < width) {
    return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
  }
  if (cells.length > width) {
    return [...cells.slice(0, width - 1), cells.slice(width - 1).join(" | ")];
  }
  return cells;
}

function flushProse(segments: MarkdownTableSegment[], proseLines: string[]): void {
  const text = proseLines.join("\n").trim();
  if (text) {
    segments.push({ kind: "prose", text });
  }
  proseLines.length = 0;
}

function parseMarkdownTableSegments(markdown: string): MarkdownTableSegment[] {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const segments: MarkdownTableSegment[] = [];
  const proseLines: string[] = [];
  let fence = "";
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextFence = resolveMarkdownFence(line, fence);
    if (fence || nextFence) {
      fence = nextFence;
      proseLines.push(line);
      index += 1;
      continue;
    }

    if (isIndentedCodeLine(line)) {
      proseLines.push(line);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length) {
      const alignments = parseMarkdownTableSeparator(lines[index + 1] ?? "");
      const headerCells = splitMarkdownTableRow(line);
      if (
        alignments &&
        hasMarkdownTableDelimiter(line) &&
        headerCells.length === alignments.length
      ) {
        flushProse(segments, proseLines);
        const width = headerCells.length;
        const tableLines = [line, lines[index + 1] ?? ""];
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length) {
          const rowLine = lines[index] ?? "";
          if (!rowLine.trim() || !hasMarkdownTableDelimiter(rowLine)) {
            break;
          }
          tableLines.push(rowLine);
          rows.push(normalizeTableRow(splitMarkdownTableRow(rowLine), width));
          index += 1;
        }
        segments.push({
          kind: "table",
          headers: normalizeTableRow(headerCells, width),
          alignments: normalizeTableRow(alignments, width) as FeishuTableAlignment[],
          rows,
          source: tableLines.join("\n").trim(),
        });
        continue;
      }
    }

    proseLines.push(line);
    index += 1;
  }

  flushProse(segments, proseLines);
  return segments;
}

function countTables(segments: MarkdownTableSegment[]): number {
  return segments.filter((segment) => segment.kind === "table").length;
}

function segmentSource(segment: MarkdownTableSegment): string {
  return segment.kind === "table" ? segment.source : segment.text;
}

function truncateSummary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 120 ? clean : `${clean.slice(0, 117)}...`;
}

function buildFeishuTableElement(
  table: TableSegment,
  limits: FeishuMarkdownTableCardLimits,
): Record<string, unknown> {
  const columns = table.headers.map((header, index) => ({
    name: `col_${index}`,
    display_name: header,
    data_type: "lark_md",
    width: "auto",
    vertical_align: "top",
    horizontal_align: table.alignments[index] ?? "left",
  }));
  const rows = table.rows.map((row) =>
    Object.fromEntries(row.map((value, index) => [`col_${index}`, value])),
  );
  return {
    tag: "table",
    page_size: Math.min(10, Math.max(1, Math.floor(limits.pageSize))),
    row_height: "low",
    freeze_first_column: false,
    header_style: {
      text_align: "left",
      text_size: "normal",
      background_style: "grey",
      text_color: "default",
      bold: true,
      lines: 1,
    },
    columns,
    rows,
  };
}

function createFeishuTableCard(
  segments: MarkdownTableSegment[],
  options: BuildFeishuMarkdownTableCardOptions,
  limits: FeishuMarkdownTableCardLimits,
): FeishuMarkdownTableCard | null {
  const elements: Record<string, unknown>[] = [];
  for (const segment of segments) {
    if (segment.kind === "prose") {
      elements.push({ tag: "markdown", content: segment.text });
    } else {
      if (segment.headers.length === 0 || segment.headers.length > limits.maxColumns) {
        return null;
      }
      elements.push(buildFeishuTableElement(segment, limits));
    }
  }
  if (options.note) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: `<font color='grey'>${options.note}</font>` });
  }
  if (elements.length === 0) {
    return null;
  }

  const recoverableText = segments.map(segmentSource).join("\n\n").trim();
  const card: Record<string, unknown> = {
    schema: "2.0",
    config: {
      width_mode: "fill",
      ...(recoverableText ? { summary: { content: truncateSummary(recoverableText) } } : {}),
    },
    ...(options.header?.title
      ? {
          header: {
            title: { tag: "plain_text", content: options.header.title },
            ...(options.header.template ? { template: options.header.template } : {}),
          },
        }
      : {}),
    body: { elements },
  };
  return {
    card,
    recoverableText,
    payloadBytes: jsonPayloadBytes(card),
  };
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function markdownSeparatorForAlignment(alignment: FeishuTableAlignment): string {
  if (alignment === "center") {
    return ":---:";
  }
  if (alignment === "right") {
    return "---:";
  }
  return "---";
}

function formatMarkdownTableRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`;
}

function buildTableChunkSource(table: TableSegment, rows: string[][]): string {
  return [
    formatMarkdownTableRow(table.headers),
    formatMarkdownTableRow(table.alignments.map(markdownSeparatorForAlignment)),
    ...rows.map(formatMarkdownTableRow),
  ].join("\n");
}

function createTableOnlyCard(
  table: TableSegment,
  rows: string[][],
  options: BuildFeishuMarkdownTableCardOptions,
  limits: FeishuMarkdownTableCardLimits,
): FeishuMarkdownTableCard | null {
  return createFeishuTableCard(
    [
      {
        ...table,
        rows,
        source: buildTableChunkSource(table, rows),
      },
    ],
    options,
    limits,
  );
}

function splitOversizeTable(
  table: TableSegment,
  options: BuildFeishuMarkdownTableCardOptions,
  limits: FeishuMarkdownTableCardLimits,
): FeishuMarkdownTableCard[] | null {
  if (table.rows.length === 0) {
    const card = createTableOnlyCard(table, [], options, limits);
    return card && card.payloadBytes <= limits.maxPayloadBytes ? [card] : null;
  }

  const cards: FeishuMarkdownTableCard[] = [];
  let start = 0;
  while (start < table.rows.length) {
    let low = 1;
    let high = table.rows.length - start;
    let bestCount = 0;
    let bestCard: FeishuMarkdownTableCard | null = null;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = createTableOnlyCard(
        table,
        table.rows.slice(start, start + count),
        options,
        limits,
      );
      if (candidate && candidate.payloadBytes <= limits.maxPayloadBytes) {
        bestCount = count;
        bestCard = candidate;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (!bestCard || bestCount === 0) {
      return null;
    }
    cards.push(bestCard);
    start += bestCount;
    if (cards.length > limits.maxCards) {
      return null;
    }
  }
  return cards;
}

export function containsFeishuMarkdownTable(markdown: string): boolean {
  return parseMarkdownTableSegments(markdown).some((segment) => segment.kind === "table");
}

export function buildFeishuMarkdownTableCards(
  markdown: string,
  options: BuildFeishuMarkdownTableCardOptions = {},
): FeishuMarkdownTableCard[] | null {
  const limits = resolveLimits(options.limits);
  const segments = parseMarkdownTableSegments(markdown);
  if (!segments.some((segment) => segment.kind === "table")) {
    return null;
  }
  if (
    segments.some(
      (segment) => segment.kind === "table" && segment.headers.length > limits.maxColumns,
    )
  ) {
    return null;
  }

  const cards: FeishuMarkdownTableCard[] = [];
  let current: MarkdownTableSegment[] = [];

  const flushCurrent = (): boolean => {
    if (current.length === 0) {
      return true;
    }
    const card = createFeishuTableCard(current, options, limits);
    if (!card || card.payloadBytes > limits.maxPayloadBytes) {
      return false;
    }
    cards.push(card);
    current = [];
    return cards.length <= limits.maxCards;
  };

  for (const segment of segments) {
    if (segment.kind === "table" && countTables(current) >= limits.maxTablesPerCard) {
      if (!flushCurrent()) {
        return null;
      }
    }

    const candidateSegments = [...current, segment];
    const candidate = createFeishuTableCard(candidateSegments, options, limits);
    if (candidate && candidate.payloadBytes <= limits.maxPayloadBytes) {
      current = candidateSegments;
      continue;
    }

    if (current.length > 0) {
      if (!flushCurrent()) {
        return null;
      }
      const single = createFeishuTableCard([segment], options, limits);
      if (single && single.payloadBytes <= limits.maxPayloadBytes) {
        current = [segment];
        continue;
      }
    }

    if (segment.kind === "table") {
      const splitCards = splitOversizeTable(segment, options, limits);
      if (!splitCards) {
        return null;
      }
      cards.push(...splitCards);
      if (cards.length > limits.maxCards) {
        return null;
      }
      current = [];
      continue;
    }

    return null;
  }

  if (!flushCurrent()) {
    return null;
  }
  return cards.length > 0 ? cards : null;
}
