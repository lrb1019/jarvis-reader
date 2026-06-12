import { Plugin } from "obsidian";
import type { JarvisReaderSettings } from "./domain";

export default class JarvisReaderMigrationPlugin extends Plugin {
  declare settings: JarvisReaderSettings;

  async onload(): Promise<void> {
    console.info("Jarvis Reader TypeScript migration scaffold loaded.");
  }
}
