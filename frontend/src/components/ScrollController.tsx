/**
 * ============================================================================
 * FILE: ScrollController.tsx
 * LOCATION: frontend/src/components/ScrollController.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Keep the transcript pinned to the bottom only while the user is near it.
 *
 * ROLE IN PROJECT:
 *    Prevents streaming tokens from stealing scroll position when the reader
 *    has moved up, and offers a jump-to-bottom control otherwise.
 *
 * KEY COMPONENTS:
 *    - Near-bottom detection
 *    - Sticky auto-scroll
 *    - Jump-to-bottom button
 * ============================================================================
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { IconChevronDown } from './icons.tsx';

export function ScrollController({
  scrollContainerRef,
  dependencies,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  dependencies: unknown[];
}) {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceToBottom < 100;
      isNearBottomRef.current = nearBottom;
      setShowScrollBottom(!nearBottom);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isNearBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [dependencies, scrollContainerRef]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (!showScrollBottom) {
    return null;
  }

  return (
    <button
      type="button"
      className="aurvin-scroll-bottom"
      onClick={scrollToBottom}
      aria-label="Scroll to bottom"
    >
      <IconChevronDown />
    </button>
  );
}
