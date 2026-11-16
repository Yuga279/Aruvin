/**
 * ============================================================================
 * FILE: AdministrationPanel.tsx
 * LOCATION: frontend/src/features/admin-config/AdministrationPanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    User management view for Super Admins with keyset paging and lifecycle actions.
 *
 * ROLE IN PROJECT:
 *    Renders the accounts table, provides deactivation/reactivation toggles,
 *    triggers mailbox password resets, and opens the creation modal.
 *
 * KEY COMPONENTS:
 *    - AdministrationPanel: Table rendering, pagination, and action dispatch.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import type {
  AdministrationClient,
  AdministrationClientError,
} from '../../api/administration-client.ts';
import type {
  AdministrationUser,
  CreateUserRequest,
} from '../../api/administration-protocol.ts';
import type { AuthUser } from '../../api/auth-protocol.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { CreateUserDialog } from './CreateUserDialog.tsx';

export type AdministrationPanelProps = {
  client: AdministrationClient;
  currentUser?: AuthUser | null;
  initialUsers?: AdministrationUser[];
  initialCursor?: string | null;
};

export function AdministrationPanel({
  client,
  currentUser,
  initialUsers,
  initialCursor = null,
}: AdministrationPanelProps) {
  const [users, setUsers] = useState<AdministrationUser[]>(() => initialUsers ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [userToDeactivate, setUserToDeactivate] = useState<AdministrationUser | null>(null);

  useEffect(() => {
    if (initialUsers) return;
    setLoading(true);
    void client
      .listUsers({ limit: 20 })
      .then((page) => {
        setUsers(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        const errorMsg = (err as AdministrationClientError)?.message ?? 'Could not load users.';
        setError(errorMsg);
      })
      .finally(() => setLoading(false));
  }, [client, initialUsers]);

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const page = await client.listUsers({ cursor: nextCursor, limit: 20 });
      setUsers((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError('Could not load next page of users.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (req: CreateUserRequest): Promise<boolean> => {
    setDialogError(null);
    try {
      const newUser = await client.createUser(req);
      setUsers((prev) => [newUser, ...prev]);
      setNotice(`User ${newUser.email} created.`);
      return true;
    } catch (err: unknown) {
      const adminErr = err as AdministrationClientError;
      if (adminErr?.code === 'ACCOUNT_CONFLICT') {
        setDialogError('An account with this email address already exists.');
      } else {
        setDialogError('User creation failed. Verify credentials and connectivity.');
      }
      return false;
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!userToDeactivate) return;
    const target = userToDeactivate;
    setActionBusyId(target.userId);
    setError(null);
    try {
      const updated = await client.deactivateUser(target.userId);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
      setNotice(`User ${target.email} deactivated.`);
      setUserToDeactivate(null);
    } catch {
      setError(`Could not deactivate user ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReactivate = async (target: AdministrationUser) => {
    setActionBusyId(target.userId);
    setError(null);
    try {
      const updated = await client.reactivateUser(target.userId);
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)));
      setNotice(`User ${target.email} reactivated.`);
    } catch {
      setError(`Could not reactivate user ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  const handlePasswordReset = async (target: AdministrationUser) => {
    setActionBusyId(target.userId);
    setError(null);
    try {
      await client.sendPasswordReset(target.userId);
      setNotice(`Password reset recovery link dispatched to ${target.email}.`);
    } catch {
      setError(`Could not send password reset to ${target.email}.`);
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="aurvin-admin-panel">
      <div className="aurvin-admin-panel-header">
        <div>
          <h2 className="aurvin-admin-section-title">User administration</h2>
          <p className="aurvin-admin-help">Manage registered accounts and provisional credentials.</p>
        </div>
        <button
          type="button"
          className="aurvin-admin-save"
          onClick={() => {
            setDialogError(null);
            setDialogOpen(true);
          }}
        >
          Create user
        </button>
      </div>

      {notice ? (
        <div className="aurvin-admin-notice" role="status">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="aurvin-admin-summary" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="aurvin-table-wrap">
        <table className="aurvin-admin-table" aria-label="Users">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((item) => {
              const isCurrentUser = currentUser?.userId === item.userId;
              const isSuperAdmin = item.role === 'super-admin';
              const isBusy = actionBusyId === item.userId;

              let statusBadge = (
                <span className="aurvin-admin-badge aurvin-admin-badge-active">Active</span>
              );
              if (item.status === 'inactive') {
                statusBadge = (
                  <span className="aurvin-admin-badge aurvin-admin-badge-inactive">Inactive</span>
                );
              } else if (item.passwordChangeRequired) {
                statusBadge = (
                  <span className="aurvin-admin-badge aurvin-admin-badge-pending">
                    Pending password change
                  </span>
                );
              }

              return (
                <tr key={item.userId}>
                  <td className="aurvin-table-email">{item.email}</td>
                  <td>{item.role === 'super-admin' ? 'Super Admin' : 'User'}</td>
                  <td>{statusBadge}</td>
                  <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td className="aurvin-table-actions">
                    {isSuperAdmin ? (
                      <span className="aurvin-admin-help">Protected</span>
                    ) : (
                      <>
                        {item.status === 'active' ? (
                          <button
                            type="button"
                            className="aurvin-btn-small aurvin-admin-btn-danger"
                            disabled={isBusy || isCurrentUser}
                            onClick={() => setUserToDeactivate(item)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="aurvin-btn-small"
                            disabled={isBusy}
                            onClick={() => handleReactivate(item)}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          className="aurvin-btn-small"
                          disabled={isBusy}
                          onClick={() => handlePasswordReset(item)}
                        >
                          Send reset
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="aurvin-admin-more">
          <button
            type="button"
            className="aurvin-admin-back"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? 'Loading…' : 'Load more users'}
          </button>
        </div>
      ) : null}

      <CreateUserDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
        error={dialogError}
      />

      {userToDeactivate ? (
        <ConfirmDialog
          open={Boolean(userToDeactivate)}
          title="Deactivate user?"
          message={`Deactivate ${userToDeactivate.email}? Active sessions will be terminated.`}
          confirmLabel="Deactivate"
          cancelLabel="Cancel"
          variant="danger"
          busy={actionBusyId === userToDeactivate.userId}
          busyLabel="Deactivating…"
          onConfirm={handleDeactivateConfirm}
          onCancel={() => {
            if (actionBusyId === null) setUserToDeactivate(null);
          }}
        />
      ) : null}
    </div>
  );
}
