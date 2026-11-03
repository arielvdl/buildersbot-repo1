/**
 * One `ResizeObserver` for every stage board of a window. A board of the channel and a table of the
 * feed ask it for their size, so ten boards cost one observer and not ten.
 */

const listeners = new Map<Element, (width: number, height: number) => void>();
let observer: ResizeObserver | undefined;

/** Calls `listener` with the rounded size of `element` when it changes. Returns the function that stops. */
export function observeSize(element: Element, listener: (width: number, height: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries)
      listeners.get(entry.target)?.(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
  });
  listeners.set(element, listener);
  observer.observe(element);
  return () => {
    listeners.delete(element);
    observer?.unobserve(element);
  };
}
