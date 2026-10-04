const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";

export interface MetadataElement {
  textContent: string | null;
  getElementsByTagNameNS(namespace: string, name: string): ArrayLike<MetadataElement>;
}

/** EPUB 2 and 3 share Dublin Core metadata; preserve all named creators. */
export function readEpubCreators(document: MetadataElement): string[] {
  const metadata = document.getElementsByTagNameNS("*", "metadata")[0];
  if (!metadata) return [];
  const creators = Array.from(metadata.getElementsByTagNameNS(DC_NAMESPACE, "creator"))
    .map(element => (element.textContent || "").trim()).filter(Boolean);
  return [...new Set(creators)];
}
