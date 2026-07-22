import { loadPdfJs, type App, type TFile } from "obsidian";
import type { BookHighlight, JarvisReaderSettings } from "./types.ts";
import {
  buildHighlightMetadata,
  buildHighlightNoteUpdate,
  dedupeHighlightsByCfi,
  formatBlockquote,
  formatHighlightNoteBlock,
  isHighlightNoteBlockStart,
} from "./highlight-core.ts";
import {
  appendReflectionDocument,
  deleteHighlightDocument,
  insertHighlightDocument,
  readHighlightDetailsDocument,
  replaceHighlightDocument,
  type HighlightNoteDetails,
} from "./book-note-document.ts";

export function createHighlightId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export {
  buildHighlightMetadata,
  buildHighlightNoteUpdate,
  dedupeHighlightsByCfi,
  formatBlockquote,
  formatHighlightNoteBlock,
  isHighlightNoteBlockStart,
};
export type { HighlightAiSection, HighlightCommentEntry, HighlightNoteDetails } from "./book-note-document.ts";

export async function appendHighlightToBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  await app.vault.modify(noteFile, insertHighlightDocument(content, highlight));
}

export async function appendReflectionToBookNote(app: App, noteFile: TFile, highlight: BookHighlight, reflection: string): Promise<void> {
  const content = await app.vault.read(noteFile);
  const nextContent = appendReflectionDocument(content, highlight, reflection || "");
  if (nextContent !== content) await app.vault.modify(noteFile, nextContent);
}

export async function readHighlightNoteDetailsFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<HighlightNoteDetails> {
  return readHighlightDetailsDocument(await app.vault.read(noteFile), highlight);
}

export async function readHighlightCommentsFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<string> {
  return (await readHighlightNoteDetailsFromBookNote(app, noteFile, highlight)).comment;
}

export async function replaceHighlightInBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  await app.vault.modify(noteFile, replaceHighlightDocument(content, highlight));
}

export async function deleteHighlightFromBookNote(app: App, noteFile: TFile, highlight: BookHighlight): Promise<void> {
  const content = await app.vault.read(noteFile);
  const nextContent = deleteHighlightDocument(content, highlight.blockId);
  if (nextContent !== content) await app.vault.modify(noteFile, nextContent);
}

export function getHighlightsForBook(settings: Partial<JarvisReaderSettings>, filePath: string): BookHighlight[] {
  const list = (settings.bookHighlights || {})[filePath];
  return Array.isArray(list) ? list : [];
}

export function getEpubTocMd(rawToc: unknown): string {
  const output: string[] = [];
  const visit = (node: any, depth: number) => {
    if (!node) return;
    output.push(`${"#".repeat(depth)} ${String(node.label || "").replace(/\u0000/g, "").trim()}`);
    for (const child of node.subitems || []) visit(child, depth + 1);
  };
  if (Array.isArray(rawToc)) for (const node of rawToc) visit(node, 1);
  return output.join("\n\n");
}

export async function getPdfTocMd(file: TFile): Promise<string> {
  const pdfjsLib = await (loadPdfJs as any)();
  const content = await (this as any).app.vault.readBinary(file.path);
  const pdf = await pdfjsLib.getDocument(new Uint8Array(content)).promise;
  const rawToc = await pdf.getOutline();
  const output: string[] = [];
  const visit = (node: any, depth: number) => {
    if (!node) return;
    output.push(`${"#".repeat(depth)} ${String(node.title || "").replace(/\u0000/g, "").trim()}`);
    for (const child of node.items || []) visit(child, depth + 1);
  };
  if (Array.isArray(rawToc)) for (const node of rawToc) visit(node, 1);
  return output.join("\n\n");
}
