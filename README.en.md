# Jarvis Reader

Current version: 1.4.2 · [中文说明](./README.md)

Read EPUBs inside Obsidian, keep quotes and reflections in Markdown, connect existing notes, and promote useful fragments into independent knowledge notes.

**Read → Highlight → Reflect → Link → Create knowledge notes.** Offline lookup, AI translation, and vocabulary collection support this workflow.

## What's new in 1.4.2

This release combines native styling improvements, file association updates, scoped code cleanup, and three confirmed state fixes.

- **Obsidian styling:** Consistent compact typography and spacing for note and word cards, subtle dark-card surface contrast and neutral borders, and theme-native reading colors. Removed colored book selection outlines. Reduced statistics typography and margins, compacted the monthly calendar, separated chart bars from axis labels, and added a weekly reading ranking.
- **File associations:** Follow book and note renames or moves within the vault and recover associations using stable source identities rather than filenames alone.
- **Restore original covers:** Restore the EPUB cover from the book menu after applying a custom image; uploaded image files are retained.
- **Bookmark persistence:** Serialize operations so rollback from a failed save cannot overwrite a later successful change.
- **Reader loading:** Discard obsolete asynchronous results after closing a reader or switching books.
- **Progress:** Do not persist temporary estimates while the EPUB location table is being generated; refresh progress when it becomes available.
- **Focused lookup:** Removed word popups, collected-word marks, and the old setting outside the EPUB reader. EPUB lookup, translation, collection, and existing assets remain available.
- **Code maintenance:** Archived superseded audits, removed unused modules and styles, shared card display and annotation refresh logic, declared the EPUB dependency, and added regression coverage.

**Upgrade impact:** Upgrading from 1.4.1 introduces no new book-note or vocabulary format migration. Existing books, Markdown content, bookmarks, statistics, and collected words remain. The outside-reader lookup setting is retired. Earlier upgrades still run existing migrations: 1.4.0 removed legacy review state, sentence assets, and smart-command settings. Back up notes and plugin data before upgrading.

Related checks and user acceptance were completed in the test vault. The full third-party theme matrix, live sync transport, actual process crashes, and this release's BRAT clean installation/upgrade require separate verification. See the [changelog](./项目管理/03%20改动日志.md) for evidence and limits.

## Features

| Feature | Behavior |
| --- | --- |
| Library | Grid/list browsing; single-click selects, double-click opens and restores reading position |
| Book management | Progress and an overflow menu below covers; metadata, custom/original covers, manual reading time, and deletion |
| Reading layout | Font size, line height, character/word spacing, indentation, width, one/two paginated columns, and single-column scrolling; adapts to sidebar resizing |
| Reading sidebar | Contents, bookmarks, notes/highlights, search and expandable filters |
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

The three runtime files alone do not include the offline dictionary. Replace release files when updating and retain existing data, indexes, caches, and backups. Cloning `main` provides development source, which may contain unreleased changes.

## Reading to knowledge

1. Configure a book folder and add EPUBs; an empty book-folder setting scans the vault.
2. Single-click selects; double-click opens. Adjust layout in the reader and navigate with contents or bookmarks.
3. Select text and right-click to highlight or add a note. Each book uses one Markdown reading note rather than one file per quote.
4. Click an annotation with notes to view its full quote and reflections. Append/edit notes and use `[[wikilinks]]`; each reflection's overflow menu provides editing and deletion.
5. Explicitly create a knowledge note from a useful fragment. Source links return to the reading note or EPUB. Stable source identities support renames/moves; deleting files or moving them outside the vault is different.

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

## Development and history

Edit `src/`; `main.js` is generated. Use Node.js 24:

```sh
npm ci
npm run verify
npm run package:release
```

Verification runs standard/strict core type checks, tests, a production build, and bundle syntax checks. Release ZIPs include the dictionary and notices, not user data.

[Changelog](./项目管理/03%20改动日志.md) · [Release procedure](./项目管理/06%20发布与同步流程.md) · [Past releases](https://github.com/lrb1019/jarvis-reader/releases)
