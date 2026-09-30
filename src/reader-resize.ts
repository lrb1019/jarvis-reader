export interface ResizableRendition {
  on(event: "attached", callback: () => void): void;
  off(event: "attached", callback: () => void): void;
  resize(): void;
}

interface ResizeHost {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export interface ReaderResizeEnvironment {
  observe(host: ResizeHost, callback: () => void): () => void;
  delay(callback: () => void): () => void;
}

const browserEnvironment: ReaderResizeEnvironment = {
  observe(host, callback) {
    const observer = new ResizeObserver(callback);
    observer.observe(host as HTMLElement);
    return () => observer.disconnect();
  },
  delay(callback) {
    const timer = window.setTimeout(callback, 100);
    return () => window.clearTimeout(timer);
  },
};

/** Container changes (sidebar toggles / splits) do not emit window.resize.
 * Keep percentage sizing; epub.js resize() remeasures its actual stage and
 * redisplays its current CFI. Do not replay a captured, possibly stale location.
 */
export function bindReaderContainerResize(
  host: ResizeHost,
  rendition: ResizableRendition,
  environment: ReaderResizeEnvironment = browserEnvironment,
): () => void {
  let attached = false;
  let disposed = false;
  let cancelPending: (() => void) | undefined;
  const schedule = () => {
    if (disposed || !attached) return;
    cancelPending?.();
    cancelPending = environment.delay(() => {
      cancelPending = undefined;
      if (!disposed && host.clientWidth > 0 && host.clientHeight > 0) {
        rendition.resize();
      }
    });
  };
  const onAttached = () => {
    attached = true;
    schedule();
  };
  rendition.on("attached", onAttached);
  const disconnect = environment.observe(host, schedule);
  return () => {
    disposed = true;
    cancelPending?.();
    disconnect();
    rendition.off("attached", onAttached);
  };
}
