# Jarvis Reader

Current version: v0.3.2

Jarvis Reader is a personalized EPUB reader for Obsidian. It combines a bookshelf, chapter navigation, reading progress, highlights, annotations, reflections, and book notes inside the vault.

Jarvis Reader includes the ECDICT offline dictionary. English word lookup works without importing a dictionary or configuring a local path. Dictionary data is loaded in alphabetical shards; attribution is in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Release Notes

### v0.3.2

- Fixes the JavaScript syntax error introduced by the drag update and restores plugin loading.
- Restores accidentally removed EPUB options, reading-location persistence, and highlight rendering logic.
- Retains pointer-capture dragging for annotation and translation cards.

### v0.3.1

- Adds experimental offline translation support: can look up words in a local JSON dictionary first, falling back to AI if not found.
- Fixes a sidebar annotation sync bug where deleted annotations were resurrected by background re-reads.
- Simplifies dictionary configuration settings.

### v0.3.0

- Word translation now passes the selected text's surrounding sentence into `{{sentence}}`, so card meanings can prioritize the current context.
- Selected phrases use the same context-aware translation flow and can still be saved into the global vocabulary-card workflow.
- Automatically distinguishes words, phrases, and sentences: words and phrases create vocabulary cards, while full sentences show only a Chinese translation and provide a save-sentence action.
- Adds experimental offline translation support: can look up words in a local JSON dictionary first, falling back to AI if not found.
- Source underlines use different colors for words, phrases, and sentences, and Markdown output is grouped into `Words`, `Phrases`, and `Sentences` sections.
- Aggregated translation notes no longer repeat `Sources` under every entry; the source is represented by the file name and frontmatter.
- Vocabulary cards now store the lemma, selected surface form, and EPUB CFI source to avoid missed source underlines for forms such as `fracture/fractures`.
- The original selected source location is restored by EPUB CFI first; additional occurrences are scanned by known word forms.
- Hover cards now resolve from the real EPUB text under the pointer instead of relying on the SVG underline stroke, improving trigger reliability without blocking text selection.
- Hover lookup supports common inflected forms such as `fractures -> fracture` and `shattered -> shatter`.
- Adds plugin-local sidecar index files for annotation and vocabulary-card source locations, reducing the risk of losing links when `data.json` is overwritten.
- Makes the reader outer background follow Obsidian light and dark themes.
- Uses a brighter highlighter yellow for plain highlights and a clearer orange outline for reflection highlights.
- New vocabulary cards no longer include empty `## Thoughts` sections.

### v0.2.0

- Adds a word translation and global vocabulary-card workflow for selected EPUB words or short phrases.
- Uses `display` as the primary card body so the translation popup, hover card, and Markdown `## Card` share the same source.
- Simplifies word-note output to `## Card` and `## Sources`, reducing duplicated fields and legacy metadata noise.
- Localizes translation settings, adds default-prompt restore, and validates the JSON template before test requests.
- Loads full card bodies back from Markdown `## Card` and protects hover rendering with display cache limits and truncation.
- Adds Obsidian-style hover-card action icons for mastered, delete, and open note.
- Deletes both the Markdown word block and plugin index entry when deleting a word.
- Lets the red word title trigger pronunciation and uses Obsidian Notice for save feedback.
- Closes the translation popup when clicking back into EPUB content.

### v0.1.7

- Makes `[[wiki link]]` suggestions in the reflection editor behave closer to Obsidian, prioritizing recently opened and recently modified files.
- Supports non-Markdown vault files in wiki link suggestions, including EPUB, PDF, DOC, and DOCX, while ignoring hidden folders such as `.obsidian`.
- Aligns the `#`, `^`, and `|` helper text with Obsidian's link input hints.
- Moves the default reflection editor to the middle-right area and keeps wiki link suggestions inside the editor layout to avoid covering action buttons.
- Adds `created` to the default book note template and stores `bookname` as a wiki link by default.

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
- Translate selected English words or short phrases and save them as global vocabulary cards.
- Use the surrounding sentence to prioritize the meaning that fits the current context.
- Preview vocabulary cards on hover, play pronunciation, open the word note, mark mastered, or delete the entry.
- Show blue underlines for saved words in the source text, with hover lookup for common inflected forms.
- Saved phrases and sentences are also underlined in the source text with their own type colors.
- Store vocabulary-card content in Markdown `## Card` sections with fewer empty sections and repeated source blocks.
- Keep a local sidecar index for annotation and vocabulary source locations, so link data can be recovered if `data.json` is overwritten.
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
- Select an English word or phrase and choose `Translate` to create a context-aware vocabulary card.
- Select a full sentence and choose `Translate` to show only the sentence translation.
- Saved translation cards are grouped by words, phrases, and sentences in the book vocabulary note.
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
