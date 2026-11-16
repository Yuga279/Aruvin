/**
 * ============================================================================
 * FILE: turn-graph.ts
 * LOCATION: backend/src/agent/turn-graph.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Build the bounded LangGraph turn graph for text and Calendar turns.
 *
 * ROLE IN PROJECT:
 *    Owns the routing between text generation and the Calendar decide/execute/seal
 *    states, and keeps the saved graph state reference-only across a restore.
 *
 * KEY COMPONENTS:
 *    - prepare: Vouches for this turn's Calendar state and refuses legacy work.
 *    - seal: Confirms the attempt and the boundary the turn was accepted against.
 *    - Conditional edges: Route by the saved cursor instead of a fresh decision.
 * ============================================================================
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  TurnState, graphInputSchema, resultSchema, calendarCursorSchema, calendarSealSchema, assertRestorableBoundary,
  type GraphInput, type SavedResult, type CalendarCursor, type CalendarSeal, type CalendarRefs, type Boundary,
} from './state.js';
import { AppError } from '../platform/errors/app-error.js';

export type CalendarGraphPatch = {
  calendarCursor?: CalendarCursor | null;
  calendarSeal?: CalendarSeal | null;
  calendarRefs?: CalendarRefs | null;
};

export type PrepareState = Readonly<{
  boundary: Boundary | null;
  calendarCursor: CalendarCursor | null;
  calendarSeal: CalendarSeal | null;
}>;

export function buildTurnGraph(saver: BaseCheckpointSaver | undefined, hooks: {
  prepare: (input: GraphInput, restored: PrepareState) => Promise<void | CalendarGraphPatch>;
  generate: (input: GraphInput) => Promise<SavedResult>;
  decide?: (input: GraphInput) => Promise<CalendarGraphPatch>;
  execute?: (input: GraphInput) => Promise<CalendarGraphPatch>;
}) {
  return new StateGraph(TurnState)
    .addNode('prepare', async state => {
      if (!state.input) throw new AppError('NOT_READY', 'Chat input is unavailable.');
      const input = graphInputSchema.parse(state.input);
      const restoredState: PrepareState = {
        boundary: state.boundary ?? null,
        calendarCursor: state.calendarCursor ?? null,
        calendarSeal: state.calendarSeal ?? null,
      };
      const extra = await hooks.prepare(input, restoredState) ?? {};
      const supplied = extra.calendarCursor;
      if (supplied && supplied.version !== 2 && supplied.pendingDecisionId !== null) {
        // ponytail: a legacy pending tool is refused instead of being converted into
        // a v2 call. The ceiling is that v1 work is never resumed, only re-requested.
        throw new AppError('NOT_READY', 'Calendar work needs a fresh request.', false);
      }
      // The prepare step vouches for this turn's calendar state, so a cursor left by
      // an earlier turn is never inherited. A turn that resumes a calendar attempt
      // supplies the saved cursor again.
      const restored = state.calendarSeal
        && state.calendarSeal.input.attempt.attemptId === input.attempt.attemptId
        ? state.calendarSeal : null;
      const calendarCursor = supplied ?? null;
      const calendarSeal = extra.calendarSeal !== undefined ? extra.calendarSeal : restored;
      // Text has no cursor/seal: generate in this node so LangGraph does not
      // checkpoint an empty prepare before paid inference. Calendar keeps the
      // durable cursor boundary before decide/execute.
      if (!calendarCursor && !calendarSeal) {
        return { ...extra, result: resultSchema.parse(await hooks.generate(input)), sealed: false,
          calendarCursor: null, calendarSeal: null };
      }
      return { ...extra, result: null, sealed: false, calendarCursor, calendarSeal };
    })
    .addNode('generate', async state => {
      if (!state.input) throw new AppError('NOT_READY', 'Chat input is unavailable.');
      return { result: resultSchema.parse(await hooks.generate(state.input)), sealed: false };
    })
    .addNode('calendar_decide', async state => {
      if (!state.input || !hooks.decide) throw new AppError('NOT_READY', 'Calendar decision is unavailable.');
      return hooks.decide(state.input);
    })
    .addNode('calendar_execute', async state => {
      if (!state.input || !hooks.execute) throw new AppError('NOT_READY', 'Calendar execution is unavailable.');
      return hooks.execute(state.input);
    })
    .addNode('seal', state => {
      if (state.calendarSeal && state.result) {
        throw new AppError('NOT_READY', 'The saved answer could not be confirmed.');
      }
      if (state.calendarSeal) {
        const seal = calendarSealSchema.parse(state.calendarSeal);
        if (!state.input || seal.input.attempt.attemptId !== state.input.attempt.attemptId)
          throw new AppError('NOT_READY', 'The saved answer could not be confirmed.');
        assertRestorableBoundary(seal.base, state.boundary);
        return { sealed: true };
      }
      if (!state.result || !state.input || state.result.input.attempt.attemptId !== state.input.attempt.attemptId)
        throw new AppError('NOT_READY', 'The saved answer could not be confirmed.');
      resultSchema.parse(state.result);
      return { sealed: true };
    })
    .addEdge(START, 'prepare')
    .addConditionalEdges('prepare', state => {
      if (state.calendarSeal || state.result) return 'seal';
      const cursor = state.calendarCursor ? calendarCursorSchema.parse(state.calendarCursor) : null;
      if (!cursor) return 'generate';
      if (cursor.next === 'execute') return 'calendar_execute';
      if (cursor.next === 'seal') return 'seal';
      return 'calendar_decide';
    })
    .addConditionalEdges('calendar_decide', state => {
      const next = state.calendarCursor ? calendarCursorSchema.parse(state.calendarCursor).next : 'seal';
      if (next === 'execute') return 'calendar_execute';
      if (next === 'decide') return 'calendar_decide';
      return 'seal';
    })
    .addConditionalEdges('calendar_execute', state => {
      const next = state.calendarCursor ? calendarCursorSchema.parse(state.calendarCursor).next : 'seal';
      return next === 'decide' ? 'calendar_decide' : 'seal';
    })
    .addEdge('generate', 'seal')
    .addEdge('seal', END)
    .compile({ checkpointer: saver });
}
export type TurnGraph = ReturnType<typeof buildTurnGraph>;
