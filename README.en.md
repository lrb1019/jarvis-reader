# Jarvis Reader

Current version: 1.2.0

[中文说明](./README.md) | English

Jarvis Reader is a personalized EPUB reader for Obsidian. It combines a library dashboard, reading progress, table of contents navigation, highlights, notes, offline lookup, AI translation, vocabulary cards, and a word book into one reading workflow.

Jarvis Reader bundles the ECDICT offline dictionary. English word lookup works without importing a dictionary or configuring a local path. Dictionary data is loaded from 26 alphabetical shards. Attribution and license details are available in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## v1.1.4

- **Note Secondary Editing & Deletion**: Added edit and delete buttons to each note card item in the popover window. Supports editing individual thoughts (preserving their creation timestamps) and deleting entries, and writes changes back to the raw Markdown note file.
- **Resize Handle Visibility**: Moved the resize handle outside of the conditional actions block to make it visible and draggable across all popover states (view, append, edit).
- **Asynchronous Detail Page Loading**: Implemented an async parse workflow when entering the book details view to read the Markdown note file directly, extracting and merging `commentEntries` and `aiSections` to ensure the details view is perfectly in sync with the reader.
- **Style Decoupling & Rename**: Notes cards (with thoughts/links) now display clean quotes without highlight backgrounds, while plain highlight lines show a soft highlight background matching the user's color palette. Renamed detail tab and stat counts back to "笔记" per user request.

## v1.2.0

- The library now keeps Grid and List views only; the low-value 3D Coverflow view was removed.
- A highlight with a reflection can be promoted directly into an independent knowledge note. Its target folder is configurable, and the new note links to the original book block rather than copying the source text.

## v1.1.2

- **Obsidian-Native Markdown Preview & Wikilink Navigation**: Used Obsidian's native `MarkdownRenderer` in the note display area to support rich formatting (bold, lists, tables) and allow clicking `[[wikilinks]]` directly to open target files.
- **CodeMirror 6 Editor Activation**: Resolved a CSS display bug that kept the CodeMirror 6 editor hidden under fallback textareas, restoring the native autocomplete, syntax highlighting, and double-bracket suggestion experience.
- **Sidebar Focus & CFI Snapback Fixes**: Prevented focus changes from resetting the active sidebar tab back to TOC. Resolved a critical race condition where stale `pendingInitLocationRef` values triggered snap-back loops when paginating to later chapters.
- **Form Layout & Corrupted JSON Tolerance**: Increased default note window height by 30% with scroll helper. Added robust try-catch handling and fallback mechanisms to `word-assets.json` load workflow to protect the plugin against startup crashes on corrupted index files.

## v1.1.1

- Removed the floating note bubble in EPUB body text to avoid random drift or disappearance across pagination and multi-paragraph highlights.
- Highlights with notes now open the read-only note window by clicking the underline itself; top-right actions still open the Markdown block or append a new note.

## v1.1.0

- Reworked the EPUB highlight note window: highlights with notes open from the underline itself, display as read-only by default, and require the top-right action to append a new note.
- Added an action to open the corresponding Markdown note block through Obsidian block links: `notePath#^blockId`.
- Added `Notes / AI` sections in the note window: notes show all entries from the same highlight block; AI shows agent output and wiki links.
- New note entries are written with the `笔记` label while still reading older `想法` blocks.
- Simplified the note window toward native Obsidian styling and aligned top-right action buttons with the vocabulary card buttons.

## Highlights

- **Library App**: Browse books with Grid and List views.
- **Frontmatter status sync**: Reading status, rating, and tags align with the corresponding Markdown book note.
- **Immersive EPUB reading**: Supports paginated or scrolling reading, single or dual-page modes, font size, line height, table of contents, and reading-location recovery.
- **Highlights and notes**: Create plain highlights, write notes, append notes, open the corresponding Markdown block, filter in the sidebar, and jump back to the source text.
- **Reading bookmarks**: Add bookmarks in the reader and jump back to precise EPUB CFI locations from the book detail page.
- **Offline lookup and AI translation**: Single words are looked up through bundled ECDICT first; phrases, sentences, and misses require explicit AI translation.
- **Vocabulary assets**: Save words, phrases, and sentences with source underlines, hover cards, mastery state, and permanent deletion.
- **Word sidebar and word book**: Review current-book or global vocabulary cards.
- **Markdown word recognition**: Saved words can be recognized in the current CodeMirror viewport of normal Markdown notes.
- **TypeScript source project**: Source code lives in `src/`; root `main.js` is generated by esbuild.

