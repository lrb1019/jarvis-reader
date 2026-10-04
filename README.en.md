# Jarvis Reader

EPUB reading and knowledge capture for Obsidian · [中文说明](./README.md)

Current version: **[1.4.5](https://github.com/lrb1019/jarvis-reader/releases/tag/1.4.5)**.

Read EPUBs inside Obsidian, keep quotes and reflections in Markdown, connect existing notes, and promote useful fragments into independent knowledge notes.

**Read → Highlight → Reflect → Link → Create knowledge notes.** Offline lookup, AI translation, and vocabulary collection support this workflow.

## Changes in 1.4.5

- Consistent toolbar icons, hover and selected states across the library and reading sidebar; filters open an Obsidian themed menu on click.
- Search matches original EPUB titles and all authors, with existing caches refreshed automatically. Display names still follow filenames. Missing or inaccurate source metadata is not guessed or corrected.
- Reading statistics use theme fonts and controls in a centered layout up to 960px wide. Category and publisher preference analysis was removed; reading time, charts and rankings remain.
- Existing notes are not rewritten in bulk, and reading statistics and book metadata are retained.

## Purpose

Jarvis Reader focuses on making reading an input to your Obsidian knowledge base, rather than replacing a dedicated ebook reader. Quotes, reflections, and links stay together in one Markdown reading note per book. You decide which useful fragments to promote into independent knowledge notes.

English support and statistics serve reading; this is not a standalone vocabulary or spaced-repetition product. The plugin does not create a file for every highlight or automatically promote quotes into knowledge notes.

## Features

| Feature | Behavior |
| --- | --- |
| Library | Grid/list browsing, filename and EPUB title/author search, themed menu filters and sorting; single-click selects, double-click opens and restores reading position |
| Book management | Progress and an overflow menu below covers; metadata, custom/original covers, manual reading time, and deletion |
| Reading layout | Font size, line height, character/word spacing, indentation, width, one/two paginated columns, and single-column scrolling; adapts to sidebar resizing |
| Reading sidebar | Contents, bookmarks, notes/highlights, search and themed menu filters |
| Highlights and notes | Right-click selected text; multiple reflections and links on a single quote |
| Knowledge notes | Explicit promotion includes the quote, all reflections, and source links; repeat promotion opens the existing note |
| English support | Bundled ECDICT lookup, explicit AI translation, manual word/phrase collection; no standalone vocabulary book or review system |
| Statistics | Automatic and manual time, weekly/monthly/yearly charts and reading rankings |

There is no separate book detail page. Selecting text alone does not open a menu or translation result. Ordinary Markdown files do not receive global lookup or saved-word marks.

## Installation and updates

### BRAT

Add `lrb1019/jarvis-reader` in Obsidian's BRAT plugin to install a published Release. Use BRAT to check updates. Everyday vaults receive official releases rather than direct development deployments.

### Manual installation

1. Download the complete `jarvis-reader-VERSION.zip` from [GitHub Releases](https://github.com/lrb1019/jarvis-reader/releases).
2. Extract directly into `.obsidian/plugins/jarvis-reader/` in your vault without an extra nested directory.
3. Enable Jarvis Reader under Settings → Community plugins.

Required contents:

```text
main.js
manifest.json
styles.css
dictionaries/ecdict/
THIRD_PARTY_NOTICES.md
```

The three runtime files alone do not include the offline dictionary. Replace release files when updating and retain existing data, indexes, caches, and backups. Back up notes and plugin data before upgrading and read the target version's [Release notes](https://github.com/lrb1019/jarvis-reader/releases), especially migration and retired-feature notices when upgrading from older versions. Cloning `main` provides development source, which may contain unreleased changes.

## Reading to knowledge

1. Configure a book folder and add EPUBs; an empty book-folder setting scans the vault.
2. Single-click selects; double-click opens. Persistent bookmark, reading-note and settings tools sit at the top right, with the chapter name on the same row. Switch contents, bookmarks and notes from the left sidebar.
3. Select text and right-click to highlight or add a note. Each book uses one Markdown reading note rather than one file per quote.
4. Click an annotation with notes to view its full quote and reflections. Append/edit notes and use `[[wikilinks]]`; each reflection's overflow menu provides editing and deletion.
5. Explicitly create a knowledge note from a useful fragment. Source links return to the reading note or EPUB. Stable source identities support renames/moves; deleting files or moving them outside the vault is different.

New notes use concise Markdown templates. Reading notes retain quotes, all reflections and links, with timestamps and return-to-source links aligned to the right. Knowledge notes place reflections first and retain quotes and source wikilinks that Obsidian can update on rename. Existing notes and custom initial templates are not replaced in bulk. Note cards preserve headings, lists, quotes, code and indentation.

Sidebar bookmarks and fragments are deleted from their context menus. Book deletion preserves Markdown reading notes and knowledge notes by default.

### Independent folders

All paths are vault-relative and independently configurable:

| Setting | Default | Purpose |
| --- | --- | --- |
| Book folder | Empty | Filter EPUBs in the library |
| Reading notes | `Reading Notes` | One Markdown note per book |
| Knowledge notes | `Knowledge Notes` | Explicitly promoted notes |
| Covers | `Cover` | Uploaded custom images |

Saving folder settings creates missing directories. The last three are not forced into the book folder; paths such as `books/Reading Notes` are optional. Changing these settings does not automatically move existing files.

### Lookup and translation

Select an English word inside the EPUB reader and choose offline lookup. Bundled ECDICT loads from 26 alphabetical shards without network access or manual import; see [third-party notices](./THIRD_PARTY_NOTICES.md). Phrases, sentences, and offline misses can use the configured AI service after explicit action.

Lookup does not collect automatically. Only explicit saving creates a word/phrase asset; sentences can be translated but are not saved as assets. AI failure must not block notes, highlights, or offline lookup.

### Manual reading time

Add minutes for reading that was not automatically tracked, such as reading on another device. Saved minutes are added to the selected date and included in statistics; they do not replace the book's automatic time.

## Data and privacy

Data stays in the current vault by default:

| Location | Content |
| --- | --- |
| `data.json` | Settings, position, progress, bookmarks, and reading time |
| Book Markdown notes | Authoritative quotes, complete reflections, and links |
| `index/highlights.json` | Annotation identity, color, chapter, and EPUB CFI location |
| `index/word-assets.json` | Collected words, definitions, and sources |
| `cache/covers/` | Regenerable cover cache |
| `logs/index-changes.jsonl` | Index audit records |

Knowledge notes are user-owned Markdown. Caches and summaries do not replace content; Markdown alone cannot reconstruct lost EPUB CFI positions. Back up notes and plugin data and do not upload them publicly.

Offline lookup makes no external request. AI translation sends selected text and necessary context to the configured service only after explicit action, never a whole book or chapter.

## Compatibility and verification limits

The reader and tools follow the Obsidian theme. The full third-party theme matrix, live sync transport, process crashes, and every version's BRAT clean installation/upgrade have not all been verified in the app. See the [changelog](./项目管理/03%20改动日志.md) for evidence and remaining checks.

The plugin includes a layout adaptation for Claudian's bottom zen composer: while an EPUB is open, the composer floats without reserving more reading space when its selected-content chip appears. Closing all EPUBs restores Claudian's original layout. The overlay can cover text at the bottom and affects other splits in the same workspace. It depends on Claudian's internal CSS classes and still awaits in-app acceptance. Claudian is not required for core reading features.

## Development and history

Edit `src/`; `main.js` is generated. Use Node.js 24:

```sh
npm ci
npm run verify
npm run package:release
```

Verification runs standard/strict core type checks, tests, a production build, and bundle syntax checks. Release ZIPs include the dictionary and notices, not user data.

[Changelog](./项目管理/03%20改动日志.md) · [Release procedure](./项目管理/06%20发布与同步流程.md) · [Past releases](https://github.com/lrb1019/jarvis-reader/releases)
