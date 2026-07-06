// ConnectionIndicator — DESIGN.md §6/§10: the live connection state on the
// rail, replacing the S1.6.3 "online" stub. Localized, and distinguished by a
// glyph AND text (never color-only). A `version-mismatch` expands to the
// "update required" prompt carrying the reported server/client versions.
// Presentational (state arrives as props) so each status renders + tests in
// isolation; `PlayersRail` wires the store values in.
import './ConnectionIndicator.css';

import { useTranslation } from '../../i18n/index.js';
import type { ConnectionStatus, VersionMismatchInfo } from '../../net/connection.js';

const STATUS_KEY = {
  connecting: 'connection.connecting',
  connected: 'connection.connected',
  reconnecting: 'connection.reconnecting',
  disconnected: 'connection.disconnected',
  'version-mismatch': 'connection.updateRequired',
  error: 'connection.error',
} as const satisfies Record<ConnectionStatus, string>;

/** A distinct glyph per status — the non-color channel required by §10. */
const STATUS_ICON = {
  connecting: '◐',
  connected: '●',
  reconnecting: '◑',
  disconnected: '○',
  'version-mismatch': '⚠',
  error: '⚠',
} as const satisfies Record<ConnectionStatus, string>;

export interface ConnectionIndicatorProps {
  readonly status: ConnectionStatus;
  readonly versionMismatch: VersionMismatchInfo | null;
}

export function ConnectionIndicator({
  status,
  versionMismatch,
}: ConnectionIndicatorProps) {
  const { t } = useTranslation();
  return (
    <div
      className="connection-indicator"
      data-status={status}
      role="status"
      aria-live="polite"
      aria-label={t('a11y.connectionStatus')}
    >
      <span className="connection-indicator__dot" aria-hidden="true">
        {STATUS_ICON[status]}
      </span>
      <span className="connection-indicator__label">{t(STATUS_KEY[status])}</span>
      {status === 'version-mismatch' ? (
        <p className="connection-indicator__update">
          {t('connection.updateRequiredDetail', {
            serverVersion: versionMismatch?.serverVersion ?? '?',
            clientVersion: versionMismatch?.clientVersion ?? '?',
          })}
        </p>
      ) : null}
    </div>
  );
}
