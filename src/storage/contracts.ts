export interface TextFileStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface SettingsDataStore {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export function normalizeStoragePath(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export async function ensureStorageFolder(
  store: TextFileStore,
  folderPath: string,
): Promise<void> {
  const segments = normalizeStoragePath(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await store.exists(current))) await store.mkdir(current);
  }
}
