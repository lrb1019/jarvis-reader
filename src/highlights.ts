// Extracted from main.js L48752-48928 — highlight data operations + TOC generation

import { loadPdfJs, App, TFile } from "obsidian";
import { formatLocalDateTime } from "./utils-core.ts";
import type { BookHighlight, JarvisReaderSettings } from "./types";
import { buildHighlightMetadata, dedupeHighlightsByCfi, formatBlockquote, formatHighlightNoteBlock, isHighlightNoteBlockStart } from "./highlight-core";

export function createHighlightId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export { buildHighlightMetadata, dedupeHighlightsByCfi, formatBlockquote, formatHighlightNoteBlock, isHighlightNoteBlockStart };

function normalizeHeadingText(text: string): string {
  return (text || "").replace(/\s+/g, " ").replace(/#+\s*$/g, "").trim();
}

function getHighlightChapterHeadingText(highlight: BookHighlight): string {
  return normalizeHeadingText(highlight.chapterTitle || "\u672a\u547d\u540d\u7ae0\u8282") || "\u672a\u547d\u540d\u7ae0\u8282";
}

function getFallbackHighlightChapterHeading(highlight: BookHighlight): string {
  const title = (highlight.chapterTitle || "\u672a\u547d\u540d\u7ae0\u8282").replace(/\s+/g, " ").trim() || "\u672a\u547d\u540d\u7ae0\u8282";
  return `## ${title}`;
}

function insertHighlightInChapter(content: string, highlight: BookHighlight): string {
  const lines = content.trimEnd().split(/\r?\n/);
  const targetTitle = getHighlightChapterHeadingText(highlight);
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;
  let chapterIndex = -1;
  let chapterDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingPattern);
    if (!match)
      continue;
    const headingText = normalizeHeadingText(match[2]);
    if (headingText === targetTitle) {
      chapterIndex = i;
      chapterDepth = match[1].length;
      break;
    }
  }
  const blockLines = formatHighlightNoteBlock(highlight).split("\n");
  if (chapterIndex < 0) {
    const insertLines = [getFallbackHighlightChapterHeading(highlight), "", ...blockLines];
    if (lines.length && lines[lines.length - 1].trim() !== "")
      insertLines.unshift("");
    lines.push(...insertLines);
    return `${lines.join("\n").trimEnd()}
`;
  }
  let chapterEnd = lines.length;
  for (let i = chapterIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(headingPattern);
    if (match && match[1].length <= chapterDepth) {
      chapterEnd = i;
      break;
    }
  }
  const insertLines = [...blockLines];
  if (chapterEnd > 0 && lines[chapterEnd - 1].trim() !== "") {
    insertLines.unshift("");
  }
  lines.splice(chapterEnd, 0, ...insertLines);
  return `${lines.join("\n").trimEnd()}
`;
}

export async function appendHighlightToBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  const nextContent = insertHighlightInChapter(content, highlight);
  await app.vault.modify(noteFile, nextContent);
}

function getHighlightNoteBlockRange(lines: string[], blockId: string): { startIndex: number; blockIndex: number } | null {
  const blockIndex = lines.findIndex((line) => line.trim() === `^${blockId}`);
  if (blockIndex < 0)
    return null;
  let startIndex = blockIndex;
  while (startIndex > 0 && !isHighlightNoteBlockStart(lines[startIndex])) {
    startIndex--;
  }
  if (!isHighlightNoteBlockStart(lines[startIndex]))
    return null;
  return { startIndex, blockIndex };
}

function isHighlightTimestampLine(line: string): boolean {
  return /^>\s*\*\*\u65f6\u95f4\*\*/.test(line || "");
}

function getReflectionCount(lines: string[], startIndex: number, blockIndex: number): number {
  let count = 0;
  for (let i = startIndex; i <= blockIndex; i++) {
    if (/^>\s*\*\*(?:\u60f3\u6cd5|笔记)(?:\s+\d+)?\*\*/.test(lines[i] || ""))
      count++;
  }
  return count;
}

