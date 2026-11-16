/**
 * ============================================================================
 * FILE: BrandMark.tsx
 * LOCATION: frontend/src/components/BrandMark.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Aurvin "A" emblem and wordmark lockup as inline SVG.
 *
 * ROLE IN PROJECT:
 *    TEMPORARY brand mark used in the sidebar, welcome screen, profile menu
 *    and auth screens until the official Aurvin logo files are supplied.
 *    Replace the SVG paths here (and public/aurvin-mark.svg) with the real
 *    emblem; call sites will not need to change.
 *
 * KEY COMPONENTS:
 *    - BrandMark: emblem, decorative unless a title is given
 *    - BrandLockup: emblem + product name
 * ============================================================================
 */

import { useId } from 'react';
import { BRAND_NAME } from '../app/brand.ts';

export function BrandMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  const gradientId = `aurvin-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className={className ? `aurvin-brand-mark ${className}` : 'aurvin-brand-mark'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7485FF" />
          <stop offset="1" stopColor="#9B7BFF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M9 24 L16 8 L23 24"
        fill="none"
        stroke="#0B0E14"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.2 18.5 H19.8" stroke="#0B0E14" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="8" r="2.2" fill="#F4F6FA" />
    </svg>
  );
}

export function BrandLockup({ size = 28 }: { size?: number }) {
  return (
    <span className="aurvin-brand-lockup">
      <BrandMark size={size} />
      <span className="aurvin-brand-name">{BRAND_NAME}</span>
    </span>
  );
}
