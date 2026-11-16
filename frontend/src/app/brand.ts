/**
 * ============================================================================
 * FILE: brand.ts
 * LOCATION: frontend/src/app/brand.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Single source for user-visible product naming.
 *
 * ROLE IN PROJECT:
 *    Components read the product name here instead of hard-coding it, so a
 *    future rename is a one-line change. Wire identifiers (CSRF header,
 *    storage keys, CSS class prefix) use the lowercase "aurvin".
 *
 * KEY COMPONENTS:
 *    - BRAND_NAME, BRAND_EXPANSION, BRAND_TAGLINE
 * ============================================================================
 */

export const BRAND_NAME = 'Aurvin';
export const BRAND_EXPANSION = 'Autonomous Unified Vision, Reasoning & Intelligence Network';
export const BRAND_TAGLINE = 'Beyond assistance. Into intelligence.';
