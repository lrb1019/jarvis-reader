# Jarvis Reader

Read EPUBs in Obsidian, save quotes and reflections as Markdown, and connect them to knowledge notes. · [中文说明](./README.md)

Version **1.4.6** adds separate dictionary installation, fixes tooltip and theme issues, and updates the installation instructions and licensing documentation. [Release notes](./docs/releases/1.4.6.md) · [GitHub Releases](https://github.com/lrb1019/jarvis-reader/releases).

## Features

| Feature | Workflow |
| --- | --- |
| Library | Browse a grid or list, search by filename, EPUB title or author, filter and sort books, and see reading progress |
| Reading | Double-click a book to resume reading; adjust font size, line height, spacing, indentation and width, or switch between pages and scrolling |
| Highlights and reflections | Select text and right-click to save a quote with multiple reflections and links |
| Markdown notes | Keep one reading note per book, with stable block IDs for each fragment, without creating a file for every highlight |
| Knowledge notes | Choose a fragment to promote with its quote, all reflections and source links; reopen the existing knowledge note if one is found |
| English assistance | Look up words in the local ECDICT dictionary, request AI translations, and choose which words or phrases to save |
| Statistics | Track reading time automatically, add time manually, and view weekly, monthly and yearly charts and reading rankings |

Use the reading sidebar to switch between the table of contents, bookmarks and notes. Each book's menu lets you manage its status, rating, dates, tags and cover, or delete it. Select text and right-click to open the action menu. Lookup is limited to the reader and does not run in ordinary Markdown files. The plugin has no separate vocabulary book or review system.

## Installation and upgrades

### BRAT

Add `lrb1019/jarvis-reader` in BRAT to install a published GitHub release and check for updates. Changes on the development branch may not have been released yet.

### Manual installation

Download the matching plugin ZIP from [Releases](https://github.com/lrb1019/jarvis-reader/releases). Extract its files directly into your vault's `.obsidian/plugins/jarvis-reader/` folder, then enable the plugin under Settings → Community plugins. Do not put the files in an extra nested folder.

- In version 1.4.5, the full ZIP contains the runtime files, `dictionaries/ecdict/` and third-party notices.
- In version 1.4.6 and newer, the plugin ZIP contains `main.js`, `manifest.json`, `styles.css`, `LICENSE` and `THIRD_PARTY_NOTICES.md`. The dictionary is a separate ZIP. The three runtime files are enough for reading and notes; offline lookup also needs dictionary data.

Before upgrading, back up your notes and plugin data and read the release notes. Replace the program files, but keep `data.json`, `index/`, `cache/`, `logs/`, `pending/`, `backups/`, the entire `dictionaries/` folder and your notes. Do not delete the plugin folder first. Reload the plugin or restart Obsidian after upgrading. Full compatibility with custom Obsidian configuration directories has not been verified.

### Separate dictionary installation

1. Download `jarvis-reader-ecdict-*.zip` from this project's official release. Leave it zipped.
2. Open Jarvis Reader settings, choose **词典与词卡 → 导入词典包**, and select the ZIP.
3. Wait for all 26 shards to be checked and saved. The status will then show **已安装**.

Older installed dictionaries still work, and a failed import leaves the previous dictionary in place. Lookup messages distinguish between a missing dictionary, an incomplete installation, corrupted data and a word not found. These conditions do not trigger AI requests or change saved words or notes. Keep the plugin's entire `dictionaries/` folder when upgrading, including imported data and installation records.

The dictionary ZIP is about 18 MB and expands to about 90 MB. Importing needs extra space and keeps existing resource directories. The package includes source information, a content version, SHA-256 checksums and the ECDICT MIT license. Use the companion `.sha256` file to check download integrity. This check does not verify the publisher's identity, so use only this project's official assets.

## Start reading

1. Choose a book folder in settings and add EPUBs. Leave the setting empty to scan the whole vault.
2. Double-click a book. The bookmark, book-note and reading-settings buttons stay at the top right.
3. Select text and right-click to highlight it, add a reflection or look up a word offline.
4. Click an annotation that has reflections to open its card. You can add thoughts or link existing notes with `[[wikilinks]]`. Use each reflection's menu to edit or delete it.
5. Promote a fragment to a knowledge note. Its source links take you back to the reading note or the original passage in the EPUB.

New notes use Markdown templates; existing notes are not rewritten in bulk. Links update when you rename or move files within the vault. Automatic recovery is not guaranteed for deleted files, files moved outside the vault or older broken links. Keep stable block IDs intact so links can find the source passage.

| Folder setting | Default | Purpose |
| --- | --- | --- |
| Books | Empty | Select which EPUBs appear in the library |
| Reading notes | `Reading Notes` | Quotes and reflections for each book |
| Knowledge notes | `Knowledge Notes` | Notes you choose to promote |
| Covers | `Cover` | Uploaded custom cover images |

Set each folder independently using a path relative to the vault. Saving can create missing folders, but changing a setting does not move existing files. Deleting a book keeps its Markdown reading notes and knowledge notes by default. To record reading that was not tracked automatically, add minutes to a selected date. This increases the book's total; it does not replace it.

## Network use and privacy

| Action | Destination and data |
| --- | --- |
| Local reading, notes and offline lookup | Reads EPUBs, Markdown, indexes and installed dictionary data in the vault. Offline lookup does not contact a translation service |
| Requesting AI translation or testing the API | Calls the configured base URL with the selected text and necessary context, or a test word, along with the access key. It does not send whole books, chapters or unrelated notes |
| Clicking a word to pronounce it | Sends the word and accent parameters to `dict.youdao.com` by default, or to an address you configure. You can disable audio. If it fails, the plugin falls back to browser or system speech, whose network use depends on the voice engine |
| Opening the dictionary download link | Opens GitHub in your browser. The plugin does not download or install dictionaries automatically in the background |

Translation presets include OpenAI, DeepSeek, Google Gemini, Zhipu, Qwen, Kimi and MiniMax. You can also configure a custom service. **Requests go to the configured base URL; the protocol label does not identify the company receiving them.** For example, the current Anthropic-format preset uses a DeepSeek-compatible address. Check the address in settings. Providers may require an account and API key, charge for use, and handle requests under their own privacy rules.

API keys are saved with your settings in the plugin's `data.json` file. The plugin does not currently use a separate encrypted credential store. Remove keys before sharing configurations, logs, screenshots or backups, and do not upload the entire plugin data folder. Books with external resources, links you open manually and other plugins may make their own network requests.

| Location (relative to plugin folder, except Markdown) | Content |
| --- | --- |
| `data.json` | Settings, API configuration, reading position, progress, bookmarks and time |
| User-selected Markdown folders | Quotes, all reflections, links and independent knowledge notes |
| `index/highlights.json` | Stable fragment IDs, book and note paths, colors, chapters and EPUB CFIs |
| `index/word-assets.json` | Saved vocabulary, definitions and sources |
| `dictionaries/` | Local dictionary data, imported resources and installation records |
| `cache/`, `logs/`, `pending/`, `backups/` | Caches, audits, pending transactions and recovery files |

Markdown is the source of truth for note content, but it cannot reconstruct lost EPUB CFI positions on its own. Back up both notes and indexes.

## Compatibility and limitations

- Version 1.4.6 requires desktop Obsidian `1.14.5` or newer. Testing used Obsidian `1.14.5` on macOS. Mobile testing is still pending, so this version temporarily blocks mobile installation. Previously published releases are unchanged.
- A clean installation with the three runtime files and a BRAT upgrade from `1.4.5` to `1.4.6` have been verified. The full range of themes, marketplace installation, other BRAT upgrade paths, real sync conflicts and forced process termination have not all been tested. See the [release notes](./docs/releases/1.4.6.md) (Chinese).
- The optional layout adjustment for Claudian's Zen mode uses its internal CSS. It may affect other panes or cover text at the bottom of the reader. Claudian is not required for reading.
- See [third-party notices](./THIRD_PARTY_NOTICES.md) for the distribution review and full license texts. The react-reader package metadata and license file differ. Both ISC and Apache-2.0 terms are retained; this does not claim that upstream allows a choice between them. The project has not been submitted to or approved for the community directory.

## Development and support

Use Node.js 24 or newer:

```sh
npm ci
npm run verify
npm run package:release
```

Before publishing, run `npm run submission:check` to check version metadata, the production runtime and bundled notices. Release CI runs the same check. Passing it does not mean the plugin has been approved by Obsidian.

After changing dependencies, run `npm run licenses:generate` and review the diff. The license check compares dependencies, review records and bundled notices. It does not replace a review of licensing and redistribution requirements. Verification includes standard type checks, strict type checks for core modules, tests, a production build and a syntax check of the bundle. Build the runtime files from `src/`. The plugin ZIP, dictionary ZIP and checksum files are written to `release/` and contain no user data.

Report problems through [GitHub Issues](https://github.com/lrb1019/jarvis-reader/issues). Include the plugin and Obsidian versions, operating system, theme, steps to reproduce the problem and redacted logs. Do not share API keys, private books or an entire vault.

## License and acknowledgments

Jarvis Reader's original code is licensed under the [MIT License](./LICENSE), Copyright © 2026 Bylrb. Third-party code and ECDICT data keep their own licenses. Thanks to the EPUB, React and ECDICT open-source projects. Sources, versions and license texts are listed in [Third-Party Notices](./THIRD_PARTY_NOTICES.md) and embedded in the generated `main.js`, so they are included even when you install only the three runtime files.
