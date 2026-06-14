import { App, loadPdfJs, Notice, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { getBookNotePath, normalizeBookNoteFolder, renderBookNoteContent, type BookNoteSettings } from "../core/book-notes.ts";

interface TocItem {
  label?: string;
  title?: string;
  subitems?: TocItem[];
  items?: TocItem[];
}

export async function openOrCreateBookNote(
  app: App,
  file: TFile,
  toc: string,
  settings: BookNoteSettings = {},
): Promise<void> {
  const configuredFolder = normalizeBookNoteFolder(settings.bookNoteFolder);
  if (configuredFolder) {
    const folder = app.vault.getAbstractFileByPath(configuredFolder);
    if (!(folder instanceof TFolder)) {
      new Notice(`Jarvis Reader 读书笔记文件夹不存在：${configuredFolder}`);
      return;
    }
  }
  const notePath = getBookNotePath({ basename: file.basename, extension: file.extension, parentPath: file.parent?.path }, settings);
  const existing = app.vault.getAbstractFileByPath(notePath);
  const noteFile = existing instanceof TFile
    ? existing
    : await app.vault.create(
      notePath,
      renderBookNoteContent({ basename: file.basename, extension: file.extension, parentPath: file.parent?.path }, toc, settings),
    );
  const openedLeaf = app.workspace.getLeavesOfType("markdown").find((leaf) => {
    const view = leaf.view as { file?: TFile };
    return view.file?.path === noteFile.path;
  });
  if (openedLeaf) {
    await app.workspace.setActiveLeaf(openedLeaf, { focus: true });
    return;
  }
  const activeLeaf = app.workspace.getMostRecentLeaf();
  if (!activeLeaf) return;
  const noteLeaf: WorkspaceLeaf = app.workspace.createLeafBySplit(activeLeaf);
  await noteLeaf.openFile(noteFile, { active: true });
}

function tocToMarkdown(items: readonly TocItem[] | null | undefined): string {
  const output: string[] = [];
  const visit = (item: TocItem, depth: number): void => {
    const label = String(item.label || item.title || "").replace(/\u0000/g, "").trim();
    if (label) output.push(`${"#".repeat(depth)} ${label}`);
    for (const child of item.subitems || item.items || []) visit(child, depth + 1);
  };
  for (const item of items || []) visit(item, 1);
  return output.join("\n\n");
}

export function getEpubTocMarkdown(items: readonly TocItem[] | null | undefined): string {
  return tocToMarkdown(items);
}

export async function getPdfTocMarkdown(app: App, file: TFile): Promise<string> {
  const pdfjs = await loadPdfJs();
  const content = await app.vault.readBinary(file);
  const pdf = await pdfjs.getDocument(new Uint8Array(content)).promise;
  return tocToMarkdown(await pdf.getOutline() as TocItem[] | null);
}
