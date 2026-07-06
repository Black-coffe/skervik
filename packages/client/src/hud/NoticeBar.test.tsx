// NoticeBar render smoke — `renderToStaticMarkup` (no jsdom). SSR reads the
// store's INITIAL snapshot (notice = null), so this asserts the always-present
// empty aria-live region; the notice→copy mapping is unit-tested in
// `notice.test.ts` and the reconciliation that SETS a notice in `store.test.ts`.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/index.js';
import { NoticeBar } from './NoticeBar.js';

describe('NoticeBar', () => {
  it('is an always-present aria-live region, empty when there is no notice', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <NoticeBar />
      </I18nProvider>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('notice-bar__item');
  });
});
