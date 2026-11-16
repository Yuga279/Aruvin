/**
 * ============================================================================
 * FILE: canvas-types.ts
 * LOCATION: frontend/src/features/canvas/canvas-types.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Shared TypeScript contracts for Aurvin's Canvas artifacts and renderers.
 *
 * ROLE IN PROJECT:
 *    Defines extracted artifact metadata, chart dataset models, and Mermaid
 *    diagram graph structures used across SafeMarkdown cards and CanvasPanel.
 *
 * KEY COMPONENTS:
 *    - CanvasArtifact / CanvasArtifactKind: Extracted visual artifact descriptor.
 *    - CalendarEventModel: Structured event model for Google Calendar cards.
 *    - ChartModel / ChartDataset: Normalized bar, line, area, and pie chart data.
 *    - MermaidFlowModel / MermaidSequenceModel: Parsed diagram layout models.
 * ============================================================================
 */

import type { CalendarView } from '../../api/calendar-protocol.ts';
import type { CalendarWorkspace } from './calendar-workspace.ts';

export type CanvasArtifactKind = 'mermaid' | 'chart' | 'svg' | 'calendar';

export type CalendarEventDateTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type CalendarEventModel = {
  summary: string;
  start?: string | CalendarEventDateTime;
  end?: string | CalendarEventDateTime;
  timeZone?: string;
  calendarLabel?: string | null;
  htmlLink?: string | null;
  status?: string | null;
  location?: string | null;
  description?: string | null;
  eventId?: string | null;
  [key: string]: unknown;
};

export type CanvasArtifact = {
  artifactId: string;
  messageId: string;
  index: number;
  kind: CanvasArtifactKind;
  subType: string;
  title: string;
  buttonLabel: string;
  rawSource: string;
  isStreaming: boolean;
  turnId?: string;
  calendarView?: CalendarView;
  calendarWorkspace?: CalendarWorkspace;
  calendarAliases?: string[];
};

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

export type ChartPoint = {
  x: number;
  y: number;
  label?: string;
};

export type ChartDataset = {
  label: string;
  data: number[];
  points?: ChartPoint[];
  color?: string;
  showLine?: boolean;
  smooth?: boolean;
};

export type ChartModel = {
  type: ChartKind;
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  quadrantLabels?: [string?, string?, string?, string?];
  labels: string[];
  datasets: ChartDataset[];
};

export type MermaidNodeShape =
  | 'rect'
  | 'rounded'
  | 'stadium'
  | 'diamond'
  | 'circle'
  | 'cylinder'
  | 'subroutine'
  | 'state-start'
  | 'state-end';

export type MermaidNode = {
  id: string;
  label: string;
  shape: MermaidNodeShape;
  subgraphId?: string;
};

export type MermaidEdgeStyle = 'solid' | 'dashed' | 'thick' | 'open';

export type MermaidEdge = {
  from: string;
  to: string;
  label?: string;
  style: MermaidEdgeStyle;
};

export type MermaidSubgraph = {
  id: string;
  title: string;
  nodeIds: string[];
};

export type MermaidFlowDirection = 'TD' | 'TB' | 'BT' | 'LR' | 'RL';

export type MermaidFlowModel = {
  kind: 'flowchart';
  title?: string;
  direction: MermaidFlowDirection;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  subgraphs: MermaidSubgraph[];
};

export type MermaidSequenceParticipant = {
  id: string;
  label: string;
};

export type MermaidSequenceMessage = {
  from: string;
  to: string;
  text: string;
  dashed: boolean;
};

export type MermaidSequenceNote = {
  overIds: string[];
  text: string;
};

export type MermaidSequenceModel = {
  kind: 'sequence';
  title?: string;
  participants: MermaidSequenceParticipant[];
  items: Array<
    | ({ itemType: 'message' } & MermaidSequenceMessage)
    | ({ itemType: 'note' } & MermaidSequenceNote)
  >;
};

export type MermaidParsedModel =
  | MermaidFlowModel
  | MermaidSequenceModel
  | { kind: 'chart'; chart: ChartModel };
