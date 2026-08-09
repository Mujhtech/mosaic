import { useEffect, useState } from "react";

/**
 * Reports whether an element has entered the viewport at least once, and
 * supplies the ref to attach to it.
 *
 * The latch is deliberate: work deferred until an element is seen — a fetch, a
 * heavy render — must not be undone the moment the element scrolls back out,
 * or scrolling a long list up and down would repeat it endlessly.
 *
 * Nothing is observed during server rendering, so the first client paint
 * matches the server's and hydration stays quiet. Where `IntersectionObserver`
 * is missing entirely the element is treated as visible, because withholding
 * content forever is worse than rendering it eagerly.
 */
export function useHasBeenVisible(options?: { rootMargin?: string }) {
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  const rootMargin = options?.rootMargin;

  useEffect(() => {
    if (visible || !element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      rootMargin ? { rootMargin } : undefined
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin, visible]);

  return { ref: setElement, visible } as const;
}
