export const DICTIONARY_SHARDS = Array.from("abcdefghijklmnopqrstuvwxyz", letter => `${letter}.json`);
export const DICTIONARY_SOURCE = "https://github.com/skywind3000/ECDICT";
export const DICTIONARY_PACKAGE_LIMIT = 64 * 1024 * 1024;
export const DICTIONARY_SHARD_LIMIT = 16 * 1024 * 1024;

export interface DictionaryManifest {
  format: "jarvis-reader-ecdict-v1";
  version: string;
  source: typeof DICTIONARY_SOURCE;
  license: "MIT";
  files: Record<string, { bytes: number; sha256: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseDictionaryManifest(text: string): DictionaryManifest {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("词典包清单无法读取，请重新下载词典包。"); }
  if (!isRecord(value) || value.format !== "jarvis-reader-ecdict-v1"
    || typeof value.version !== "string" || !/^ecdict-[a-f0-9]{12}$/.test(value.version)
    || value.source !== DICTIONARY_SOURCE || value.license !== "MIT" || !isRecord(value.files)
    || Object.keys(value.files).length !== 26) throw new Error("词典包格式不支持，请从 Jarvis Reader 发布页下载词典包。");
  let total = 0;
  for (const name of DICTIONARY_SHARDS) {
    const file = value.files[name];
    if (!isRecord(file) || !Number.isSafeInteger(file.bytes) || (file.bytes as number) <= 0
      || (file.bytes as number) > DICTIONARY_SHARD_LIMIT || typeof file.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`词典包清单无效：${name}`);
    total += file.bytes as number;
  }
  if (total > 128 * 1024 * 1024) throw new Error("词典包解压后过大。");
  return value as unknown as DictionaryManifest;
}

export function parseDictionaryShard(text: string, name: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error(`词典数据无法读取：${name}`); }
  if (!isRecord(value) || !Object.keys(value).length) throw new Error(`词典数据无效：${name}`);
  for (const [word, entry] of Object.entries(value)) {
    if (!word.toLowerCase().startsWith(name.charAt(0)) || !isRecord(entry)
      || ![entry.translation, entry.display].some(field => typeof field === "string" && field.trim())) {
      throw new Error(`词典条目格式无效：${name}`);
    }
  }
  return value;
}
