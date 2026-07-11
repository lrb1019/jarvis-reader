import type { TFile, Vault } from "obsidian";
import type { KnowledgeNoteStorage } from "./knowledge-note-service.ts";

export function createKnowledgeNoteStorage(vault: Vault): KnowledgeNoteStorage<TFile> {
  return {
    exists: (path) => vault.getAbstractFileByPath(path) !== null,
    createFolder: async (path) => { await vault.createFolder(path); },
    createFile: (path, content) => vault.create(path, content),
  };
}
