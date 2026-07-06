// ConnectionIndicator render smokes — `renderToStaticMarkup` (no jsdom), same
// approach as the other component tests. Asserts every status renders a
// localized label + a non-color glyph (§10), and that version-mismatch shows
// the "update required" copy with the reported versions.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n/index.js';
import type { ConnectionStatus, VersionMismatchInfo } from '../../net/connection.js';
import { ConnectionIndicator } from './ConnectionIndicator.js';

function render(
  status: ConnectionStatus,
  versionMismatch: VersionMismatchInfo | null = null,
): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ConnectionIndicator status={status} versionMismatch={versionMismatch} />
    </I18nProvider>,
  );
}

const STATUSES: ConnectionStatus[] = [
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'version-mismatch',
  'error',
];

describe('ConnectionIndicator', () => {
  it('renders a localized label + a non-color glyph for every status', () => {
    for (const status of STATUSES) {
      const html = render(status);
      expect(html).toContain(`data-status="${status}"`);
      // A live region a screen reader announces (§10).
      expect(html).toContain('role="status"');
      // The glyph span carries the non-color channel.
      expect(html).toContain('connection-indicator__dot');
      // The label is present and non-empty (default locale ru).
      expect(html).toMatch(/connection-indicator__label">[^<]+</);
    }
  });

  it('shows the "update required" detail with both versions on a mismatch', () => {
    const html = render('version-mismatch', {
      serverVersion: '0.0.2',
      clientVersion: '0.0.1',
    });
    expect(html).toContain('connection-indicator__update');
    expect(html).toContain('0.0.2');
    expect(html).toContain('0.0.1');
  });
});
