/**
 * ============================================================================
 * FILE: CredentialRow.tsx
 * LOCATION: frontend/src/features/admin-config/CredentialRow.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Write-only provider credential row with replace, validate-save, and remove.
 *
 * ROLE IN PROJECT:
 *    Keeps candidate keys inside this editor only. Dashboard state receives
 *    redacted public config after a successful scoped POST.
 *
 * KEY COMPONENTS:
 *    - Fixed eight-dot configured mask
 *    - Local password editor and confirmed removal
 * ============================================================================
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  AdminConfigClientError,
  type AdminConfigClient,
} from '../../api/admin-config-client.ts';
import { MAX_CREDENTIAL_BYTES, type CredentialProvider, type CredentialState, type PublicAdminConfig } from '../../api/admin-config-protocol.ts';

export type CredentialRowProps = {
  provider: CredentialProvider;
  credential: CredentialState;
  expectedRevision: number;
  disabled: boolean;
  client: AdminConfigClient;
  onBusy: (busy: boolean) => void;
  onSaved: (config: PublicAdminConfig) => void;
  onFailure: (error: AdminConfigClientError) => void;
};

const MASK = '••••••••';
const LIMITATION = 'Checks whether the provider recognizes this key. Does not verify account credit, model access, or end-to-end voice/chat availability.';
const NEW_WORK = 'Saved settings apply to new work. Removing or replacing a key does not cancel active work, and a revoked key may still fail for in-flight requests.';

function providerLabel(provider: CredentialProvider): string {
  return provider === 'openrouter' ? 'OpenRouter' : 'Deepgram';
}

export function CredentialRow({
  provider, credential, expectedRevision, disabled, client, onBusy, onSaved, onFailure,
}: CredentialRowProps) {
  const [candidate, setCandidate] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<'replace' | 'remove' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inflight = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const replaceRef = useRef<HTMLButtonElement | null>(null);
  const removeRef = useRef<HTMLButtonElement | null>(null);
  const ids = useId();
  const label = providerLabel(provider);
  const oversize = new TextEncoder().encode(candidate).byteLength > MAX_CREDENTIAL_BYTES;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => () => {
    setCandidate('');
  }, []);

  const closeEditor = (restore: 'add' | 'replace' | null) => {
    setCandidate('');
    setEditing(false);
    queueMicrotask(() => {
      if (restore === 'add') addRef.current?.focus();
      if (restore === 'replace') replaceRef.current?.focus();
    });
  };

  const fail = (error: AdminConfigClientError, keepCandidate: boolean) => {
    inflight.current = false;
    onBusy(false);
    setPending(null);
    if (!keepCandidate) setCandidate('');
    if (!keepCandidate) setEditing(false);
    onFailure(error);
  };

  const replace = async () => {
    if (inflight.current || disabled || oversize || candidate === '') return;
    inflight.current = true;
    onBusy(true);
    setPending('replace');
    setStatus('Validating and saving');
    try {
      const config = await client.updateCredential(provider, {
        protocolVersion: 1,
        expectedRevision,
        action: 'replace',
        candidate,
      });
      setCandidate('');
      setEditing(false);
      setPending(null);
      setStatus(null);
      inflight.current = false;
      onBusy(false);
      onSaved(config);
    } catch (error) {
      const failure = error instanceof AdminConfigClientError
        ? error
        : new AdminConfigClientError({ code: 'NETWORK_ERROR', uncertain: true });
      const actionable = failure.code === 'CREDENTIAL_REJECTED' || failure.code === 'CONFIG_VALIDATION_FAILED';
      fail(failure, actionable);
    }
  };

  const remove = async () => {
    if (inflight.current || disabled) return;
    inflight.current = true;
    onBusy(true);
    setPending('remove');
    try {
      const config = await client.updateCredential(provider, {
        protocolVersion: 1,
        expectedRevision,
        action: 'remove',
        confirm: true,
      });
      setConfirming(false);
      setPending(null);
      inflight.current = false;
      onBusy(false);
      onSaved(config);
    } catch (error) {
      const failure = error instanceof AdminConfigClientError
        ? error
        : new AdminConfigClientError({ code: 'NETWORK_ERROR', uncertain: true });
      setPending(null);
      inflight.current = false;
      onBusy(false);
      onFailure(failure);
    }
  };

  const onEscape = (event: { key: string; preventDefault: () => void }) => {
    if (event.key !== 'Escape') return;
    if (pending) {
      setStatus('Wait for the save to finish');
      return;
    }
    event.preventDefault();
    if (editing) closeEditor(credential.configured ? 'replace' : 'add');
    if (confirming) {
      setConfirming(false);
      queueMicrotask(() => removeRef.current?.focus());
    }
  };

  return (
    <section className="aurvin-admin-credential" onKeyDown={onEscape}>
      <h3 className="aurvin-admin-credential-label">{label} API key</h3>
      {credential.configured ? (
        <div className="aurvin-admin-credential-state">
          <span className="aurvin-admin-mask" aria-hidden="true">{MASK}</span>
          <span>Configured</span>
          {credential.validatedAt ? (
            <span className="aurvin-admin-help">Last validation {credential.validatedAt}</span>
          ) : null}
          <button ref={replaceRef} type="button" disabled={disabled || pending !== null} onClick={() => {
            setConfirming(false);
            setEditing(true);
          }}>Replace key</button>
          <button ref={removeRef} type="button" disabled={disabled || pending !== null} onClick={() => {
            setEditing(false);
            setConfirming(true);
          }}>Remove key</button>
        </div>
      ) : (
        <div className="aurvin-admin-credential-state">
          <span>Not configured</span>
          <button ref={addRef} type="button" disabled={disabled || pending !== null} onClick={() => setEditing(true)}>
            Add key
          </button>
        </div>
      )}

      {editing ? (
        <form
          className="aurvin-admin-credential-editor"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void replace();
          }}
        >
          <label htmlFor={`${ids}-candidate`}>{label} API key</label>
          <input
            ref={inputRef}
            id={`${ids}-candidate`}
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_CREDENTIAL_BYTES}
            value={candidate}
            disabled={disabled || pending !== null}
            onChange={(event) => setCandidate(event.target.value)}
          />
          <button type="submit" disabled={disabled || pending !== null || candidate === '' || oversize}>
            {pending === 'replace' ? 'Validating and saving' : 'Validate and save'}
          </button>
          <button type="button" disabled={pending !== null} onClick={() => closeEditor(credential.configured ? 'replace' : 'add')}>
            Cancel
          </button>
        </form>
      ) : null}

      {confirming ? (
        <div className="aurvin-admin-confirm" role="group" aria-label={`Remove the ${label} key?`} tabIndex={-1}>
          <p>Remove the {label} key?</p>
          <p>New work may be unavailable. Active work is not canceled by this change.</p>
          <button type="button" disabled={disabled || pending !== null} onClick={() => { void remove(); }}>
            {pending === 'remove' ? 'Removing' : 'Confirm removal'}
          </button>
          <button type="button" disabled={pending !== null} onClick={() => {
            setConfirming(false);
            removeRef.current?.focus();
          }}>Cancel</button>
        </div>
      ) : null}

      <p className="aurvin-admin-help">{LIMITATION}</p>
      <p className="aurvin-admin-help">{NEW_WORK}</p>
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
    </section>
  );
}
