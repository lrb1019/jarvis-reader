import type { WordAsset } from "../domain/index.ts";

interface WordAnnotationApi {
  underline(
    cfiRange: string,
    data: unknown,
    callback: (event: MouseEvent) => void,
    className: string,
    styles: Record<string, string>,
  ): unknown;
  remove(cfiRange: string, type: "underline"): void;
}

export interface WordAssetRenditionLike {
  annotations?: WordAnnotationApi;
}

const rendered = new WeakMap<object, Set<string>>();

function colorFor(asset: WordAsset): string {
  if (asset.kind === "sentence") return "#22c55e";
  if (asset.kind === "phrase") return "#a855f7";
  return "#3b82f6";
}

export function renderWordAssets(
  rendition: WordAssetRenditionLike,
  assets: readonly WordAsset[],
  bookPath: string,
  onClick: (asset: WordAsset, event: MouseEvent) => void,
): void {
  if (!rendition.annotations) return;
  let ids = rendered.get(rendition as object);
  if (!ids) {
    ids = new Set();
    rendered.set(rendition as object, ids);
  }
  for (const asset of assets) {
    for (const source of asset.sources || []) {
      if (source.bookPath !== bookPath || !source.cfiRange || ids.has(source.cfiRange)) continue;
      rendition.annotations.underline(
        source.cfiRange,
        { lemma: asset.lemma },
        (event) => onClick(asset, event),
        `jarvis-reader-word-${asset.kind}`,
        { stroke: colorFor(asset), "stroke-opacity": "0.92", "stroke-width": "1.5" },
      );
      ids.add(source.cfiRange);
    }
  }
}

export function removeWordAssetMarks(
  rendition: WordAssetRenditionLike,
  asset: WordAsset,
  bookPath: string,
): void {
  const ids = rendered.get(rendition as object);
  for (const source of asset.sources || []) {
    if (source.bookPath !== bookPath || !source.cfiRange) continue;
    rendition.annotations?.remove(source.cfiRange, "underline");
    ids?.delete(source.cfiRange);
  }
}