## Installation

1. Download or clone this repository.
2. Copy the folder into your Obsidian vault:

```text
.obsidian/plugins/jarvis-reader
```

3. Make sure the folder contains at least:

```text
main.js
manifest.json
styles.css
dictionaries/ecdict/
THIRD_PARTY_NOTICES.md
```

4. Open Obsidian.
5. Go to `Settings -> Community plugins`.
6. Reload the plugin list if needed.
7. Enable `Jarvis Reader`.

## Usage

- Click the Jarvis Reader ribbon icon to open the Library App.
- Open an EPUB from the library.
- Select text while reading, then choose `Highlight`, `Note`, `Copy`, or `Translate`.
- Plain highlights save only the selected text; notes save both the selected text and your content into the corresponding Markdown book note.
- Click a highlight with notes to open the read-only note window.
- In the note window, `pencil` opens the corresponding Markdown block, `file-pen-line` appends a note, and `x` closes the window.
- A highlight with a reflection can create an independent Markdown knowledge note from the note window; configure its destination folder in plugin settings.
- Selecting an English word first shows the bundled ECDICT result.
- Selecting a phrase or sentence and clicking `Translate` can call AI translation.
- Saved translation results enter the vocabulary system as words, phrases, or sentences.
- Type `[[note name]]` inside notes to connect reading notes with the rest of your vault.
- Configure book-note paths, templates, AI translation settings, and pronunciation settings in the plugin settings.

## Data And Privacy

Jarvis Reader stores data locally in your Obsidian vault by default.

Main data locations:

- `data.json`: plugin settings, reading locations, reading progress, cached covers, bookmarks, and lightweight runtime data.
- `index/word-assets.json`: primary data for words, phrases, and sentence assets.
- `index/highlights.json`: highlight metadata snapshot for recovery.
- `logs/index-changes.jsonl`: index change log.
- Markdown book notes: readable projections for highlights, notes, and book notes.

These local data files should not be committed to a public GitHub repository. The repository `.gitignore` excludes common local data files.

External AI translation is called only when explicitly triggered by the user. Bundled ECDICT lookup does not require network access.

## Development

This repository is a TypeScript source project.

Common commands:

```powershell
npm install
npm run verify
```

`npm run verify` runs:

1. TypeScript type checking.
2. Node tests.
3. Production build with esbuild.
4. `node --check main.js`.

Development rules:

- Edit `src/` for feature changes.
- Do not edit `main.js` by hand; it is generated by the build process.
- Run `npm run verify` before publishing or committing.

## Repository Layout

```text
src/                    TypeScript source
styles.css              Plugin styles
main.js                 Build output
manifest.json           Obsidian plugin manifest
dictionaries/ecdict/    Bundled ECDICT dictionary shards
tests/                  Automated tests
README.md               Chinese README
README.en.md            English README
THIRD_PARTY_NOTICES.md  Third-party notices
```

## Recent Releases

### v1.1.1

- Removed the floating EPUB note bubble and changed note highlights to open the read-only note window by clicking the underline itself.
- Kept the note-window actions for opening the Markdown block, appending notes, and closing the window.

### v1.1.0

- Changed EPUB highlight notes to read-only display plus explicit append.
- Added opening the corresponding Markdown block from the note window.
- Added `Notes / AI` sections in the note window.
- Standardized new note labels to `笔记` while keeping compatibility with old `想法` blocks.

### v1.0.9

- Extended the existing word popup flow from CodeMirror Markdown notes to ordinary article/body DOM selections when the page is controllable.
- Reused the same offline lookup, `AI Translate`, and `Save Word` card flow instead of creating a second vocabulary pipeline.
- Intentionally stopped short of automatic saved-word highlighting inside third-party article renderers; valuable content should still be saved to local Markdown for long-term reuse.

### v1.0.8

- Audited four icon entry paths: ribbon icons, view tab icons, button icons, and inline SVG icons.
- Switched the left Open Library ribbon entry back to the native Obsidian library-big icon name.
- Added a reference note explaining how to use native Lucide icons in Obsidian plugins with real source examples.

For full history, see the project note `03 改动日志.md`.
