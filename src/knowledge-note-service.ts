import { buildKnowledgeNoteContent, buildKnowledgeNotePath, type KnowledgeNoteDraft } from "./knowledge-note.ts";

export interface KnowledgeNoteStorage<File> {
  exists(path: string): boolean;
  findBySource(sourceNotePath: string, sourceBlockId: string): Promise<File | null>;
  createFolder(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<File>;
}

export interface CreateKnowledgeNoteRequest extends KnowledgeNoteDraft {
  folder: string;
  createdAt: string;
}

export class KnowledgeNoteService<File> {
  private readonly storage: KnowledgeNoteStorage<File>;

  constructor(storage: KnowledgeNoteStorage<File>) {
    this.storage = storage;
  }

  async create(request: CreateKnowledgeNoteRequest): Promise<File> {
    const existing = await this.storage.findBySource(request.sourceNotePath, request.sourceBlockId);
    if (existing) return existing;

    const folder = request.folder.trim().replace(/^\/+|\/+$/g, "");
    await this.ensureFolders(folder);

    const path = this.nextAvailablePath(folder, request.title);
    const content = buildKnowledgeNoteContent(request, request.createdAt);
    return this.storage.createFile(path, content);
  }

  private async ensureFolders(folder: string): Promise<void> {
    let currentFolder = "";
    for (const part of folder.split("/").filter(Boolean)) {
      currentFolder = currentFolder ? `${currentFolder}/${part}` : part;
      if (!this.storage.exists(currentFolder)) {
        await this.storage.createFolder(currentFolder);
      }
    }
  }

  private nextAvailablePath(folder: string, title: string): string {
    let path = buildKnowledgeNotePath(folder, title);
    let suffix = 2;
    while (this.storage.exists(path)) {
      path = buildKnowledgeNotePath(folder, `${title} ${suffix++}`);
    }
    return path;
  }
}
