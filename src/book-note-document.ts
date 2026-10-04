import { formatLocalDateTime } from "./utils-core.ts";
import type { BookHighlight } from "./types.ts";
import {
  formatBlockquote,
  formatHighlightNoteBlock,
  isHighlightNoteBlockStart,
  HIGHLIGHT_SECTION_MARKER,
} from "./highlight-core.ts";

export interface HighlightCommentEntry {
  label: string;
  created: string;
  text: string;
}

export interface HighlightAiSection {
  title: string;
  text: string;
  links: string[];
}

export interface HighlightNoteDetails {
  quote: string;
  comment: string;
  commentEntries: HighlightCommentEntry[];
  aiSections: HighlightAiSection[];
}

export class HighlightContentConflictError extends Error {
  constructor() {
    super("这条划线的笔记已在其他位置修改。请重新打开后再编辑。");
    this.name = "HighlightContentConflictError";
  }
}

type HighlightDetailsSource = Pick<BookHighlight, "blockId"> & Partial<Pick<BookHighlight, "quote" | "comment">>;

function normalizeHeadingText(text: string): string {
  return (text || "").replace(/\s+/g, " ").replace(/#+\s*$/g, "").trim();
}

function getChapterTitle(highlight: BookHighlight): string {
  return normalizeHeadingText(highlight.chapterTitle || "未命名章节") || "未命名章节";
}

function getBlockRange(lines: string[], blockId: string): { startIndex: number; blockIndex: number } | null {
  const blockIndex = lines.findIndex((line) => line.trim() === `^${blockId}`);
  if (blockIndex < 0) return null;
  let startIndex = blockIndex;
  while (startIndex > 0 && !isHighlightNoteBlockStart(lines[startIndex] || "")) startIndex--;
  return isHighlightNoteBlockStart(lines[startIndex] || "") ? { startIndex, blockIndex } : null;
}

export function insertHighlightDocument(content: string, highlight: BookHighlight): string {
  const lines = content.trimEnd().split(/\r?\n/);
  const targetTitle = getChapterTitle(highlight);
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;
  let chapterIndex = -1;
  let chapterDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = (lines[i] || "").match(headingPattern);
    if (match && normalizeHeadingText(match[2] || "") === targetTitle) {
      chapterIndex = i;
      chapterDepth = (match[1] || "").length;
      break;
    }
  }

  const blockLines = formatHighlightNoteBlock(highlight).split("\n");
  if (chapterIndex < 0) {
    const insertLines = [`## ${targetTitle}`, "", ...blockLines];
    if (lines.length && (lines[lines.length - 1] || "").trim() !== "") insertLines.unshift("");
    lines.push(...insertLines);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  let chapterEnd = lines.length;
  for (let i = chapterIndex + 1; i < lines.length; i++) {
    const match = (lines[i] || "").match(headingPattern);
    if (match && (match[1] || "").length <= chapterDepth) {
      chapterEnd = i;
      break;
    }
  }
  const insertLines = [...blockLines];
  if (chapterEnd > 0 && (lines[chapterEnd - 1] || "").trim() !== "") insertLines.unshift("");
  lines.splice(chapterEnd, 0, ...insertLines);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function appendReflectionDocument(content: string, highlight: BookHighlight, reflection: string): string {
  const text = reflection.trim();
  if (!text) return content;
  const lines = content.split(/\r?\n/);
  const range = getBlockRange(lines, highlight.blockId);
  if (!range) return insertHighlightDocument(content, { ...highlight, comment: text });

  const count = readHighlightDetailsDocument(content, { blockId: highlight.blockId }).commentEntries.length;
  let insertIndex = range.blockIndex;
  for (let i = range.blockIndex - 1; i > range.startIndex; i--) {
    if (/^>\s*\*\*时间\*\*/.test(lines[i] || "")) {
      insertIndex = i;
      break;
    }
  }
  const label = count + 1 <= 1 ? "笔记" : `笔记 ${count + 1}`;
  const created = highlight.updated || new Date().toISOString();
  lines.splice(insertIndex, 0,
    ">",
    `> **${label}**`,
    `> created: ${formatLocalDateTime(created)}`,
    ">",
    ...formatBlockquote(text).split("\n"),
  );
  return lines.join("\n");
}

function normalizeBlockquoteLine(line: string): string {
  // Remove only the storage callout's prefix, preserving nested Markdown.
  return (line || "").replace(/^> ?/, "");
}

function fallbackEntries(comment: string): HighlightCommentEntry[] {
  return comment.trim().split(/\n{2,}/).map((text, index) => ({
    label: index === 0 ? "笔记" : `笔记 ${index + 1}`,
    created: "",
    text: text.trim(),
  })).filter((entry) => entry.text);
}

export function readHighlightDetailsDocument(content: string, highlight: HighlightDetailsSource): HighlightNoteDetails {
  const fallbackQuote = String(highlight.quote || "").trim();
  const fallbackComment = String(highlight.comment || "").trim();
  const fallback = fallbackEntries(fallbackComment);
  const lines = content.split(/\r?\n/);
  const range = getBlockRange(lines, highlight.blockId);
  if (!range) return { quote: fallbackQuote, comment: fallbackComment, commentEntries: fallback, aiSections: [] };

  const quoteLines: string[] = [];
  const entries: HighlightCommentEntry[] = [];
  const aiSections: HighlightAiSection[] = [];
  let currentEntry: HighlightCommentEntry | null = null;
  let currentSection: HighlightAiSection | null = null;
  let readingQuote = true;
  let sectionHeadingPending = false;
  let fence: { character: string; length: number } | null = null;

  const flushEntry = () => {
    if (currentEntry?.text.trim()) entries.push({ ...currentEntry, text: currentEntry.text.trim() });
    currentEntry = null;
  };
  const flushSection = () => {
    if (currentSection && (currentSection.text.trim() || currentSection.links.length)) {
      aiSections.push({ ...currentSection, text: currentSection.text.trim() });
    }
    currentSection = null;
  };

  for (let i = range.startIndex + 1; i < range.blockIndex; i++) {
    const rawLine = lines[i] || "";
    // A callout body must stay inside blockquotes. Ignore chapter-title text
    // that leaked onto plain lines from earlier multiline TOC titles.
    if (!/^\s*>/.test(rawLine)) continue;
    const line = normalizeBlockquoteLine(rawLine.trimStart());
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const fenceRun = fenceMatch?.[1] || "";
    if (fence || fenceMatch) {
      if (readingQuote) quoteLines.push(line);
      else if (currentEntry) currentEntry.text += `${line}\n`;
      else if (currentSection) currentSection.text += `${line}\n`;
      if (!fence && fenceMatch) {
        fence = { character: fenceRun.charAt(0), length: fenceRun.length };
      } else if (fence && fenceMatch && fenceRun.charAt(0) === fence.character
        && fenceRun.length >= fence.length && !(fenceMatch[2] || "").trim()) {
        fence = null;
      }
      continue;
    }
    if (line === HIGHLIGHT_SECTION_MARKER) {
      flushEntry();
      flushSection();
      readingQuote = false;
      sectionHeadingPending = true;
      continue;
    }
    const noteMatch = line.match(/^\*\*(?:想法|笔记)(?:\s+(\d+))?\*\*$/);
    const headingMatch = line.match(/^#{3}\s+(.+?)\s*$/);
    // Older relation sections have no marker. Other headings inside notes or
    // section content are ordinary Markdown, not generated section boundaries.
    const aiMatch: RegExpMatchArray | null = headingMatch && (sectionHeadingPending
      || (!currentEntry && !currentSection)
      || (headingMatch[1] === "关联文章" && /^\[\[/.test(normalizeBlockquoteLine(lines[i + 1] || ""))))
      ? headingMatch : null;
    if (readingQuote) {
      if (noteMatch || aiMatch || /^\*\*时间\*\*/.test(line)) readingQuote = false;
      else {
        quoteLines.push(line);
        continue;
      }
    }
    if (/^\*\*时间\*\*/.test(line)) {
      flushEntry();
      flushSection();
      break;
    }
    if (noteMatch) {
      flushEntry();
      flushSection();
      currentEntry = { label: noteMatch[1] ? `笔记 ${noteMatch[1]}` : "笔记", created: "", text: "" };
      continue;
    }
    if (aiMatch) {
      flushEntry();
      flushSection();
      currentSection = { title: (aiMatch[1] || "").trim(), text: "", links: [] };
      sectionHeadingPending = false;
      continue;
    }
    if (currentEntry) {
      if (/^created:\s*/i.test(line)) currentEntry.created = line.replace(/^created:\s*/i, "").trim();
      else currentEntry.text += `${line}\n`;
      continue;
    }
    if (currentSection) {
      const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => (match[1] || "").trim()).filter(Boolean);
      if (currentSection.title === "关联文章") {
        for (const link of links) {
          const time = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)?.[0];
          currentSection.links.push(time ? `${link}|${time}` : link);
        }
      } else {
        currentSection.links.push(...links);
        currentSection.text += `${line}\n`;
      }
    }
  }
  flushEntry();
  flushSection();
  const commentEntries = entries.length ? entries : fallback;
  return {
    quote: quoteLines.join("\n").trim() || fallbackQuote,
    comment: commentEntries.map((entry) => entry.text).filter(Boolean).join("\n\n"),
    commentEntries,
    aiSections,
  };
}

export function replaceHighlightDocument(content: string, highlight: BookHighlight): string {
  const lines = content.split(/\r?\n/);
  const range = getBlockRange(lines, highlight.blockId);
  if (!range) return insertHighlightDocument(content, highlight);
  lines.splice(range.startIndex, range.blockIndex - range.startIndex + 1, ...formatHighlightNoteBlock(highlight).split("\n"));
  return lines.join("\n");
}

export function replaceHighlightDocumentIfUnchanged(
  content: string,
  highlight: BookHighlight,
  expected: Pick<HighlightNoteDetails, "quote" | "commentEntries" | "aiSections">,
): string {
  if (!getBlockRange(content.split(/\r?\n/), highlight.blockId)) throw new HighlightContentConflictError();
  const current = readHighlightDetailsDocument(content, highlight);
  const same = current.quote === expected.quote
    && JSON.stringify(current.commentEntries) === JSON.stringify(expected.commentEntries)
    && JSON.stringify(current.aiSections) === JSON.stringify(expected.aiSections);
  if (!same) throw new HighlightContentConflictError();
  return replaceHighlightDocument(content, highlight);
}

export function deleteHighlightDocument(content: string, blockId: string): string {
  const lines = content.split(/\r?\n/);
  const range = getBlockRange(lines, blockId);
  if (!range) return content;
  let deleteEnd = range.blockIndex + 1;
  while (deleteEnd < lines.length && (lines[deleteEnd] || "").trim() === "") deleteEnd++;
  lines.splice(range.startIndex, deleteEnd - range.startIndex);
  return `${lines.join("\n").trimEnd()}\n`;
}
