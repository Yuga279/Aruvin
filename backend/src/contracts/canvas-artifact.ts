/**
 * ============================================================================
 * FILE: canvas-artifact.ts
 * LOCATION: backend/src/contracts/canvas-artifact.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide Zod schema boundaries for Canvas artifact projections and lists.
 *
 * ROLE IN PROJECT:
 *    Wraps portable wire guards in Zod schemas for validation in message records,
 *    delivery records, and visible message projections.
 *
 * KEY COMPONENTS:
 *    - canvasArtifactProjectionSchema: Zod schema for one CanvasArtifactProjection
 *    - canvasArtifactsSchema: Zod schema for CanvasArtifactProjection[] list
 * ============================================================================
 */

import { z } from 'zod';
import { isCanvasArtifactProjection, isCanvasArtifactProjectionList,
  type CanvasArtifactProjection } from './voice-wire.js';

export const canvasArtifactProjectionSchema = z.custom<CanvasArtifactProjection>(
  isCanvasArtifactProjection, 'Invalid Canvas artifact');
export const canvasArtifactsSchema = z.custom<CanvasArtifactProjection[]>(
  isCanvasArtifactProjectionList, 'Invalid Canvas artifact projection');
