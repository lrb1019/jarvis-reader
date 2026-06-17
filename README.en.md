# Jarvis Reader

Current version: v0.7.0

Jarvis Reader is a personalized EPUB reader for Obsidian. It combines a bookshelf, chapter navigation, reading progress, highlights, annotations, reflections, and book notes inside the vault.

Jarvis Reader includes the ECDICT offline dictionary. English word lookup works without importing a dictionary or configuring a local path. Dictionary data is loaded in alphabetical shards; attribution is in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Release Notes

### v0.7.0

- Added "Reading Bookmarks": One-click native bookmarking in the reader, with a dedicated tab in the Library App for viewing and precise jumping to specific paragraphs.
- Refactored `epubcifi` state restoration and precise positioning logic to enable instantaneous jumping to specific paragraphs, whether from within the reader or when opening a book from the background.
- Fixed and enhanced sidebar synchronization logic: When switching between multiple open books, sidebars (like word cards) will automatically and accurately follow the active book. When all books are closed, sidebars will gracefully close.
- Optimized spacing and layout between the Coverflow view and the right details pane in the Library App for better visual breathability.
- Refactored the Library App to support Grid, List, and 3D Coverflow immersive display modes.
- Replaced the original sidebar bookshelf with a dedicated "Reading Assistant Sidebar" focused purely on "Table of Contents" and "Highlights & Reflections".
- Reading states (Reading, Finished, Unread) are now strictly aligned with Markdown notes' Frontmatter metadata instead of relying on percentage calculations.
- Seamlessly auto-awaken the "Reading Assistant Sidebar" when opening a book. for a seamless workflow.

### v0.4.0

- Makes `index/word-assets.json` the sole persistent source for translation assets and stops merging assets from `data.json`.
- Adds one-way Markdown synchronization, automatic note rebuilding, and permanent asset deletion.
- Bundles 400,850 ECDICT entries in alphabetical shards with no import or path configuration required.
- Uses Chinese Word, Phrase, and Sentence sections in aggregated translation notes.

### v0.3.2

- Adds pointer-capture dragging for annotation and translation cards.

### v0.3.1

- Adds experimental offline translation support: can look up words in a local JSON dictionary first, falling back to AI if not found.
- Fixes a sidebar annotation sync bug.
- Simplifies dictionary configuration settings.

### v0.3.0

- Word translation now passes the selected text's surrounding sentence into `{{sentence}}`, so card meanings can prioritize the current context.
- Selected phrases use the same context-aware translation flow and can still be saved into the global vocabulary-card workflow.
- Automatically distinguishes words, phrases, and sentences: words and phrases create vocabulary cards, while full sentences show only a Chinese translation and provide a save-sentence action.
- Adds experimental offline translation support: can look up words in a local JSON dictionary first, falling back to AI if not found.
- Source underlines use different colors for words, phrases, and sentences, and Markdown output is grouped into `Words`, `Phrases`, and `Sentences` sections.
- Aggregated translation notes no longer repeat `Sources` under every entry; the source is represented by the file name and frontmatter.
- Vocabulary cards now store the lemma, selected surface form, and EPUB CFI source.
- The original selected source location is restored by EPUB CFI first; additional occurrences are scanned by known word forms.
- Hover cards now resolve from the real EPUB text under the pointer instead of relying on the SVG underline stroke.
- Hover lookup supports common inflected forms such as `fractures -> fracture` and `shattered -> shatter`.
- Adds plugin-local sidecar index files for annotation and vocabulary-card source locations.
- Makes the reader outer background support Obsidian light and dark themes.
- Uses a brighter highlighter yellow for plain highlights and a clearer orange outline for reflection highlights.
- New vocabulary cards no longer include empty `## Thoughts` sections.

### v0.2.0

- Adds a word translation and global vocabulary-card workflow for selected EPUB words or short phrases.
- Uses `display` as the primary card body so the translation popup, hover card, and Markdown `## Card` share the same source.
- Simplifies word-note output to `## Card` and `## Sources`.
- Localizes translation settings, adds default-prompt restore, and validates the JSON template before test requests.
- Loads full card bodies back from Markdown `## Card` and protects hover rendering with display cache limits and truncation.
- Adds Obsidian-style hover-card action icons for mastered, delete, and open note.
- Deletes both the Markdown word block and plugin index entry when deleting a word.
- Lets the red word title trigger pronunciation and uses Obsidian Notice for save feedback.
- Automatically closes the translation popup when clicking back into EPUB content.

### v0.1.7

- Makes `[[wiki link]]` suggestions in the reflection editor behave closer to Obsidian, prioritizing recently opened and recently modified files.
- Supports non-Markdown vault files in wiki link suggestions, including EPUB, PDF, DOC, and DOCX, while ignoring hidden folders such as `.obsidian`.
- Aligns the `#`, `^`, and `|` helper text with Obsidian's link input hints.
- Moves the default reflection editor to the middle-right area and keeps wiki link suggestions inside the editor layout.
- Adds `created` to the default book note template and stores `bookname` as a wiki link by default.



## Core Modules

### Library App
- **Immersive Bookshelf**: Browse your collection using Grid, List, or 3D Coverflow views.
- **Metadata Sync**: Reading statuses (unread, reading, finished) strictly align with the Frontmatter of your Markdown book notes.

### Immersive Reading
- **Native EPUB**: Open `.epub` files directly inside Obsidian with support for paginated/scrolling and single/dual-page modes.
- **Reading Assistant**: Automatically reveals a streamlined sidebar for Table of Contents and highlights upon opening a book.
- **Precise Progress**: Layered parsing to display real book page numbers and accurate whole-book percentages.
- **Visual Consistency**: The reader's background adapts seamlessly to your Obsidian light/dark theme.

### Highlights & Reflections
- **Color-Coded Annotations**: Select text to create plain highlights (yellow) or reflection highlights (orange outline).
- **Wiki-Link Integration**: Type `[[` in the reflection editor to link ideas to existing notes in your vault.
- **Markdown Sync**: Automatically writes highlighted text, your reflections, and local timestamps to the corresponding Markdown book note.
- **Sidebar Management**: Filter annotations by type or chapter. Click a card to jump to the source text, or double-click to edit.

### Smart Translation & Vocabulary
- **Offline & Context-Aware AI**: Includes a 400k+ ECDICT offline dictionary for instant lookups. AI translations read the **surrounding sentence** to provide contextually accurate meanings.
- **Visual Categorization**: Auto-differentiates between words (blue), phrases (purple), and full sentences (green) with distinct underlines in the text.
- **Interactive Word Cards**: Hover over words to view definitions (supports inflected forms), play pronunciations, or mark them as mastered.
- **Data Persistence**: Vocabulary is automatically exported to Markdown `## Card` sections, while a background Sidecar index ensures your data stays safe.

## Reading Progress

Jarvis Reader uses a layered progress model:

1. If the EPUB provides a page list, the reader can show real book page numbers.
2. If no page list exists, it shows current chapter page numbers plus whole-book percentage.
3. Whole-book percentage prefers EPUB locations when available.
4. If locations are unavailable, it falls back to spine position plus in-chapter page position.

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
