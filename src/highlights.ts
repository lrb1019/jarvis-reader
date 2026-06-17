// Extracted from main.js L48752-48928 — highlight data operations + TOC generation

import { loadPdfJs, App, TFile } from "obsidian";
import type { BookHighlight, JarvisReaderSettings } from "./types";
import { buildHighlightMetadata, dedupeHighlightsByCfi, formatHighlightNoteBlock, isHighlightNoteBlockStart } from "./highlight-core";

export function createHighlightId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export { buildHighlightMetadata, dedupeHighlightsByCfi, formatHighlightNoteBlock, isHighlightNoteBlockStart };

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
