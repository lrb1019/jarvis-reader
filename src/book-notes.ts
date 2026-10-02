// Extracted from main.js L47585-47629 — book note creation and opening

import { TFile, WorkspaceLeaf, Notice, App } from "obsidian";
import { normalizeVaultPath, joinVaultPath, formatLocalDateTime } from "./utils";
import { ensureStorageFolders } from "./storage-folders";
import type { JarvisReaderSettings } from "./types";

function getDefaultBookNoteContent(file: TFile, toc: string): string {
  return `---
bookname: "[[${file.basename}.${file.extension}]]"
status: unread
rating: 0
tags: []
start_date: ""
finish_date: ""
created: ${formatLocalDateTime(new Date())}
---

` + toc;
}

function renderBookNoteTemplate(template: string, file: TFile, toc: string): string {
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

export function findBookNote(app: App, file: TFile, settings: Partial<JarvisReaderSettings> = {}): TFile | null {
  const remembered = settings.bookNotePaths?.[file.path];
  if (remembered) {
    const note = app.vault.getAbstractFileByPath(remembered);
    if (note instanceof TFile) return note;
    throw new Error("关联的读书笔记不存在，请恢复或修正路径，未新建替代笔记");
  }
  // 1. Check exact expected path first
  const exactPath = getBookNotePath(file, settings);
  const exactFile = app.vault.getAbstractFileByPath(exactPath);
  if (exactFile instanceof TFile) return exactFile;

  // 2. Search entire vault for frontmatter `bookname: "[[basename.epub]]"`
  const allMarkdownFiles = app.vault.getMarkdownFiles();
  const targetBookname = `[[${file.basename}.${file.extension}]]`;
  
  for (const mdFile of allMarkdownFiles) {
    const cache = app.metadataCache.getFileCache(mdFile);
    if (cache?.frontmatter?.bookname === targetBookname) {
      return mdFile;
    }
  }

  // 3. Fallback: Search for any md file with the exact basename
  const fallbackFile = allMarkdownFiles.find(f => f.basename === file.basename);
  if (fallbackFile) return fallbackFile;

  return null;
}

export async function getOrCreateBookNote(app: App, file: TFile, toc: string, settings: Partial<JarvisReaderSettings> = {}): Promise<TFile | null> {
  let noteFile = findBookNote(app, file, settings);
  if (noteFile) return noteFile;

  const configuredFolder = normalizeVaultPath(settings.bookNoteFolder);
  if (configuredFolder) {
    try {
      await ensureStorageFolders({
        stat: path => app.vault.adapter.stat(path),
        mkdir: path => app.vault.createFolder(path)
      }, [configuredFolder]);
    } catch (error) {
      new Notice(`无法创建读书笔记目录：${configuredFolder}`);
      throw error;
    }
  }
  const noteFilename = getBookNotePath(file, settings);
  noteFile = await app.vault.create(noteFilename, renderBookNoteTemplate(settings.bookNoteTemplate || "", file, toc));
  return noteFile as TFile;
}

export async function openOrCreateNote(app: App, file: TFile, toc: string, settings: Partial<JarvisReaderSettings> = {}): Promise<void> {
  const noteFile = await getOrCreateBookNote(app, file, toc, settings);
  if (!noteFile)
    return;
  const epubLeaves = app.workspace.getLeavesOfType("epub");
  const baseLeaf = epubLeaves.find(l => {
    var _a;
    return ((_a = l.view) == null ? void 0 : (_a as any).file?.path) === file.path;
  }) || app.workspace.getMostRecentLeaf();

  const isSidebar = baseLeaf && (baseLeaf.getRoot() === app.workspace.leftSplit || baseLeaf.getRoot() === app.workspace.rightSplit);

  if (baseLeaf && !isSidebar) {
    const fileLeaf = app.workspace.createLeafBySplit(baseLeaf);
    await fileLeaf.openFile(noteFile, { active: true });
  } else {
    const fileLeaf = app.workspace.getLeaf(true);
    await fileLeaf.openFile(noteFile, { active: true });
  }
}