export async function appendReflectionToBookNote(app: App, noteFile: TFile, highlight: BookHighlight, reflection: string): Promise<void> {
  const text = (reflection || "").trim();
  if (!text)
    return;
  const content = await app.vault.read(noteFile);
  const lines = content.split(/\r?\n/);
  const range = getHighlightNoteBlockRange(lines, highlight.blockId);
  if (!range) {
    await appendHighlightToBookNote(app, noteFile, { ...highlight, comment: text });
    return;
  }
  const currentCount = getReflectionCount(lines, range.startIndex, range.blockIndex);
  const nextNumber = currentCount + 1;
  let insertIndex = range.blockIndex;
  for (let i = range.blockIndex - 1; i > range.startIndex; i--) {
    if (isHighlightTimestampLine(lines[i])) {
      insertIndex = i;
      break;
    }
  }
  const label = nextNumber <= 1 ? "笔记" : `笔记 ${nextNumber}`;
  const created = highlight.updated || new Date().toISOString();
  const insertLines = [
    ">",
    `> **${label}**`,
    `> created: ${formatLocalDateTime(created)}`,
    ">",
    ...formatBlockquote(text).split("\n")
  ];
  lines.splice(insertIndex, 0, ...insertLines);
  await app.vault.modify(noteFile, lines.join("\n"));
}
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
  comment: string;
  commentEntries: HighlightCommentEntry[];
  aiSections: HighlightAiSection[];
}

function normalizeBlockquoteLine(line: string): string {
  return (line || "").replace(/^> ?/, "").trimEnd();
}

function pushCommentEntry(entries: HighlightCommentEntry[], entry: HighlightCommentEntry | null): void {
  if (!entry)
    return;
  const text = entry.text.trim();
  if (!text)
    return;
  entries.push({ ...entry, text });
}

function pushAiSection(sections: HighlightAiSection[], section: HighlightAiSection | null): void {
  if (!section)
    return;
  const text = section.text.trim();
  const links = section.links.filter(Boolean);
  if (!text && !links.length)
    return;
  sections.push({ ...section, text, links });
}

function getFallbackCommentEntries(comment: string): HighlightCommentEntry[] {
  return (comment || "").trim().split(/\n{2,}/).map((text, index) => ({
    label: index === 0 ? "笔记" : `笔记 ${index + 1}`,
    created: "",
    text: text.trim()
  })).filter((entry) => entry.text);
}

export async function readHighlightNoteDetailsFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<HighlightNoteDetails> {
  const fallbackComment = (highlight.comment || "").trim();
  const fallbackEntries = getFallbackCommentEntries(fallbackComment);
  const content = await app.vault.read(noteFile);
  const lines = content.split(/\r?\n/);
  const range = getHighlightNoteBlockRange(lines, highlight.blockId);
  if (!range)
    return { comment: fallbackComment, commentEntries: fallbackEntries, aiSections: [] };

  const entries: HighlightCommentEntry[] = [];
  const aiSections: HighlightAiSection[] = [];
  let currentEntry: HighlightCommentEntry | null = null;
  let currentSection: HighlightAiSection | null = null;
  let inAiSection = false;

  for (let i = range.startIndex + 1; i < range.blockIndex; i++) {
    const rawLine = lines[i] || "";
    const line = normalizeBlockquoteLine(rawLine);
    const noteMatch = line.match(/^\*\*(?:想法|笔记)(?:\s+(\d+))?\*\*$/);
    const aiHeadingMatch = line.match(/^#{3}\s+(.+?)\s*$/);
    if (/^\*\*时间\*\*/.test(line)) {
      pushCommentEntry(entries, currentEntry);
      currentEntry = null;
      inAiSection = true;
      continue;
    }
    if (noteMatch) {
      pushCommentEntry(entries, currentEntry);
      currentEntry = {
        label: noteMatch[1] ? `笔记 ${noteMatch[1]}` : "笔记",
        created: "",
        text: ""
      };
      inAiSection = false;
      continue;
    }
    if (aiHeadingMatch) {
      pushCommentEntry(entries, currentEntry);
      currentEntry = null;
      pushAiSection(aiSections, currentSection);
      currentSection = {
        title: aiHeadingMatch[1].trim(),
        text: "",
        links: []
      };
      inAiSection = true;
      continue;
    }
    if (currentEntry) {
      if (/^created:\s*/i.test(line)) {
        currentEntry.created = line.replace(/^created:\s*/i, "").trim();
        continue;
      }
      currentEntry.text += `${line}\n`;
      continue;
    }
    if (inAiSection && currentSection) {
      if (currentSection.title === "关联文章") {
        const match = line.match(/\[\[([^\]]+)\]\]/);
        if (match) {
          const linkName = match[1].trim();
          const timeMatch = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
          const time = timeMatch ? timeMatch[0] : "";
          currentSection.links.push(time ? `${linkName}|${time}` : linkName);
        }
      } else {
        const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
        currentSection.links.push(...links);
        currentSection.text += `${line}\n`;
      }
    }
  }

  pushCommentEntry(entries, currentEntry);
  pushAiSection(aiSections, currentSection);
  const commentEntries = entries.length ? entries : fallbackEntries;
  return {
    comment: commentEntries.map((entry) => entry.text).filter(Boolean).join("\n\n"),
    commentEntries,
    aiSections
  };
}

