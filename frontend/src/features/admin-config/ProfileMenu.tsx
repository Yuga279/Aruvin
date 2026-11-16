/**
 * ============================================================================
 * FILE: ProfileMenu.tsx
 * LOCATION: frontend/src/features/admin-config/ProfileMenu.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Native bottom-profile disclosure for user account and role management.
 *
 * ROLE IN PROJECT:
 *    Pins Manage Aurvin, the theme switch and working Sign out under chat
 *    history reflecting the active authenticated account's email and role.
 *
 * KEY COMPONENTS:
 *    - Role badge & email summary
 *    - Manage Aurvin, System/Dark/Light theme switch, Sign out buttons
 * ============================================================================
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { AuthUser } from '../../api/auth-protocol.ts';
import { BrandMark } from '../../components/BrandMark.tsx';
import { useTheme } from '../../app/theme/ThemeProvider.tsx';
import { THEME_PREFERENCES } from '../../app/theme/theme.ts';
import './admin-config.css';

export type ProfileMenuProps = {
  user?: AuthUser | null;
  onManageAurvin: () => void;
  onSignOut?: () => void;
};

export function ProfileMenu({ user, onManageAurvin, onSignOut }: ProfileMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const manageRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const themeLabelId = useId();
  const theme = useTheme();

  useEffect(() => {
    if (!open) return undefined;
    manageRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.contains(event.target as Node)) {
        if (details) details.open = false;
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const roleLabel = user?.role === 'user' ? 'User' : 'Super admin';
  const displayLabel = user?.email ?? 'Super admin';

  return (
    <details
      ref={detailsRef}
      className="aurvin-profile"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.currentTarget.open = false;
        setOpen(false);
        event.currentTarget.querySelector('summary')?.focus();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.open = false;
          setOpen(false);
        }
      }}
    >
      <summary className="aurvin-profile-trigger" aria-label={displayLabel}>
        <span className="aurvin-profile-mark" aria-hidden="true">
          <BrandMark size={20} />
        </span>
        <div className="aurvin-profile-labels">
          <span className="aurvin-profile-name">{displayLabel}</span>
          {user ? <span className="aurvin-profile-role">{roleLabel}</span> : null}
        </div>
      </summary>
      <div className="aurvin-profile-menu">
        <button
          ref={manageRef}
          type="button"
          onClick={() => {
            if (detailsRef.current) detailsRef.current.open = false;
            setOpen(false);
            onManageAurvin();
          }}
        >
          Manage Aurvin
        </button>
        {theme ? (
          <div className="aurvin-theme-switch" role="group" aria-labelledby={themeLabelId}>
            <span id={themeLabelId} className="aurvin-theme-switch-label">Theme</span>
            <div className="aurvin-theme-switch-options">
              {THEME_PREFERENCES.map((preference) => (
                <button
                  key={preference}
                  type="button"
                  aria-pressed={theme.preference === preference}
                  onClick={() => theme.setPreference(preference)}
                >
                  {preference[0].toUpperCase() + preference.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {onSignOut ? (
          <button
            type="button"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        ) : (
          <>
            <button type="button" disabled aria-describedby={helpId}>
              Sign out
            </button>
            <p id={helpId} className="aurvin-admin-help">
              Authentication not enabled.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
