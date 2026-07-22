import type { TFile, Vault } from "obsidian";
import type { KnowledgeNoteStorage } from "./knowledge-note-service.ts";
import { buildKnowledgeNoteSourceLink } from "./knowledge-note.ts";

export function createKnowledgeNoteStorage(vault: Vault): KnowledgeNoteStorage<TFile> {
  return {
    exists: (path) => vault.getAbstractFileByPath(path) !== null,
    findBySource: async (sourceNotePath, sourceBlockId) => {
      const sourceSection = `## 来源\n\n${buildKnowledgeNoteSourceLink(sourceNotePath, sourceBlockId)}`;
      for (const file of vault.getMarkdownFiles()) {
        const content = (await vault.cachedRead(file)).replace(/\r\n/g, "\n");
        if (content.includes(sourceSection)) return file;
      }
      return null;
    },
    createFolder: async (path) => { await vault.createFolder(path); },
    createFile: (path, content) => vault.create(path, content),
  };
}
