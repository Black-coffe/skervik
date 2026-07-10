// LobbyScreen render smoke — `renderToStaticMarkup` (no jsdom), mirrors
// `hud/NoticeBar.test.tsx`. Asserts the two radiogroups + all four shipping
// presets render with localized copy, and that Start never fires on render
// alone (only a real click would call `onStart`).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/index.js';
import { LobbyScreen } from './LobbyScreen.js';

describe('LobbyScreen', () => {
  it('renders both radiogroups, all four shipping presets, and a Start button — onStart never fires on render alone', () => {
    const onStart = vi.fn();
    // `ru` is DEFAULT_LOCALE (`i18n/locale.ts`) — assert the RU copy, same as
    // every other component's default-render smoke test in this codebase.
    const html = renderToStaticMarkup(
      <I18nProvider>
        <LobbyScreen onStart={onStart} />
      </I18nProvider>,
    );

    expect(html).toContain('role="radiogroup"');
    // All four shipping preset names present.
    expect(html).toContain('Классика');
    expect(html).toContain('Баланс');
    expect(html).toContain('Блиц');
    expect(html).toContain('На двоих');
    // Classic is the default selection.
    expect(html).toContain('aria-checked="true"');
    // Bot-count options 0..3.
    for (const n of [0, 1, 2, 3]) {
      expect(html).toContain(`>${n}<`);
    }
    expect(html).toContain('Начать партию');
    expect(onStart).not.toHaveBeenCalled();
  });
});
