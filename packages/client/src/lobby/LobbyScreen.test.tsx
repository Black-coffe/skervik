// LobbyScreen render smoke — `renderToStaticMarkup` (no jsdom), mirrors
// `hud/NoticeBar.test.tsx`. Asserts the default (quick match) render:
// three radiogroups, all four shipping presets, a Start button, and that
// Start never fires on render alone. The store-driven CONDITIONAL sections
// (join-by-code hides the rule selectors, the invite link, Start-disabled)
// are proven separately + purely by `lobbyStore.test.ts`'s
// `deriveLobbyViewState` tests — NOT here: zustand v5's SSR `getServerSnapshot`
// is backed by `getInitialState()` (frozen at module load), so
// `renderToStaticMarkup` can never observe a `setState()` a test makes before
// rendering (see `deriveLobbyViewState`'s doc comment for the full reasoning).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/index.js';
import { LobbyScreen } from './LobbyScreen.js';

describe('LobbyScreen', () => {
  it('renders the join-mode, preset, and bot-count radiogroups, all four shipping presets, and a Start button — onStart never fires on render alone', () => {
    const onStart = vi.fn();
    // `ru` is DEFAULT_LOCALE (`i18n/locale.ts`) — assert the RU copy, same as
    // every other component's default-render smoke test in this codebase.
    const html = renderToStaticMarkup(
      <I18nProvider>
        <LobbyScreen onStart={onStart} />
      </I18nProvider>,
    );

    expect(html.match(/role="radiogroup"/g)).toHaveLength(3);
    // The join-mode selector, defaulting to quick match.
    expect(html).toContain('Быстрый поиск');
    expect(html).toContain('Создать приватную');
    expect(html).toContain('По коду');
    // All four shipping preset names present.
    expect(html).toContain('Классика');
    expect(html).toContain('Баланс');
    expect(html).toContain('Блиц');
    expect(html).toContain('На двоих');
    // Quick match + Classic are the default selections.
    expect(html.match(/aria-checked="true"/g)?.length).toBeGreaterThanOrEqual(2);
    // Bot-count options 0..3.
    for (const n of [0, 1, 2, 3]) {
      expect(html).toContain(`>${n}<`);
    }
    expect(html).toContain('Начать партию');
    expect(onStart).not.toHaveBeenCalled();
    // Default mode is quick match — no room-code input, no invite section.
    expect(html).not.toContain('lobby-room-code');
    expect(html).not.toContain('lobby-screen__invite');
  });
});
