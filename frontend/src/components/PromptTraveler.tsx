/**
 * ============================================================================
 * FILE: PromptTraveler.tsx
 * LOCATION: frontend/src/components/PromptTraveler.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Right-side prompt minimap rail and hover popover for jumping to past prompts.
 *
 * ROLE IN PROJECT:
 *    Extracts user prompts from the active conversation transcript, renders a
 *    vertical tick-mark rail with dock-style vertical hover magnification,
 *    displays a synchronized floating prompt history window on hover, and
 *    scrolls the chosen prompt to the top of the transcript on click.
 *
 * KEY COMPONENTS:
 *    - extractUserPrompts: Filters visible transcript records to user prompts.
 *    - computeTickMetrics: Calculates cosine-wave bar widths and opacities.
 *    - computeRailHoverState: Maps pointer Y on the rail to slot, prompt, and scroll ratio.
 *    - scrollTranscriptToPrompt: Scrolls a prompt bubble to the top of the transcript.
 *    - PromptTraveler: Interactive rail and popover component.
 * ============================================================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { VisibleMessage } from '../api/protocol.ts';

export const MAX_VISIBLE_TICKS = 8;
const BASE_TICK_WIDTH_PX = 10;
const ACTIVE_REST_TICK_WIDTH_PX = 18;
const PEAK_HOVER_TICK_WIDTH_PX = 22;
export const TICK_HEIGHT_PX = 2;
const BASE_TICK_OPACITY = 0.28;
const PEAK_TICK_OPACITY = 1;
const WAVE_RADIUS_SLOTS = 2.25;
const TRANSCRIPT_TOP_OFFSET_PX = 12;

export interface PromptTravelItem {
  messageId: string;
  turnId: string;
  content: string;
  index: number;
}

export interface TickMetric {
  slot: number;
  widthPx: number;
  heightPx: number;
  opacity: number;
  isHighlighted: boolean;
}

export interface RailHoverState {
  ratio: number;
  hoverSlot: number;
  promptIndex: number;
  windowStart: number;
}

export function extractUserPrompts(messages: readonly VisibleMessage[]): PromptTravelItem[] {
  const prompts: PromptTravelItem[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || message.voiceSessionId) {
      continue;
    }
    if (message.content.trim().length === 0) {
      continue;
    }
    prompts.push({
      messageId: message.messageId,
      turnId: message.turnId,
      content: message.content,
      index: prompts.length,
    });
  }
  return prompts;
}

export function computeWindowBounds(
  totalPrompts: number,
  anchorPromptIndex: number,
  visibleCount = Math.min(totalPrompts, MAX_VISIBLE_TICKS),
): { windowStart: number; windowEnd: number; canScrollUp: boolean; canScrollDown: boolean } {
  if (totalPrompts <= 0 || visibleCount <= 0) {
    return { windowStart: 0, windowEnd: 0, canScrollUp: false, canScrollDown: false };
  }
  const clampedAnchor = Math.max(0, Math.min(totalPrompts - 1, anchorPromptIndex));
  const maxStart = Math.max(0, totalPrompts - visibleCount);
  const idealStart = clampedAnchor - Math.floor((visibleCount - 1) / 2);
  const windowStart = Math.max(0, Math.min(maxStart, idealStart));
  const windowEnd = Math.min(totalPrompts, windowStart + visibleCount);
  return {
    windowStart,
    windowEnd,
    canScrollUp: windowStart > 0,
    canScrollDown: windowEnd < totalPrompts,
  };
}

export function computeTickMetrics(
  visibleCount: number,
  activeSlot: number,
  hoverSlot: number | null,
): TickMetric[] {
  const metrics: TickMetric[] = [];
  const clampedActiveSlot = Math.max(0, Math.min(Math.max(0, visibleCount - 1), activeSlot));

  for (let slot = 0; slot < visibleCount; slot += 1) {
    if (hoverSlot === null) {
      const isHighlighted = slot === clampedActiveSlot;
      metrics.push({
        slot,
        widthPx: isHighlighted ? ACTIVE_REST_TICK_WIDTH_PX : BASE_TICK_WIDTH_PX,
        heightPx: TICK_HEIGHT_PX,
        opacity: isHighlighted ? PEAK_TICK_OPACITY : BASE_TICK_OPACITY,
        isHighlighted,
      });
      continue;
    }

    const distance = Math.abs(slot - hoverSlot);
    const wave =
      distance >= WAVE_RADIUS_SLOTS
        ? 0
        : Math.cos((distance / WAVE_RADIUS_SLOTS) * (Math.PI / 2));
    const widthPx =
      Math.round((BASE_TICK_WIDTH_PX + (PEAK_HOVER_TICK_WIDTH_PX - BASE_TICK_WIDTH_PX) * wave) * 10) /
      10;
    const opacity =
      Math.round((BASE_TICK_OPACITY + (PEAK_TICK_OPACITY - BASE_TICK_OPACITY) * wave) * 100) / 100;
    const isHighlighted = distance <= 0.55;
    metrics.push({
      slot,
      widthPx,
      heightPx: TICK_HEIGHT_PX,
      opacity,
      isHighlighted,
    });
  }

  return metrics;
}

export function computeRailHoverState(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  totalPrompts: number,
  visibleCount = Math.min(totalPrompts, MAX_VISIBLE_TICKS),
): RailHoverState {
  if (totalPrompts <= 1 || visibleCount <= 1 || rectHeight <= 0) {
    return { ratio: 0, hoverSlot: 0, promptIndex: 0, windowStart: 0 };
  }
  const rawRatio = (clientY - rectTop) / rectHeight;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const hoverSlot = ratio * (visibleCount - 1);
  const promptIndex = Math.round(ratio * (totalPrompts - 1));
  const maxStart = Math.max(0, totalPrompts - visibleCount);
  const windowStart = Math.round(ratio * maxStart);
  return { ratio, hoverSlot, promptIndex, windowStart };
}

function findPromptElement(container: HTMLElement, messageId: string): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const el of candidates) {
    if (el.getAttribute('data-message-id') === messageId) {
      return el;
    }
  }
  return null;
}

export function scrollTranscriptToPrompt(
  container: HTMLElement | null,
  messageId: string,
  behavior: ScrollBehavior = 'smooth',
): boolean {
  if (!container || !messageId) {
    return false;
  }
  const target = findPromptElement(container, messageId);
  if (!target) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const relativeTop =
    containerRect.height > 0 || targetRect.height > 0
      ? targetRect.top - containerRect.top + container.scrollTop
      : target.offsetTop;
  const desiredScrollTop = Math.max(0, relativeTop - TRANSCRIPT_TOP_OFFSET_PX);

  // Ensure enough scroll room below so the chosen prompt can reach the top of the viewport.
  const currentPad =
    Number.parseFloat(container.style.getPropertyValue('--aurvin-prompt-travel-pad') || '0') || 0;
  const baseScrollHeight = Math.max(0, container.scrollHeight - currentPad);
  const maxAvailableScroll = Math.max(0, baseScrollHeight - container.clientHeight);
  const requiredExtraPad = Math.max(0, Math.ceil(desiredScrollTop - maxAvailableScroll));
  if (requiredExtraPad > 0) {
    container.style.setProperty('--aurvin-prompt-travel-pad', `${requiredExtraPad}px`);
  } else if (currentPad > 0) {
    container.style.removeProperty('--aurvin-prompt-travel-pad');
  }

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: desiredScrollTop, behavior });
  } else {
    container.scrollTop = desiredScrollTop;
  }
  return true;
}

export function PromptTraveler({
  scrollContainerRef,
  messages,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messages: readonly VisibleMessage[];
}) {
  const prompts = useMemo(() => extractUserPrompts(messages), [messages]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [hoveredPromptIndex, setHoveredPromptIndex] = useState<number | null>(null);
  const [listScrollState, setListScrollState] = useState<{
    canScrollUp: boolean;
    canScrollDown: boolean;
  } | null>(null);

  const ticksRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollUntilRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      setHoverSlot(null);
      setHoveredPromptIndex(null);
      closeTimerRef.current = null;
    }, 280);
  }, [cancelCloseTimer]);

  useEffect(() => {
    return () => {
      cancelCloseTimer();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [cancelCloseTimer]);

  const activePromptIndex = useMemo(() => {
    if (prompts.length === 0) {
      return 0;
    }
    if (activePromptId) {
      const idx = prompts.findIndex((p) => p.messageId === activePromptId);
      if (idx !== -1) {
        return idx;
      }
    }
    return prompts.length - 1;
  }, [prompts, activePromptId]);

  // Keep activePromptIndex synchronized with manual transcript scrolling.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || prompts.length === 0) {
      return;
    }

    const updateActiveFromScroll = () => {
      if (Date.now() < programmaticScrollUntilRef.current) {
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const thresholdTop = containerRect.top + 80;
      let matchedId = prompts[0]!.messageId;

      for (const prompt of prompts) {
        const el = findPromptElement(container, prompt.messageId);
        if (!el) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.top <= thresholdTop) {
          matchedId = prompt.messageId;
        } else {
          break;
        }
      }
      setActivePromptId(matchedId);
    };

    container.addEventListener('scroll', updateActiveFromScroll, { passive: true });
    return () => container.removeEventListener('scroll', updateActiveFromScroll);
  }, [scrollContainerRef, prompts]);

  const visibleCount = Math.min(prompts.length, MAX_VISIBLE_TICKS);
  const anchorIndex = hoveredPromptIndex ?? activePromptIndex;
  const windowBounds = useMemo(
    () => computeWindowBounds(prompts.length, anchorIndex, visibleCount),
    [prompts.length, anchorIndex, visibleCount],
  );

  const activeSlot = useMemo(() => {
    if (visibleCount <= 1 || prompts.length <= 1) {
      return 0;
    }
    const slotInWindow = activePromptIndex - windowBounds.windowStart;
    return Math.max(0, Math.min(visibleCount - 1, slotInWindow));
  }, [activePromptIndex, visibleCount, prompts.length, windowBounds.windowStart]);

  const tickMetrics = useMemo(
    () => computeTickMetrics(visibleCount, activeSlot, hoverSlot),
    [visibleCount, activeSlot, hoverSlot],
  );

  const syncListScrollMetrics = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 2) {
      setListScrollState({ canScrollUp: false, canScrollDown: false });
      return;
    }
    setListScrollState({
      canScrollUp: el.scrollTop > 2,
      canScrollDown: el.scrollTop < maxScroll - 2,
    });
  }, []);

  // When the popover opens, position the list so the active prompt is visible.
  useEffect(() => {
    if (!isOpen) {
      setListScrollState(null);
      return;
    }
    const listEl = listRef.current;
    if (!listEl || prompts.length === 0) {
      return;
    }
    const items = listEl.querySelectorAll<HTMLElement>('.aurvin-prompt-traveler-item');
    const targetItem = items[activePromptIndex];
    if (targetItem) {
      const itemTop = targetItem.offsetTop;
      const itemBottom = itemTop + targetItem.offsetHeight;
      if (itemTop < listEl.scrollTop) {
        listEl.scrollTop = itemTop;
      } else if (itemBottom > listEl.scrollTop + listEl.clientHeight) {
        listEl.scrollTop = Math.max(0, itemBottom - listEl.clientHeight);
      }
    }
    syncListScrollMetrics(listEl);
  }, [isOpen, activePromptIndex, prompts.length, syncListScrollMetrics]);

  const handleRailMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    cancelCloseTimer();
    const ticksEl = ticksRef.current;
    if (!ticksEl || prompts.length === 0) {
      return;
    }
    const rect = ticksEl.getBoundingClientRect();
    const clientY = event.clientY;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const state = computeRailHoverState(
        clientY,
        rect.top,
        rect.height,
        prompts.length,
        visibleCount,
      );
      setIsOpen(true);
      setHoverSlot(state.hoverSlot);
      setHoveredPromptIndex(state.promptIndex);

      const listEl = listRef.current;
      if (listEl) {
        const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
        if (maxScroll > 0) {
          listEl.scrollTop = state.ratio * maxScroll;
          syncListScrollMetrics(listEl);
        }
      }
      rafIdRef.current = null;
    });
  };

  const handleSelectPrompt = (prompt: PromptTravelItem) => {
    cancelCloseTimer();
    setActivePromptId(prompt.messageId);
    programmaticScrollUntilRef.current = Date.now() + 650;
    scrollTranscriptToPrompt(scrollContainerRef.current, prompt.messageId, 'smooth');
    setIsOpen(false);
    setHoverSlot(null);
    setHoveredPromptIndex(null);
  };

  const handleRailClick = () => {
    const targetIndex = hoveredPromptIndex ?? activePromptIndex;
    const targetPrompt = prompts[targetIndex];
    if (targetPrompt) {
      handleSelectPrompt(targetPrompt);
    }
  };

  const handleChevronStep = (direction: -1 | 1, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextIndex = Math.max(
      0,
      Math.min(prompts.length - 1, (hoveredPromptIndex ?? activePromptIndex) + direction),
    );
    setHoveredPromptIndex(nextIndex);
    const listEl = listRef.current;
    if (listEl) {
      listEl.scrollBy({ top: direction * 46, behavior: 'smooth' });
      syncListScrollMetrics(listEl);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    const listEl = listRef.current;
    if (!listEl) {
      return;
    }
    listEl.scrollTop += event.deltaY;
    syncListScrollMetrics(listEl);
  };

  if (prompts.length === 0) {
    return null;
  }

  const canScrollUp = listScrollState ? listScrollState.canScrollUp : windowBounds.canScrollUp;
  const canScrollDown = listScrollState
    ? listScrollState.canScrollDown
    : windowBounds.canScrollDown;
  const highlightedPromptIndex = hoveredPromptIndex ?? activePromptIndex;

  return (
    <nav
      className="aurvin-prompt-traveler"
      aria-label="Prompt history navigation"
      data-open={isOpen ? 'true' : 'false'}
      onMouseEnter={cancelCloseTimer}
      onMouseLeave={scheduleClose}
      onWheel={handleWheel}
    >
      <div
        className="aurvin-prompt-traveler-popover"
        role="region"
        aria-label="Submitted prompts"
        data-open={isOpen ? 'true' : 'false'}
        data-fade-top={canScrollUp ? 'true' : 'false'}
        data-fade-bottom={canScrollDown ? 'true' : 'false'}
        onMouseEnter={cancelCloseTimer}
        onMouseLeave={scheduleClose}
      >
        <div
          ref={listRef}
          className="aurvin-prompt-traveler-list"
          onScroll={(e) => syncListScrollMetrics(e.currentTarget)}
        >
          {prompts.map((prompt) => {
            const isItemActive = prompt.index === highlightedPromptIndex;
            return (
              <button
                key={prompt.messageId}
                type="button"
                className="aurvin-prompt-traveler-item"
                data-active={isItemActive ? 'true' : 'false'}
                data-prompt-id={prompt.messageId}
                onMouseEnter={(e) => {
                  setHoveredPromptIndex(prompt.index);
                  const listEl = listRef.current;
                  if (listEl && visibleCount > 1) {
                    const listRect = listEl.getBoundingClientRect();
                    const itemRect = e.currentTarget.getBoundingClientRect();
                    const itemCenterY = itemRect.top + itemRect.height / 2;
                    const ratio =
                      listRect.height > 0
                        ? Math.max(0, Math.min(1, (itemCenterY - listRect.top) / listRect.height))
                        : prompt.index / Math.max(1, prompts.length - 1);
                    setHoverSlot(ratio * (visibleCount - 1));
                  } else {
                    setHoverSlot(0);
                  }
                }}
                onClick={() => handleSelectPrompt(prompt)}
              >
                <span className="aurvin-prompt-traveler-item-text">{prompt.content}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="aurvin-prompt-traveler-rail"
        onMouseEnter={() => {
          cancelCloseTimer();
          setIsOpen(true);
        }}
        onMouseMove={handleRailMouseMove}
        onClick={handleRailClick}
        role="group"
        aria-label="Prompt timeline rail"
      >
        <button
          type="button"
          className="aurvin-prompt-traveler-chevron aurvin-prompt-traveler-chevron-up"
          data-visible={canScrollUp ? 'true' : 'false'}
          aria-label="Previous prompts"
          tabIndex={-1}
          onClick={(e) => handleChevronStep(-1, e)}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 7.5L6 4L9.5 7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div ref={ticksRef} className="aurvin-prompt-traveler-ticks">
          {tickMetrics.map((metric) => {
            const promptForSlot =
              prompts[Math.min(prompts.length - 1, windowBounds.windowStart + metric.slot)] ??
              prompts[0]!;
            return (
              <span
                key={metric.slot}
                className="aurvin-prompt-traveler-tick"
                data-highlighted={metric.isHighlighted ? 'true' : 'false'}
                data-slot={metric.slot}
                title={promptForSlot.content}
                style={{
                  width: `${metric.widthPx}px`,
                  height: `${metric.heightPx}px`,
                  opacity: metric.opacity,
                }}
              />
            );
          })}
        </div>

        <button
          type="button"
          className="aurvin-prompt-traveler-chevron aurvin-prompt-traveler-chevron-down"
          data-visible={canScrollDown ? 'true' : 'false'}
          aria-label="Next prompts"
          tabIndex={-1}
          onClick={(e) => handleChevronStep(1, e)}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </nav>
  );
}
