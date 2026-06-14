// Extracted from main.js L47585-47629 — book note creation and opening

import { TFolder, TFile, WorkspaceLeaf, Notice, App } from "obsidian";
import { normalizeVaultPath, joinVaultPath, formatLocalDateTime } from "./utils";
import type { JarvisReaderSettings } from "./types";

export function getDefaultBookNoteContent(file: TFile, toc: string): string {
  return `---
bookname: "[[${file.basename}.${file.extension}]]"
created: ${formatLocalDateTime(new Date())}
---

` + toc;
}

export function renderBookNoteTemplate(template: string, file: TFile, toc: string): string {
  if (!template || !template.trim()) {
    return getDefaultBookNoteContent(file, toc);
  }
  return template.replace(/\{\{bookname\}\}/g, `${file.basename}.${file.extension}`).replace(/\{\{title\}\}/g, file.basename).replace(/\{\{extension\}\}/g, file.extension).replace(/\{\{created\}\}/g, formatLocalDateTime(new Date())).replace(/\{\{toc\}\}/g, toc || "");
}

export function getBookNotePath(file: TFile, settings: Partial<JarvisReaderSettings> = {}): string {
  const configuredFolder = normalizeVaultPath(settings.bookNoteFolder);
  const noteFolder = configuredFolder || normalizeVaultPath((file as any).parent?.path);
  return joinVaultPath(noteFolder, `${file.basename}.md`);
}

export async function getOrCreateBookNote(app: App, file: TFile, toc: string, settings: Partial<JarvisReaderSettings> = {}): Promise<TFile | null> {
  const configuredFolder = normalizeVaultPath(settings.bookNoteFolder);
  if (configuredFolder) {
    const folder = app.vault.getAbstractFileByPath(configuredFolder);
    if (folder == null || !(folder instanceof TFolder)) {
      new Notice(`Jarvis Reader note folder does not exist: ${configuredFolder}`);
      return null;
    }
  }
  const noteFilename = getBookNotePath(file, settings);
  let noteFile = app.vault.getAbstractFileByPath(noteFilename);
  if (noteFile == null || !(noteFile instanceof TFile)) {
    noteFile = await app.vault.create(noteFilename, renderBookNoteTemplate(settings.bookNoteTemplate || "", file, toc));
  }
  return noteFile as TFile;
}

export async function openOrCreateNote(app: App, file: TFile, toc: string, settings: Partial<JarvisReaderSettings> = {}): Promise<void> {
  const noteFile = await getOrCreateBookNote(app, file, toc, settings);
  if (!noteFile)
    return;
  const leaf = app.workspace.getMostRecentLeaf();
  if (leaf instanceof WorkspaceLeaf) {
    const fileLeaf = app.workspace.createLeafBySplit(leaf);
    await fileLeaf.openFile(noteFile, { active: true });
  }
}
