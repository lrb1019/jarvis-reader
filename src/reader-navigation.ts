/** epub.js 0.3 的视图尺寸接口；集中隔离第三方布局调用。 */
export interface NavigationRendition {
  display(target: string): Promise<unknown>;
  getContents(): Array<{ document: { fonts?: { ready: PromiseLike<unknown> } } }>;
  manager?: { viewSettings?: { width?: number; height?: number } };
  views(): { all(): Array<{ expand(): void; size?(width: number, height: number): void }> };
}

/** 加载目标章节后，按应用主题和字体重新计算可滚动范围，再完成精确定位。 */
export async function displayReadingSource(
  rendition: NavigationRendition,
  target: string,
  isCurrent: () => boolean = () => true,
  nextFrame: () => Promise<void> = () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
): Promise<boolean> {
  // Obsidian 激活隐藏标签后，需要一次布局才能测量正文。
  await nextFrame();
  if (!isCurrent()) return false;
  await rendition.display(target);
  if (!isCurrent()) return false;
  await Promise.all(rendition.getContents().map((contents) => contents.document.fonts?.ready));
  await nextFrame();
  if (!isCurrent()) return false;
  // 隐藏标签中创建的 epub.js 视图可能锁定了 0px 高度。再次展开只会
  // 重算正文宽度，必须先用当前布局尺寸重新锁定视图，才能显示正文。
  const { width, height } = rendition.manager?.viewSettings ?? {};
  for (const view of rendition.views().all()) {
    if (width && height) view.size?.(width, height);
    view.expand();
  }
  await rendition.display(target);
  return isCurrent();
}
