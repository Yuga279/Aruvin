/**
 * ============================================================================
 * FILE: calendar-link.ts
 * LOCATION: backend/src/contracts/calendar-link.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the single safe Google Calendar event-link contract.
 *
 * ROLE IN PROJECT:
 *    Keeps one bounded URL authority for Calendar receipts and presentation
 *    views without importing the SSE wire module into view contracts.
 *
 * KEY COMPONENTS:
 *    - safeCalendarLinkSchema: HTTPS Google Calendar event link or nothing.
 * ============================================================================
 */

import { z } from 'zod';

export const safeCalendarLinkSchema = z.string().max(2048).url().refine(v => {
  const u = new URL(v);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port
    && ['www.google.com', 'calendar.google.com', 'google.com'].includes(u.hostname)
    && u.pathname === '/calendar/event';
});
