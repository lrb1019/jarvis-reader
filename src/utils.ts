// Extracted from main.js — shared utility functions
// Sources: L47578-47584, L47660-47675, L47920-47936, L48755-48769, L49226-49228

import { TFolder, TFile, App } from "obsidian";

export function normalizeVaultPath(path: string | null | undefined): string {
  return (path || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function joinVaultPath(folder: string, filename: string): string {
  const cleanFolder = normalizeVaultPath(folder);
  return cleanFolder ? `${cleanFolder}/${filename}` : filename;
}

export function formatLocalDate(value: any): string {
  if (!value)
    return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalDateTime(value: any): string {
  if (!value)
    return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    return value;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function sanitizeWordAssetFilename(value: string | null | undefined): string {
  const cleaned = (value || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "word";
}

export function escapeRegExp(value: string | null | undefined): string {
  return (value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeYamlString(value: string | null | undefined): string {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function normalizeHighlightQuote(quote: string | null | undefined): string {
  return (quote || "").replace(/\s+/g, " ").trim();
}

export function normalizeWordDisplayText(value: string | null | undefined): string {
  return String(value || "").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n").trim();
}

export async function ensureVaultFolder(app: App, folderPath: string): Promise<void> {
  const cleanPath = normalizeVaultPath(folderPath);
  if (!cleanPath)
    return;
  const segments = cleanPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(currentPath);
    if (!existing) {
      await app.vault.createFolder(currentPath);
    }
  }
}
