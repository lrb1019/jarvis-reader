# Jarvis Reader

Current version: v0.1.6

Jarvis Reader is a personalized EPUB reader for Obsidian. It combines a bookshelf, chapter navigation, reading progress, highlights, annotations, reflections, and book notes inside the vault.

## Credits And Attribution

Jarvis Reader is a personalized modification based on [Awesome Reader](https://github.com/awesomedog/obsidian-awesome-reader). The core reading capability, EPUB reader foundation, and part of the plugin structure come from Awesome Reader.

This repository mainly documents my own changes for a personal reading workflow, including bookshelf and TOC layout, annotation sidebar, highlights and reflections, Obsidian-style wiki link input, reading progress display, and interface refinements.

The upstream Awesome Reader project was created by awesomedog and is licensed under the MIT License. If this plugin is publicly distributed, attribution and license information for the original project should be preserved.

## Features

- Open `.epub` files directly in Obsidian.
- Browse EPUB books from a dedicated Jarvis Reader bookshelf.
- Switch between bookshelf, table of contents, and annotation panels.
- Read in paginated or scrolling mode.
- Switch between single-page and dual-page reading.
- Track reading progress per book.
- Show chapter page progress and whole-book percentage.
- Create plain highlights or reflection highlights from selected text.
- Save highlighted text, reflections, and block IDs into the matching Markdown book note.
- Show reflection highlights with a stronger visual marker in the reader.
- Use Obsidian-style wiki links in reflection text.
- Open linked notes from annotation previews.
- Filter annotations by all, highlight, or reflection, and use the more menu for current chapter, linked items, and sorting.
- Click an annotation card to jump to the source text, or double-click it to edit the reflection.
- Write book-note timestamps in local time.

## Reading Progress

Jarvis Reader uses a layered progress model:

1. If the EPUB provides a page list, the reader can show real book page numbers.
2. If no page list exists, it shows current chapter page numbers plus whole-book percentage.
3. Whole-book percentage prefers EPUB locations when available.
4. If locations are unavailable, it falls back to spine position plus in-chapter page position.

This avoids treating chapter page numbers as whole-book page numbers.

## Installation

Manual installation:

1. Download or clone this repository.
2. Copy the folder into your Obsidian vault:

```text
.obsidian/plugins/jarvis-reader
```

3. Make sure the folder contains:

```text
main.js
manifest.json
styles.css
```

4. In Obsidian, open `Settings -> Community plugins`.
5. Reload plugins if needed.
6. Enable `Jarvis Reader`.

## Usage

- Click the Jarvis Reader ribbon icon to open the bookshelf.
- Open an EPUB from the bookshelf.
- Select text while reading, then choose `Highlight` or `Write reflection`.
- Plain highlights save only the selected text; reflections save both the selected text and your note.
- Use `[[note name]]` inside reflections to connect your reading notes with the rest of your vault.
- Configure the book note folder and template from the plugin settings.

## Data And Privacy

The repository should only contain plugin code:

```text
main.js
manifest.json
styles.css
README.md
README.en.md
```

Local plugin data such as reading progress, highlights, cached covers, and settings may be stored by Obsidian in `data.json`. That file is intentionally ignored by Git and should not be committed.

## Development Notes

This repository currently contains the built plugin files, not the original source project. `main.js` is a bundled file.

Before committing changes, run:

```powershell
node --check main.js
```

Recommended Obsidian checks:

```powershell
obsidian plugin:reload id=jarvis-reader
obsidian dev:errors
```
