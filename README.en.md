# Jarvis Reader

Read EPUBs inside Obsidian, save quotes and reflections as Markdown, and connect them to knowledge notes. · [中文说明](./README.md)

Current version: **1.4.6**. Adds separate dictionary installation, tooltip and theme fixes, and clearer installation and licensing documentation. [Release notes](./docs/releases/1.4.6.md) · [GitHub Releases](https://github.com/lrb1019/jarvis-reader/releases).

## Features

| Feature | Workflow |
| --- | --- |
| Library | Grid/list browsing; filename, EPUB title and author search; filtering, sorting and progress |
| Reading | Double-click to open and restore position; font size, line height, spacing, indentation, width, pagination and scrolling |
| Highlights and reflections | Select text and right-click; keep multiple reflections and links on one quote |
| Markdown notes | One reading note per book, with stable block IDs for fragments; no file per highlight |
| Knowledge notes | Explicitly promote a fragment with its quote, all reflections and source links; reopen an existing promoted note when found |
| English assistance | Local ECDICT lookup, explicit AI translation and manual word/phrase collection |
| Statistics | Automatic time, manual additions, weekly/monthly/yearly charts and reading rankings |

Switch contents, bookmarks and notes in the reading sidebar. Book status, rating, dates, tags, covers and deletion are managed from each book's menu. Selecting text alone does not open a menu: right-click it. Ordinary Markdown files do not receive global lookup. There is no standalone vocabulary book or review system.

## Installation and upgrades

### BRAT

Add `lrb1019/jarvis-reader` in BRAT to install a published GitHub Release and check for updates. The development branch is not a published version.

### Manual installation

Download the matching plugin ZIP from [Releases](https://github.com/lrb1019/jarvis-reader/releases). Extract it directly into your vault's `.obsidian/plugins/jarvis-reader/`, then enable it under Settings → Community plugins. Do not add an extra nested folder.

- **Published 1.4.5:** the full ZIP contains runtime files, `dictionaries/ecdict/` and third-party notices.
- **1.4.6 and newer:** the plugin ZIP contains `main.js`, `manifest.json`, `styles.css`, `LICENSE` and `THIRD_PARTY_NOTICES.md`. The dictionary is a separate ZIP. The three runtime files alone support reading and notes; offline lookup needs dictionary data.

Before upgrading, back up notes and plugin data and read the relevant release notes. Replace program files while retaining `data.json`, `index/`, `cache/`, `logs/`, `pending/`, `backups/`, the entire `dictionaries/` folder and user notes. Do not delete the whole plugin folder first. Reload the plugin or restart Obsidian after upgrading. Full compatibility with custom Obsidian configuration directories remains unverified.

### Separate dictionary installation (unreleased)

1. Download `jarvis-reader-ecdict-*.zip` from this project's official Release without extracting it. This asset will be provided with a future release.
2. In Jarvis Reader settings, choose **词典与词卡 → 导入词典包** and select the ZIP.
3. Wait until all 26 shards have been validated and saved and the status shows **已安装**.

Existing legacy dictionaries remain usable. Failed imports preserve the previous dictionary. Missing, incomplete, corrupt and no-match states are distinguished; none automatically invokes AI or modifies collected words or notes. Keep the plugin's entire `dictionaries/` folder, including imported data and installation records, during upgrades.

The ZIP is approximately 18 MB and the extracted data approximately 90 MB. Importing requires additional space and retains previous resource directories. The package includes source information, a content version, SHA-256 checksums and the ECDICT MIT license. The companion `.sha256` file checks download integrity, not publisher identity; use official project assets only.

## Start reading

1. Configure a book folder and add EPUBs. Leaving it empty scans the vault.
2. Double-click a book. Bookmark, book-note and reading-settings buttons remain at the top right.
3. Select text and right-click to highlight, reflect or look up a word offline.
4. Click an annotation with reflections to open its card, append thoughts or link existing content with `[[wikilinks]]`. Each reflection's menu provides editing and deletion.
5. Promote a useful fragment to a knowledge note and use its source links to return to the reading note or EPUB. The lightbulb icon and updated tooltips are unreleased interface changes.

New notes use Markdown templates; existing notes are not rewritten in bulk. Normal in-vault renames/moves are handled by association updates, but deleted files, moves outside the vault and historical broken links cannot be guaranteed to recover automatically. Preserve stable block IDs for source positioning.

| Folder setting | Default | Purpose |
| --- | --- | --- |
| Books | Empty | Filter EPUBs in the library |
| Reading notes | `Reading Notes` | Quotes and reflections per book |
| Knowledge notes | `Knowledge Notes` | Explicitly promoted notes |
| Covers | `Cover` | Uploaded custom images |

Folders are independent vault-relative settings. Saving can create missing folders; changing a setting does not move existing files. Book deletion preserves Markdown reading and knowledge notes by default. Manual reading time adds minutes to a selected date for reading not automatically recorded; it does not replace the book's total.

## Network use and privacy

| Action | Destination and data |
| --- | --- |
| Local reading, notes and offline lookup | Reads vault EPUBs, Markdown, indexes and installed dictionary data; offline definitions do not request a translation service |
| Explicit AI translation or the API test button | Calls the configured base URL with selected text and necessary context, or a test word, and the access key; no entire book, chapter or unrelated notes |
| Clicking a word to pronounce it | Sends the word and accent parameters to `dict.youdao.com` by default, or a configured alternative. Audio can be disabled. Failure falls back to browser/system speech; network behavior depends on its voice engine |
| Opening the dictionary download link | Opens GitHub in the browser; the plugin does not automatically download or install dictionaries in the background |

Translation presets involve OpenAI, DeepSeek, Google Gemini, Zhipu, Qwen, Kimi and MiniMax, plus custom services. **The base URL determines the actual recipient; a protocol label does not identify the receiving company.** For example, the current Anthropic-format preset uses a DeepSeek-compatible address. Check the settings. Providers may require their own account/key and charge for use; requests are handled under their privacy rules.

API keys are stored with settings in plugin `data.json`; the current implementation does not use a separate encrypted credential store. Remove keys before sharing configurations, logs, screenshots or backups. Do not upload the complete plugin data folder. External resources inside a book, manually opened links and other plugins may make their own network requests.

| Location (relative to plugin folder, except Markdown) | Content |
| --- | --- |
| `data.json` | Settings, API configuration, position, progress, bookmarks and time |
| User-selected Markdown folders | Quotes, all reflections, links and independent knowledge notes |
| `index/highlights.json` | Stable fragment identities, book/note paths, colors, chapters and EPUB CFIs |
| `index/word-assets.json` | Collected vocabulary, definitions and sources |
| `dictionaries/` | Local dictionary data, imported resources and installation records |
| `cache/`, `logs/`, `pending/`, `backups/` | Caches, audits, pending transactions and recovery material |

Markdown is authoritative for note content; it cannot reconstruct lost EPUB CFI positions on its own. Back up notes and indexes.

## Compatibility and limitations

- Version 1.4.6 currently supports desktop Obsidian `1.14.5` or newer. Runtime acceptance uses macOS `1.14.5`. Mobile host testing is pending, so this version temporarily disables mobile installation; previously published releases are unchanged.
- Complete theme coverage, clean marketplace installations, every BRAT upgrade path, real sync conflicts and forced process termination are not all verified. See [current status and risks](./项目管理/04%20接续说明.md) (Chinese).
- Optional Claudian Zen-mode layout adaptation depends on internal CSS and can affect other panes or cover bottom text. Claudian is not required for reading.
- Distribution review and complete license texts are in [third-party notices](./THIRD_PARTY_NOTICES.md). The react-reader metadata/file discrepancy is disclosed, and both ISC and Apache-2.0 terms are retained; no upstream dual-license choice is asserted. This project has not been submitted to or approved for the community directory.

## Development and support

Use Node.js 24 or newer:

```sh
npm ci
npm run verify
npm run package:release
```

Before publishing, run `npm run submission:check` to verify metadata, production runtime and carried notices. Release CI runs the same gate. Passing local checks does not mean approval by Obsidian.

After dependency changes, run `npm run licenses:generate` and review the diff. The license check verifies inventory consistency, not resolution of upstream permission questions. Verification covers standard/strict-core type checks, tests, a build and bundle syntax. Runtime code is generated from `src/`. Plugin and dictionary ZIPs and checksums are written to `release/`, excluding user data.

Report issues through [GitHub Issues](https://github.com/lrb1019/jarvis-reader/issues), including plugin/Obsidian versions, OS, theme, reproduction steps and redacted logs. Do not publish keys, private books or entire vaults.

## License and acknowledgments

Jarvis Reader's original code is under the [MIT License](./LICENSE), Copyright © 2026 Bylrb. Third-party code and ECDICT data retain their own licenses. Thanks to the EPUB, React and ECDICT open-source projects; source information, versions and supplied license texts are in [Third-Party Notices](./THIRD_PARTY_NOTICES.md). The notices are also embedded in generated `main.js` for users who install only the three runtime files.
