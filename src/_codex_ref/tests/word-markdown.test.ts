import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWordEntryBlock,
  deleteWordEntryInContent,
  ensureWordBookSections,
  extractWordCardDisplayFromContent,
  getWordEntrySectionTitle,
  insertWordEntryIntoSection,
  upsertWordEntryInContent,
  type WordEntryAsset,
} from "../src/core/word-markdown.ts";

const word: WordEntryAsset = {
  lemma: "underestimate",
  title: "underestimate",
  kind: "word",
  isWord: true,
  display: "**中文释义**：低估",
};

test("normalizes legacy English headings and creates missing Chinese sections", () => {
  const result = ensureWordBookSections("# Book\n\n## Words\n\n## Phrases\n");
  assert.equal(result, "# Book\n\n## 单词\n## 短语\n\n## 句子\n");
});

test("maps assets to the three Chinese sections", () => {
  assert.equal(getWordEntrySectionTitle("word"), "单词");
  assert.equal(getWordEntrySectionTitle("phrase"), "短语");
  assert.equal(getWordEntrySectionTitle("sentence"), "句子");

  const phraseContent = insertWordEntryIntoSection("# Book", {
    ...word,
    lemma: "in spite of",
    title: "in spite of",
    kind: "phrase",
  });
  assert.ok(phraseContent.indexOf("### in spite of") > phraseContent.indexOf("## 短语"));
  assert.ok(phraseContent.indexOf("### in spite of") < phraseContent.indexOf("## 句子"));
});

test("extracts the complete generated Card body for one word entry", () => {
  const content = `<!-- jarvis-reader-word-entry:jr-word-face:start -->
### face

<!-- jarvis-reader-word:start -->
## Card
**名词** /feɪs/

**英英释义**：the front part of a person's head.

**中文释义**：脸；面部。
<!-- jarvis-reader-word:end -->

^jr-word-face
<!-- jarvis-reader-word-entry:jr-word-face:end -->`;
  assert.equal(
    extractWordCardDisplayFromContent(content, { lemma: "face" }),
    "**名词** /feɪs/\n\n**英英释义**：the front part of a person's head.\n\n**中文释义**：脸；面部。",
  );
});

test("builds the exact persisted entry envelope", () => {
  assert.equal(
    buildWordEntryBlock(word),
    `<!-- jarvis-reader-word-entry:jr-word-underestimate:start -->
### underestimate

<!-- jarvis-reader-word:start -->
## Card
**中文释义**：低估

<!-- jarvis-reader-word:end -->

^jr-word-underestimate
<!-- jarvis-reader-word-entry:jr-word-underestimate:end -->`,
  );
});

test("upsert updates only the generated Card block", () => {
  const initial = `${buildWordEntryBlock(word)}\n\n## Thoughts\nkeep me`;
  const updated = upsertWordEntryInContent(initial, {
    ...word,
    display: "**中文释义**：严重低估",
  });
  assert.match(updated, /严重低估/);
  assert.doesNotMatch(updated, /：低估\n/);
  assert.match(updated, /## Thoughts\nkeep me/);
});

test("delete removes the complete entry and preserves surrounding sections", () => {
  const content = `# Book\n\n## 单词\n\n${buildWordEntryBlock(word)}\n\n## 短语\n\n## 句子\n`;
  const result = deleteWordEntryInContent(content, word);
  assert.equal(result, "# Book\n\n## 单词\n\n## 短语\n\n## 句子\n");
});
