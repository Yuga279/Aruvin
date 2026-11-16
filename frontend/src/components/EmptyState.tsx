/**
 * ============================================================================
 * FILE: EmptyState.tsx
 * LOCATION: frontend/src/components/EmptyState.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Welcoming empty chat landing greeting.
 *
 * ROLE IN PROJECT:
 *    Shown when no session is selected and no messages exist. Composer is
 *    mounted beside this heading so the landing matches ChatGPT's centered
 *    start screen. A new chat remounts this view and picks another quote.
 *
 * KEY COMPONENTS:
 *    - Rotating greeting copy
 * ============================================================================
 */

import { useState } from 'react';
import { BRAND_NAME, BRAND_TAGLINE } from '../app/brand.ts';
import { BrandMark } from './BrandMark.tsx';

export const EMPTY_GREETINGS = [
  'Where should we begin?',
  "What's on your mind?",
  'How can I help you today?',
  'What are you working on?',
  "What's on the agenda today?",
  'Ready when you are.',
] as const;

function pickGreeting(): string {
  return EMPTY_GREETINGS[Math.floor(Math.random() * EMPTY_GREETINGS.length)] ?? EMPTY_GREETINGS[0];
}

export function EmptyState() {
  const [greeting] = useState(() => pickGreeting());
  return (
    <div className="aurvin-welcome">
      <BrandMark size={64} title={BRAND_NAME} />
      <h1>{greeting}</h1>
      <p className="aurvin-welcome-tagline">{BRAND_TAGLINE}</p>
    </div>
  );
}
