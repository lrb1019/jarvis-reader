/** Presentation only: keep the Markdown timestamp protocol unchanged. */
export function styleBookNoteTimes(root: HTMLElement, chapterTitleFor?: (callout: HTMLElement) => string | undefined): void {
  const callouts = Array.from(root.querySelectorAll<HTMLElement>(".callout-content"));
  if (root.matches(".callout-content")) callouts.unshift(root);
  for (const content of callouts) {
    if (content.dataset.jarvisTimesStyled || !Array.from(content.querySelectorAll("a")).some(
      (link) => link.getAttribute("href")?.startsWith("obsidian://jarvis-reader?"),
    )) continue;
    content.dataset.jarvisTimesStyled = "true";
    const callout = content.closest<HTMLElement>(".callout");
    const title = callout?.querySelector<HTMLElement>(":scope > .callout-title .callout-title-inner");
    const chapter = callout && chapterTitleFor?.(callout);
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    // Keep native callout controls, and keep the chapter name when no enclosing
    // Markdown heading can be confirmed (e.g. embedded or partial rendering).
    if (title && chapter && normalize(title.textContent || "") === normalize(chapter)) {
      title.textContent = "摘录";
    }
    const fragmentTimes: HTMLElement[] = [];
    const noteTimes: HTMLElement[] = [];
    // The fragment's update time may share a paragraph with its source link.
    // Isolate just the label and date; leave the link and user content intact.
    for (const label of Array.from(content.querySelectorAll("strong"))) {
      if (label.textContent !== "时间") continue;
      const br = label.nextSibling;
      const date = br?.nextSibling;
      if (br?.nodeName !== "BR" || date?.nodeType !== 3 || !/^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s*$/.test(date.textContent || "")) continue;
      const row = content.ownerDocument.createElement("p");
      row.className = "jarvis-book-note-time";
      fragmentTimes.push(row);
      let container: Element = label;
      while (container.parentElement && container.parentElement !== content) container = container.parentElement;
      const startsParagraph = container.tagName === "P" && container.firstChild === label;
      content.insertBefore(row, startsParagraph ? container : container.nextSibling);
      const trailingBreak = date.nextSibling;
      row.append(label, br, date);
      if (trailingBreak?.nodeName === "BR") trailingBreak.remove();
    }
    const children = Array.from(content.children);
    for (const header of children) {
      if (header.tagName !== "P") continue;
      const label = header.firstElementChild;
      if (label?.tagName !== "STRONG" || !/^(?:笔记|想法)(?:\s+\d+)?$/.test(label.textContent || "")) continue;
      const time = (header.textContent || "").match(/created:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s*$/i);
      // Only the generated label + time paragraph is safe to rearrange.
      if (!time || (header.textContent || "").slice((label.textContent || "").length).trim() !== time[0].trim()) continue;
      header.classList.add("jarvis-book-note-label");
      const nextBoundary = children.slice(children.indexOf(header) + 1).find((child) =>
        child.classList.contains("jarvis-book-note-time") || /^H[1-6]$/.test(child.tagName) || (child.tagName === "P" && /^(?:笔记|想法)(?:\s+\d+)?$|^时间$/.test(child.firstElementChild?.textContent || "")),
      );
      while (label.nextSibling) label.nextSibling.remove();
      const footer = content.ownerDocument.createElement("p");
      footer.className = "jarvis-book-note-time";
      footer.textContent = `记录于 ${time[1]}`;
      noteTimes.push(footer);
      content.insertBefore(footer, nextBoundary || null);
    }
    // A personal note already has its own record time; omit the redundant
    // fragment update time only when every note has a readable timestamp.
    const noteCount = children.filter((child) => child.tagName === "P"
      && /^(?:笔记|想法)(?:\s+\d+)?$/.test(child.firstElementChild?.textContent || "")).length;
    if (noteTimes.length && noteTimes.length === noteCount) {
      for (const time of fragmentTimes) time.remove();
    }
    for (const link of Array.from(content.querySelectorAll<HTMLAnchorElement>("a"))) {
      if (link.textContent !== "返回原文" || !link.getAttribute("href")?.startsWith("obsidian://jarvis-reader?")) continue;
      const oldParent = link.parentElement;
      const row = content.ownerDocument.createElement("p");
      row.className = "jarvis-book-note-source";
      row.append(link);
      content.append(row);
      // Remove only an empty paragraph left behind, never a list or user content.
      if (oldParent?.tagName === "P" && !oldParent.textContent?.trim()
        && Array.from(oldParent.children).every((child) => child.tagName === "BR")) oldParent.remove();
      const lastTime = row.previousElementSibling;
      if (lastTime?.classList.contains("jarvis-book-note-time")) {
        const footer = content.ownerDocument.createElement("div");
        footer.className = "jarvis-book-note-footer";
        content.insertBefore(footer, lastTime);
        footer.append(lastTime, row);
      }
    }
  }
}
