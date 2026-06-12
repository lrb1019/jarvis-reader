import type { DataAdapter } from "obsidian";
import type { SettingsDataStore, TextFileStore } from "./contracts.ts";

export interface PluginDataApi {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export function createSettingsDataStore(plugin: PluginDataApi): SettingsDataStore {
  return {
    loadData: () => plugin.loadData(),
    saveData: (data) => plugin.saveData(data),
  };
}

export function createVaultTextFileStore(adapter: DataAdapter): TextFileStore {
  return {
    exists: (path) => adapter.exists(path),
    read: (path) => adapter.read(path),
    write: (path, content) => adapter.write(path, content),
    mkdir: (path) => adapter.mkdir(path),
  };
}
