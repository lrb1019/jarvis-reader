import { normalizeVaultPath } from "./utils-core.ts";

export const DEFAULT_STORAGE_FOLDERS = {
  bookNoteFolder: "Reading Notes",
  knowledgeNoteFolder: "Knowledge Notes",
  customCoverFolder: "Cover"
};
export interface StorageFolders {
  bookFolder: string;
  bookNoteFolder: string;
  knowledgeNoteFolder: string;
  customCoverFolder: string;
}
export function validateFolderPath(value: string): string {
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || raw.split("/").some(part => part === ".." || part === ".") || /[:\x00-\x1f]/.test(raw)) {
    throw new Error("请使用仓库内的文件夹路径");
  }
  return normalizeVaultPath(raw);
}
export function isBookInFolder(path: string, root = ""): boolean {
  return !root || path.startsWith(root + "/");
}
export interface FolderStorage {
  stat(path: string): Promise<{ type: string } | null>;
  mkdir(path: string): Promise<unknown>;
}
export async function ensureStorageFolders(storage: FolderStorage, paths: string[]): Promise<void> {
  const folders = new Set<string>();
  for (const path of paths.map(validateFolderPath)) {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  // Validate every existing component before creating anything.
  for (const path of folders) {
    const stat = await storage.stat(path);
    if (stat && stat.type !== "folder") throw new Error(`路径已被文件占用：${path}`);
  }
  for (const path of folders) {
    if (await storage.stat(path)) continue;
    try { await storage.mkdir(path); }
    catch (error) {
      // Another writer may have created the same directory.
      if ((await storage.stat(path))?.type !== "folder") throw error;
    }
  }
}

export interface StorageFolderSettings {
  bookFolder?: string;
  bookNoteFolder: string;
  knowledgeNoteFolder: string;
  customCoverFolder: string;
}
export async function configureStorageFolders(
  storage: FolderStorage,
  settings: StorageFolderSettings,
  draft: StorageFolders,
  persist: () => Promise<void>
): Promise<void> {
  const folders: StorageFolders = {
    bookFolder: validateFolderPath(draft.bookFolder),
    bookNoteFolder: validateFolderPath(draft.bookNoteFolder),
    knowledgeNoteFolder: validateFolderPath(draft.knowledgeNoteFolder),
    customCoverFolder: validateFolderPath(draft.customCoverFolder)
  };
  await ensureStorageFolders(storage, Object.values(folders));
  const hadRoot = Object.hasOwn(settings, "bookFolder");
  const previous: StorageFolderSettings = {
    bookFolder: settings.bookFolder,
    bookNoteFolder: settings.bookNoteFolder,
    knowledgeNoteFolder: settings.knowledgeNoteFolder,
    customCoverFolder: settings.customCoverFolder
  };
  Object.assign(settings, folders);
  try { await persist(); }
  catch (error) {
    Object.assign(settings, previous);
    if (!hadRoot) delete settings.bookFolder;
    throw error;
  }
}
