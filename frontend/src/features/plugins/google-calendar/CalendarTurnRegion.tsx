/**
 * ============================================================================
 * FILE: CalendarTurnRegion.tsx
 * LOCATION: frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Renders Google Calendar progress, operation cards, durable target badges,
 *    clarification proposal cards, and manual Calendar Canvas entries.
 *
 * ROLE IN PROJECT:
 *    Truthful presentation of calendar activity: displays durable receipt event
 *    IDs, safe links, verified target labels, retry options, structured proposal
 *    confirmation, and inline lookup facts while honoring receipt, proposal, and
 *    target-label expiry boundaries.
 *
 * KEY COMPONENTS:
 *    - resolveReceiptCalendarLabel: Pure helper resolving unexpired calendar labels.
 *    - parseCalendarConfirmationDetails / formatCalendarEventInterval: Event parsing and formatting.
 *    - CalendarTurnView: Pure presentational component for calendar cards.
 *    - CalendarTurnRegion: Hook-connected component with live expiry timers.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import {
  isSafeCalendarEventLink,
  type CalendarClarificationEvent,
  type CalendarClarificationReason,
  type CalendarDurableReceipt,
  type CalendarOperationState,
  type CalendarProgressPhase,
  type CalendarRetryAction,
  type CalendarTurnState,
  type CalendarView,
} from '../../../api/calendar-protocol.ts';
import { CanvasArtifactCard } from '../../canvas/CanvasArtifactCard.tsx';
import { collectSessionCanvasArtifacts } from '../../canvas/canvas-artifacts.ts';
import { calendarViewArtifact } from '../../canvas/calendar-workspace.ts';
import type { CanvasArtifact } from '../../canvas/canvas-types.ts';
import { CalendarAgendaView } from '../../canvas/renderers/calendar-agenda-view.tsx';
import { CalendarProposalReviewCard } from '../../canvas/renderers/calendar-view-renderer.tsx';
import { useChat } from '../../chat/state/chat-context.tsx';
import './calendar-plugin.css';

export function GoogleCalendarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3.5" width="18" height="17" rx="3.5" fill="#ffffff" />
      <path d="M17.5 3.5H6.5C4.567 3.5 3 5.067 3 7V8H21V7C21 5.067 19.433 3.5 17.5 3.5Z" fill="#4285F4" />
      <path d="M18.5 8H21V17C21 18.933 19.433 20.5 17.5 20.5H16V8H18.5Z" fill="#34A853" />
      <path d="M5.5 20.5C4.12 20.5 3 19.38 3 18V17H8V20.5H5.5Z" fill="#FBBC04" />
      <path d="M3 8H8V17H3V8Z" fill="#EA4335" />
      <rect x="5.5" y="6.5" width="13" height="13" rx="1.5" fill="#ffffff" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1a73e8" fontFamily="system-ui, -apple-system, sans-serif">31</text>
    </svg>
  );
}

export function IconUserGroup({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconLocationPin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function formatCalendarEventInterval(startIso: string, endIso: string, timeZone?: string): string {
  try {
    const startDate = new Date(startIso);
    const endDate = new Date(endIso);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return `${startIso} – ${endIso}`;
    }

    let tzOption: { timeZone?: string } = {};
    if (timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(startDate);
        tzOption = { timeZone };
      } catch {
        tzOption = {};
      }
    }

    const datePart = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...tzOption,
    }).format(startDate);

    const startTimePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...tzOption,
    }).format(startDate).toLowerCase().replace(/\s/g, '');

    const endTimePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...tzOption,
    }).format(endDate).toLowerCase().replace(/\s/g, '');

    let timeRange = `${startTimePart} – ${endTimePart}`;
    const startAmPm = startTimePart.slice(-2);
    const endAmPm = endTimePart.slice(-2);
    if (startAmPm === endAmPm) {
      const cleanStart = startTimePart.slice(0, -2);
      timeRange = `${cleanStart} – ${endTimePart}`;
    }

    return `${datePart} • ${timeRange}`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

export type ParsedCalendarEvent = {
  summary: string;
  calendar?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  formattedTime?: string;
  description?: string;
  attendees?: string;
  location?: string;
};

export function parseCalendarConfirmationDetails(message: string): ParsedCalendarEvent | null {
  const summaryMatch =
    /(?:Please confirm:\s*)?create\s+"([^"]+)"|I can schedule\s+"([^"]+)"/i.exec(message);
  if (!summaryMatch) {
    return null;
  }
  const summary = summaryMatch[1] ?? summaryMatch[2];

  let calendar: string | undefined;
  const calMatch = /\bon\s+([^\s]+?)\s+from\b/i.exec(message);
  if (calMatch) {
    calendar = calMatch[1];
  }

  let start: string | undefined;
  let end: string | undefined;
  let timeZone: string | undefined;
  const timeMatch = /\bfrom\s+(\S+)\s+to\s+(\S+)(?:\s+\(([^)]+)\))?/i.exec(message);
  if (timeMatch) {
    start = timeMatch[1];
    end = timeMatch[2];
    timeZone = timeMatch[3];
  }

  let formattedTime: string | undefined;
  if (start && end) {
    formattedTime = formatCalendarEventInterval(start, end, timeZone);
  }

  let description: string | undefined;
  const descMatch = /\bDescription:\s*"((?:\\.|[^"\\])*)"/i.exec(message);
  if (descMatch) {
    try {
      description = JSON.parse(`"${descMatch[1]}"`);
    } catch {
      description = descMatch[1];
    }
  }

  let location: string | undefined;
  const locMatch = /\bLocation:\s*"((?:\\.|[^"\\])*)"/i.exec(message);
  if (locMatch) {
    try {
      location = JSON.parse(`"${locMatch[1]}"`);
    } catch {
      location = locMatch[1];
    }
  }

  let attendees: string | undefined;
  if (description) {
    const partMatch = /Participants:\s*([^.\n]+?)(?:\.|$|Note:)/i.exec(description);
    if (partMatch) {
      attendees = partMatch[1].trim();
    }
  }

  return {
    summary,
    calendar,
    start,
    end,
    timeZone,
    formattedTime,
    description,
    attendees,
    location,
  };
}

const CALENDAR_CONFIRM_REPLY =
  /^(?:yes(?:,? (?:please|go ahead))?|confirm|yep|yeah|sure|ok|okay|alright|go ahead|create it anyway|i accept the conflict|i accept the incomplete coverage|cancel|no|stop|do not create it|don't create it)$/iu;

export function isCalendarConfirmChatReply(content: string): boolean {
  return CALENDAR_CONFIRM_REPLY.test(content.trim().replace(/[.!?]+$/u, '').trim());
}

export function isCalendarConfirmationPrompt(content: string): boolean {
  return (
    /^Please confirm:\s*create\b/i.test(content) ||
    /^I can schedule\b/i.test(content) ||
    /^I can create this event for you\b/i.test(content) ||
    /\bShould I create the event anyway\b/i.test(content)
  );
}

export function hideCalendarConfirmReplies<T extends { role: string; content: string }>(
  messages: readonly T[],
): T[] {
  return messages.filter((msg, index) => {
    if (msg.role !== 'user' || !isCalendarConfirmChatReply(msg.content)) {
      return true;
    }
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (messages[previous]!.role === 'assistant') {
        return !isCalendarConfirmationPrompt(messages[previous]!.content);
      }
    }
    return true;
  });
}

export function describeCalendarProgress(phase: CalendarProgressPhase): string {
  switch (phase) {
    case 'validating':
      return 'Validating Calendar request…';
    case 'repairing':
      return 'Correcting the Calendar request…';
    case 'executing':
      return 'Running Calendar action…';
    case 'reconciling':
      return 'Reconciling Calendar outcome…';
  }
}

export function describeOperationState(state: CalendarOperationState): string {
  switch (state) {
    case 'succeeded':
      return 'Calendar event created';
    case 'unknown':
      return 'Calendar outcome is uncertain and requires reconciliation.';
    case 'definitely-failed':
      return 'Calendar action was not completed. No Calendar event was created.';
    case 'failed':
      return 'Calendar action failed; no successful creation is confirmed.';
    case 'cancelled':
      return 'Calendar action was cancelled; check any previously reported uncertain outcome before sending a new request.';
    case 'evidence-expired':
      return 'Calendar deduplication evidence has expired. Automatic replay is blocked.';
    case 'planned':
    case 'dispatching':
      return 'Calendar operation was interrupted before completion could be confirmed.';
  }
}

export function describeCalendarRetryAction(retryAction: CalendarRetryAction): {
  explanation: string;
  buttonLabel: string | null;
} {
  switch (retryAction) {
    case 'resume-reconciliation':
      return {
        explanation:
          'Retry will resume and reconcile the existing Calendar operation using the same event ID without creating a duplicate event.',
        buttonLabel: 'Resume & reconcile operation',
      };
    case 'reconnect':
      return {
        explanation:
          'Google Calendar reconnection is required before this request can continue.',
        buttonLabel: 'Reconnect Google Calendar',
      };
    case 'clarify':
      return {
        explanation:
          'More details are needed (such as an exact date, time, or timezone). Send a clarifying message in the composer below.',
        buttonLabel: 'Clarify in composer',
      };
    case 'blocked-expired':
      return {
        explanation:
          'Replay is blocked because operation deduplication evidence expired. Check your Google Calendar before sending a new request.',
        buttonLabel: null,
      };
    case 'none':
      return {
        explanation: '',
        buttonLabel: null,
      };
  }
}

export function resolveSafeReceiptLink(
  receipt: CalendarDurableReceipt | null,
  nowMs: number = Date.now(),
): string | null {
  if (!receipt || !receipt.durable || receipt.htmlLink === null) {
    return null;
  }
  if (!isSafeCalendarEventLink(receipt.htmlLink)) {
    return null;
  }
  if (receipt.expiresAt === null) {
    return null;
  }
  const expiresAtMs = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return null;
  }
  return receipt.htmlLink;
}

export function resolveReceiptCalendarLabel(
  receipt: CalendarDurableReceipt | null,
  nowMs: number = Date.now(),
): string | null {
  if (
    !receipt?.durable ||
    !('calendarLabel' in receipt) ||
    receipt.calendarLabel === null ||
    receipt.expiresAt === null
  ) {
    return null;
  }
  const expires = Date.parse(receipt.expiresAt);
  return Number.isFinite(expires) && expires > nowMs ? receipt.calendarLabel : null;
}

export type CalendarTurnItem = {
  turnId: string;
  operation: CalendarTurnState;
};

export type CalendarTurnViewProps = {
  progress: CalendarProgressPhase | null;
  operations: readonly CalendarTurnItem[];
  disabled: boolean;
  replyDisabled?: boolean;
  nowMs?: number;
  onRetryTurn: (turnId: string) => void;
  onOpenCalendarSetup?: () => void;
  onFocusComposer?: () => void;
  onConfirmReply?: (content: string) => void;
  clarification?: { turnId: string; event: CalendarClarificationEvent } | null;
  results?: readonly CanvasArtifact[];
  onOpenCanvas?: (artifactId: string) => void;
};

export function CalendarTurnView({
  progress,
  operations,
  disabled,
  replyDisabled,
  nowMs = Date.now(),
  onRetryTurn,
  onOpenCalendarSetup,
  onFocusComposer,
  onConfirmReply,
  clarification = null,
  results = [],
  onOpenCanvas,
}: CalendarTurnViewProps) {
  const composerReplyDisabled = replyDisabled ?? disabled;
  if (progress === null && operations.length === 0 && clarification === null && results.length === 0) {
    return null;
  }

  return (
    <section
      className="aurvin-calendar-turn-region"
      aria-label="Google Calendar activity"
      aria-live="polite"
    >
      {progress !== null ? (
        <div
          className="aurvin-calendar-progress-pill"
          role="status"
          data-calendar-progress={progress}
        >
          <span>{describeCalendarProgress(progress)}</span>
        </div>
      ) : null}

      {results.map(artifact=><div key={artifact.artifactId}>
        {artifact.calendarView?.kind === 'agenda' ? <CalendarAgendaView view={artifact.calendarView} nowMs={nowMs}/> : null}
        <CanvasArtifactCard artifact={artifact} onOpen={onOpenCanvas}/>
      </div>)}

      {operations.map(({ turnId, operation }) => {
        const isCreated =
          operation.state === 'succeeded' &&
          operation.receipt !== null &&
          operation.receipt.durable === true;
        const safeLink = isCreated ? resolveSafeReceiptLink(operation.receipt, nowMs) : null;
        const targetLabel = isCreated ? resolveReceiptCalendarLabel(operation.receipt, nowMs) : null;
        const retryMeta = describeCalendarRetryAction(operation.retryAction);
        const showFailedNarrationRetry =
          isCreated &&
          operation.retryAction === 'none' &&
          (operation.narration === 'failed' || operation.narration === 'interrupted');

        return (
          <article
            key={`${turnId}:${operation.operationId}`}
            className="aurvin-calendar-operation-card"
            data-calendar-state={operation.state}
            data-calendar-narration={operation.narration}
            data-receipt-durable={isCreated ? 'true' : 'false'}
          >
            <div className="aurvin-calendar-operation-header">
              <span className="aurvin-calendar-receipt-title">
                {describeOperationState(operation.state)}
              </span>
              {isCreated && operation.receipt ? (
                <span className="aurvin-calendar-receipt-id">
                  Event ID: {operation.receipt.eventId}
                </span>
              ) : null}
            </div>

            {isCreated ? (
              <div className="aurvin-calendar-target-row">
                {targetLabel ? (
                  <span className="aurvin-calendar-target-badge">Calendar: {targetLabel}</span>
                ) : (
                  <span className="aurvin-calendar-target-badge">
                    Calendar label unavailable or expired
                  </span>
                )}
              </div>
            ) : null}

            {isCreated ? (
              safeLink ? (
                <a
                  href={safeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aurvin-calendar-receipt-link"
                >
                  Open in Google Calendar
                </a>
              ) : (
                <p className="aurvin-calendar-narration-warning">
                  Event link unavailable or expired; verified by durable event ID.
                </p>
              )
            ) : null}

            {isCreated && operation.narration === 'failed' ? (
              <p className="aurvin-calendar-narration-warning" role="status">
                The Calendar event was created and saved, but the final assistant response failed. Retrying will not create a duplicate event.
              </p>
            ) : null}

            {isCreated && operation.narration === 'interrupted' ? (
              <p className="aurvin-calendar-narration-warning" role="status">
                The Calendar event was created and saved, but the final assistant stream was interrupted. Retrying will reuse the saved receipt without creating a duplicate event.
              </p>
            ) : null}

            {retryMeta.explanation ? (
              <div className="aurvin-calendar-retry-box">
                <p className="aurvin-calendar-retry-explanation">{retryMeta.explanation}</p>
                {operation.retryAction === 'resume-reconciliation' ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    disabled={disabled}
                    onClick={() => onRetryTurn(turnId)}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
                {operation.retryAction === 'reconnect' && onOpenCalendarSetup ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    onClick={onOpenCalendarSetup}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
                {operation.retryAction === 'clarify' && onFocusComposer ? (
                  <button
                    type="button"
                    className="aurvin-retry-btn"
                    onClick={onFocusComposer}
                  >
                    {retryMeta.buttonLabel}
                  </button>
                ) : null}
              </div>
            ) : null}

            {showFailedNarrationRetry ? (
              <div className="aurvin-calendar-retry-box">
                <p className="aurvin-calendar-retry-explanation">
                  Event creation is already complete. If you retry the turn, Aurvin will reuse the saved event receipt without creating a second event.
                </p>
                <button
                  type="button"
                  className="aurvin-retry-btn"
                  disabled={disabled}
                  onClick={() => onRetryTurn(turnId)}
                >
                  Retry assistant response (reuses saved event)
                </button>
              </div>
            ) : null}
          </article>
        );
      })}

      {clarification !== null ? (() => {
        const expiresAtMs = Date.parse(clarification.event.expiresAt);
        const isExpired = !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
        const confirmReply = onConfirmReply;
        if (clarification.event.view !== undefined) {
          return <CalendarProposalReviewCard view={clarification.event.view} nowMs={nowMs}
            interactive={Boolean(onConfirmReply) && !isExpired} disabled={composerReplyDisabled}
            onAnswer={answer=>confirmReply?.(answer.kind === 'accept' ? 'yes' : answer.kind === 'reject' ? 'cancel' : answer.calendarId)}/>;
        }
        const reasonHeadings: Record<CalendarClarificationReason, string> = {
          target: 'Choose a calendar',
          details: 'Confirm this event',
          conflict: 'Calendar conflict needs your reply',
          coverage: 'Availability coverage is incomplete',
        };
        const heading = reasonHeadings[clarification.event.reason] ?? 'Calendar clarification needed';
        const canReply = Boolean(confirmReply) && !isExpired;
        const showYes = canReply && clarification.event.reason !== 'target';
        const parsed = parseCalendarConfirmationDetails(clarification.event.message);

        return (
          <article
            className="aurvin-calendar-clarification-card aurvin-calendar-gemini-card"
            data-calendar-reason={clarification.event.reason}
            aria-label={heading}
            aria-atomic="true"
          >
            <span className="aurvin-sr-only">{heading}</span>
            <div className="aurvin-calendar-card-header">
              <GoogleCalendarIcon size={20} />
              <span className="aurvin-calendar-card-header-label">Google Calendar</span>
            </div>

            {isExpired ? (
              <p className="aurvin-calendar-clarification-expired" role="status">
                This Calendar request expired. Ask again or provide updated details in the composer.
              </p>
            ) : parsed ? (
              <div className="aurvin-calendar-card-content">
                <div className="aurvin-calendar-event-title">{parsed.summary}</div>
                {parsed.formattedTime ? (
                  <div className="aurvin-calendar-event-time">{parsed.formattedTime}</div>
                ) : null}
                {parsed.attendees ? (
                  <div className="aurvin-calendar-event-row">
                    <IconUserGroup size={16} />
                    <span>{parsed.attendees}</span>
                  </div>
                ) : null}
                {parsed.location ? (
                  <div className="aurvin-calendar-event-row">
                    <IconLocationPin size={16} />
                    <span>{parsed.location}</span>
                  </div>
                ) : null}

                {clarification.event.candidates.length > 0 ? (
                  <ul className="aurvin-calendar-candidates-list">
                    {clarification.event.candidates.slice(0, 20).map((cand) => (
                      <li key={cand.calendarId} className="aurvin-calendar-candidate-item">
                        {confirmReply ? (
                          <button
                            type="button"
                            className="aurvin-retry-btn"
                            disabled={composerReplyDisabled}
                            onClick={() => confirmReply(cand.label)}
                          >
                            {cand.label}
                          </button>
                        ) : (
                          <span>{cand.label}</span>
                        )}
                        <span className="aurvin-calendar-candidate-id"> ({cand.calendarId})</span>
                        <span className="aurvin-calendar-candidate-role"> · {cand.role}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canReply ? (
                  <div
                    className="aurvin-calendar-card-actions"
                    role="group"
                    aria-label="Confirm calendar event"
                  >
                    <button
                      type="button"
                      className="aurvin-calendar-cancel-btn"
                      disabled={composerReplyDisabled}
                      onClick={() => confirmReply?.('cancel')}
                    >
                      Cancel
                    </button>
                    {showYes ? (
                      <button
                        type="button"
                        className="aurvin-calendar-confirm-btn"
                        disabled={composerReplyDisabled}
                        onClick={() => confirmReply?.('yes')}
                      >
                        Confirm
                      </button>
                    ) : null}
                  </div>
                ) : onFocusComposer ? (
                  <div className="aurvin-calendar-retry-box">
                    <button
                      type="button"
                      className="aurvin-retry-btn"
                      disabled={composerReplyDisabled}
                      onClick={onFocusComposer}
                    >
                      Reply in composer
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <p className="aurvin-calendar-clarification-message">{clarification.event.message}</p>
                {clarification.event.candidates.length > 0 ? (
                  <ul className="aurvin-calendar-candidates-list">
                    {clarification.event.candidates.slice(0, 20).map((cand) => (
                      <li key={cand.calendarId} className="aurvin-calendar-candidate-item">
                        {confirmReply ? (
                          <button
                            type="button"
                            className="aurvin-retry-btn"
                            disabled={composerReplyDisabled}
                            onClick={() => confirmReply(cand.label)}
                          >
                            {cand.label}
                          </button>
                        ) : (
                          <span>{cand.label}</span>
                        )}
                        <span className="aurvin-calendar-candidate-id"> ({cand.calendarId})</span>
                        <span className="aurvin-calendar-candidate-role"> · {cand.role}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canReply ? (
                  <div
                    className="aurvin-calendar-card-actions"
                    role="group"
                    aria-label="Confirm calendar event"
                  >
                    <button
                      type="button"
                      className="aurvin-calendar-cancel-btn"
                      disabled={composerReplyDisabled}
                      onClick={() => confirmReply?.('cancel')}
                    >
                      Cancel
                    </button>
                    {showYes ? (
                      <button
                        type="button"
                        className="aurvin-calendar-confirm-btn"
                        disabled={composerReplyDisabled}
                        onClick={() => confirmReply?.('yes')}
                      >
                        Confirm
                      </button>
                    ) : null}
                  </div>
                ) : onFocusComposer ? (
                  <div className="aurvin-calendar-retry-box">
                    <button
                      type="button"
                      className="aurvin-retry-btn"
                      disabled={composerReplyDisabled}
                      onClick={onFocusComposer}
                    >
                      Reply in composer
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </article>
        );
      })() : null}
    </section>
  );
}

export function CalendarTurnRegion({
  onOpenCalendarSetup,
  onFocusComposer,
  nowMs: testNowMs,
}: {
  onOpenCalendarSetup?: () => void;
  onFocusComposer?: () => void;
  nowMs?: number;
}) {
  const { state, actions, dispatch } = useChat();
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const currentNowMs = testNowMs ?? liveNowMs;

  const operations: CalendarTurnItem[] = (state.calendarTurnOrder ?? [])
    .map((turnId) => {
      const operation = state.calendarOperationsByTurn?.[turnId];
      return operation ? { turnId, operation } : null;
    })
    .filter((item): item is CalendarTurnItem => item !== null);

  const results=useMemo(()=>{
    const liveTurns=new Set(state.messages.filter(m=>m.mode === 'live' || m.voiceSessionId).map(m=>m.turnId));
    const persisted=collectSessionCanvasArtifacts(state.messages,'',false,state.calendarOperationsByTurn)
      .filter(a=>a.kind === 'calendar' && !(a.turnId !== undefined && liveTurns.has(a.turnId)));
    const turns=new Set(persisted.map(a=>a.turnId).filter(Boolean));
    return [...persisted,...Object.entries(state.calendarViewsByTurn).filter(([id])=>!turns.has(id))
      .map(([id,view])=>calendarViewArtifact(view,id,id))];
  },[state.messages,state.calendarOperationsByTurn,state.calendarViewsByTurn]);

  useEffect(() => {
    if (testNowMs !== undefined) return;
    const deadlines: number[] = [];
    const current = Date.now();
    const push = (deadline: string | null | undefined) => {
      if (!deadline) return;
      const exp = Date.parse(deadline);
      if (Number.isFinite(exp) && exp > current) {
        deadlines.push(exp);
      }
    };
    const viewDeadlines = (view: CalendarView | null | undefined) => {
      if (!view) return;
      if ('expiresAt' in view) push(view.expiresAt);
      if ((view.kind === 'agenda' || view.kind === 'proposal') && view.target) push(view.target.labelExpiresAt);
      if (view.kind === 'outcome' && view.receipt) push(view.receipt.expiresAt);
    };
    for (const item of operations) {
      if (item.operation.receipt?.expiresAt) {
        push(item.operation.receipt.expiresAt);
      }
    }
    if (state.calendarClarification?.event.expiresAt) {
      push(state.calendarClarification.event.expiresAt);
      viewDeadlines(state.calendarClarification.event.view);
    }
    for (const result of results) {
      viewDeadlines(result.calendarView);
    }
    if (deadlines.length === 0) return;
    const nearest = Math.min(...deadlines);
    const delay = Math.max(1, Math.min(2_147_483_647, nearest - current));
    const timer = setTimeout(() => {
      setLiveNowMs(Date.now());
    }, delay);
    return () => clearTimeout(timer);
  }, [testNowMs, operations, results, state.calendarClarification]);

  return (
    <CalendarTurnView
      progress={state.calendarProgress ?? null}
      operations={operations}
      disabled={Boolean(state.isStreaming || state.isSubmitting || state.voiceInput)}
      replyDisabled={Boolean(state.isSubmitting || state.voiceInput)}
      nowMs={currentNowMs}
      onRetryTurn={(turnId) => void actions.retryTurn(turnId)}
      onOpenCalendarSetup={onOpenCalendarSetup}
      onFocusComposer={onFocusComposer}
      onConfirmReply={(content) =>
        void actions.submitMessage(content, { hideFromTranscript: true })
      }
      clarification={state.calendarClarification ?? null}
      results={results}
      onOpenCanvas={artifactId=>dispatch({type:'OPEN_CANVAS_ARTIFACT',payload:{artifactId}})}
    />
  );
}
