import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { readEpubCreators } from "../src/library/epub-metadata.ts";
import { matchesBookSearch } from "../src/library/book-search.ts";

test("EPUB 2 and 3 preserve all creators regardless of namespace prefix", () => {
  for (const version of ["2.0", "3.0"]) {
    const doc = new DOMParser().parseFromString(`<package version="${version}" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:d="http://purl.org/dc/elements/1.1/"><d:creator> Jake Knapp </d:creator><d:creator>John Zeratsky</d:creator><d:creator>Jake Knapp</d:creator><d:creator> </d:creator></metadata></package>`, "application/xml");
    const creators = readEpubCreators(doc);
    assert.deepEqual(creators, ["Jake Knapp", "John Zeratsky"]);
    assert.equal(matchesBookSearch("Zeratsky", creators), true);
  }
});

test("missing creators stay empty and supplied names are not reinterpreted", () => {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  assert.deepEqual(readEpubCreators(parse('<package/>')), []);
  assert.deepEqual(readEpubCreators(parse('<package><metadata/></package>')), []);
  assert.deepEqual(readEpubCreators(parse('<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Kovid Goyal</dc:creator><dc:creator>Richard Howard</dc:creator></metadata></package>')), ["Kovid Goyal", "Richard Howard"]);
});