export async function readHighlightCommentsFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<string> {
  return (await readHighlightNoteDetailsFromBookNote(app, noteFile, highlight)).comment;
}

export async function replaceHighlightInBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  const lines = content.split(/\r?\n/);
  const blockIndex = lines.findIndex((line) => line.trim() === `^${highlight.blockId}`);
  if (blockIndex < 0) {
    await appendHighlightToBookNote(app, noteFile, highlight);
    return;
  }
  let startIndex = blockIndex;
  while (startIndex > 0 && !isHighlightNoteBlockStart(lines[startIndex])) {
    startIndex--;
  }
  if (!isHighlightNoteBlockStart(lines[startIndex])) {
    await appendHighlightToBookNote(app, noteFile, highlight);
    return;
  }
  const replacement = formatHighlightNoteBlock(highlight).split("\n");
  lines.splice(startIndex, blockIndex - startIndex + 1, ...replacement);
  await app.vault.modify(noteFile, lines.join("\n"));
}

export async function deleteHighlightFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  const lines = content.split(/\r?\n/);
  const blockIndex = lines.findIndex((line) => line.trim() === `^${highlight.blockId}`);
  if (blockIndex < 0)
    return;
  let startIndex = blockIndex;
  while (startIndex > 0 && !isHighlightNoteBlockStart(lines[startIndex])) {
    startIndex--;
  }
  if (!isHighlightNoteBlockStart(lines[startIndex]))
    return;
  let deleteEnd = blockIndex + 1;
  while (deleteEnd < lines.length && lines[deleteEnd].trim() === "") {
    deleteEnd++;
  }
  lines.splice(startIndex, deleteEnd - startIndex);
  await app.vault.modify(noteFile, lines.join("\n").trimEnd() + "\n");
}

export function getHighlightsForBook(settings: Partial<JarvisReaderSettings>, filePath: string): BookHighlight[] {
  const allHighlights = settings.bookHighlights || {};
  const list = allHighlights[filePath];
  return Array.isArray(list) ? list : [];
}

export function getEpubTocMd(rawToc: any): string {
  function dfs(node: any, output: string[], depth: number) {
    if (!node)
      return;
    const cleanedLabel = node.label.replace(/\u0000/g, "").trim();
    output.push("#".repeat(depth) + " " + cleanedLabel);
    for (let sub of node.subitems) {
      dfs(sub, output, depth + 1);
    }
  }
  if (!rawToc)
    return "";
  const output: string[] = [];
  for (let sub of rawToc) {
    dfs(sub, output, 1);
  }
  return output.join("\n\n");
}

export async function getPdfTocMd(file: TFile): Promise<string> {
  const pdfjsLib = await (loadPdfJs as any)();
  const content = await (this as any).app.vault.readBinary(file.path);
  const pdf = await pdfjsLib.getDocument(new Uint8Array(content)).promise;
  const rawToc = await pdf.getOutline();
  function dfs(node: any, output: string[], depth: number) {
    if (!node)
      return;
    const cleanedLabel = node.title.replace(/\u0000/g, "").trim();
    output.push("#".repeat(depth) + " " + cleanedLabel);
    for (let sub of node.items) {
      dfs(sub, output, depth + 1);
    }
  }
  if (!rawToc)
    return "";
  const output: string[] = [];
  for (let sub of rawToc) {
    dfs(sub, output, 1);
  }
  return output.join("\n\n");
}
