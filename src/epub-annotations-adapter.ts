interface AnnotationStore {
  remove(cfi: string, type: string): void;
  _annotations: Record<string, unknown>;
  _annotationsBySectionIndex: Record<string, string[]>;
}

/** epub.js 0.3 私有接口适配：无视图时 remove 遗留章节索引，升级引擎时需复核。 */
export function removeEpubAnnotation(store: AnnotationStore, cfi: string, type: string): void {
  store.remove(cfi, type);
  // 同时清除此前操作留下的无效编号，并去掉重复编号。
  for (const section of Object.keys(store._annotationsBySectionIndex)) {
    store._annotationsBySectionIndex[section] = [...new Set(
      store._annotationsBySectionIndex[section].filter((key) => Object.hasOwn(store._annotations, key)),
    )];
  }
}
