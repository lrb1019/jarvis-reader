import { Plugin } from "obsidian";

export default class JarvisReaderMigrationPlugin extends Plugin {
  async onload(): Promise<void> {
    console.info("Jarvis Reader TypeScript migration scaffold loaded.");
  }
}
