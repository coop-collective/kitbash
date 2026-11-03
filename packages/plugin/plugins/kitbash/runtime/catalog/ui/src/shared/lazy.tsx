"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface LazyMountProps {
  children: ReactNode;
  /** Shown until the area nears the viewport; give it the real content's height so nothing jumps */
  fallback?: ReactNode;
  /** How far ahead of the viewport to start rendering */
  rootMargin?: string;
  /** Reserved height while waiting, when there is no fallback */
  minHeight?: number;
  className?: string;
}

/**
 * Renders its children only once they come near the viewport, then keeps them mounted. Use it for heavy charts and
 * long feeds below the fold; pair it with a component's `loading` skeleton as the fallback. Without
 * IntersectionObserver (or on the server) it renders the fallback first and mounts on the client.
 */
export function LazyMount({ children, fallback = null, rootMargin = "200px", minHeight, className }: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, shown]);

  return (
    <div ref={ref} className={className} style={!shown && !fallback && minHeight ? { minHeight } : undefined}>
      {shown ? children : fallback}
    </div>
  );
}
