// LobbyScreen render smoke — `renderToStaticMarkup` (no jsdom), mirrors
// `hud/NoticeBar.test.tsx`. Asserts the default (quick match) render:
// three radiogroups, all five shipping presets (S2.1.7b-05 adds `expanded` /
// Grand Chart), a Start button, and that Start never fires on render alone.
// The store-driven CONDITIONAL sections
// (join-by-code hides the rule selectors, the invite link, Start-disabled)
// are proven separately + purely by `lobbyStore.test.ts`'s
// `deriveLobbyViewState` tests — NOT here: zustand v5's SSR `getServerSnapshot`
// is backed by `getInitialState()` (frozen at module load), so
// `renderToStaticMarkup` can never observe a `setState()` a test makes before
// rendering (see `deriveLobbyViewState`'s doc comment for the full reasoning).
// That same freeze is why the duration section is rendered directly, from a
// prop, below: it is the only way to render a NON-default pick at all.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/index.js';
import type { Locale } from '../i18n/locale.js';
import { LobbyDurationSection, LobbyScreen } from './LobbyScreen.js';
import { type LobbyDurationEstimate, selectDurationEstimate } from './lobbyStore.js';

// `I18nProvider` picks its locale from `window.localStorage`, falling back to
// DEFAULT_LOCALE (`ru`) when there is no `window` at all — which is every test
// in this node-environment suite. Stubbing a minimal `window` is therefore the
// switch that lets one render assert EN/RU/UK copy, as ADR-0008 requires of any
// string that ships.
function renderIn(locale: Locale, node: ReactElement): string {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => locale, setItem: () => {} },
  });
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LobbyScreen', () => {
  it('renders the join-mode, preset, and bot-count radiogroups, all five shipping presets, and a Start button — onStart never fires on render alone', () => {
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
    // All five shipping preset names present (S2.1.7b-05: expanded/Grand Chart).
    expect(html).toContain('Классика');
    expect(html).toContain('Баланс');
    expect(html).toContain('Блиц');
    expect(html).toContain('На двоих');
    expect(html).toContain('Большая лоция');
    // Quick match + Classic are the default selections.
    expect(html.match(/aria-checked="true"/g)?.length).toBeGreaterThanOrEqual(2);
    // Bot-count options 0..3, under a label whose separator now lives in the
    // catalogue string, not in the JSX.
    expect(html).toContain('Команда ботов — 0 ботов');
    for (const n of [0, 1, 2, 3]) {
      expect(html).toContain(`>${n}<`);
    }
    expect(html).toContain('Начать партию');
    expect(onStart).not.toHaveBeenCalled();
    // Default mode is quick match — no room-code input, no invite section.
    expect(html).not.toContain('lobby-room-code');
    expect(html).not.toContain('lobby-screen__invite');
  });

  // S2.1.3 wired live (m2-gate-02): the advisory duration readout.
  it('renders the estimated match length for the default pick, with NO lowered-target notice and NO over-ceiling warning — Classic at its 2-seat floor is 34 min on its own 10-renown track', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <LobbyScreen onStart={vi.fn()} />
      </I18nProvider>,
    );

    // The literal the estimator produces for the default pick, pinned rather
    // than recomputed through the function under test (lead-review minor): a
    // change to the heuristic — or to the VP floor, which m2-gate-06 raised to
    // 8 — must fail here instead of silently agreeing with itself.
    expect(html).toContain('Примерная длительность — около 34 минут');
    // Classic 2p plays its own rules: nothing was adjusted, nothing warned.
    expect(html).not.toContain('победная цель снижена');
    expect(html).not.toContain('дольше часа');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('pill--warning');
  });
});

// --- m2-gate-09 (lead-review C2): the lobby discloses the rule change --------
// The adaptation lowers the victory target for Grand Chart tables, and after
// m2-gate-06's floor clamp the six-seat table genuinely outruns the hour. Both
// notices are asserted POSITIVELY, from the real estimates the store computes.
describe('LobbyDurationSection — the adjustment + ceiling disclosure', () => {
  const FIVE_SEAT = selectDurationEstimate({ profileId: 'expanded', botCount: 4 });
  const SIX_SEAT = selectDurationEstimate({ profileId: 'expanded', botCount: 5 });

  it('[forcing] a five-seat Grand Chart pick renders "victory target lowered to 8" and NO ceiling warning — it fits the hour at 58 min', () => {
    const html = renderIn('ru', <LobbyDurationSection estimate={FIVE_SEAT} />);

    expect(html).toContain('Примерная длительность — около 58 минут');
    expect(html).toContain('Для такого стола победная цель снижена до 8 очков славы.');
    expect(html).not.toContain('дольше часа');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    // Info tone only — the warning modifier belongs to the ceiling notice.
    expect(html).toContain('lobby-screen__duration-notice');
    expect(html).not.toContain('lobby-screen__duration-notice--warning');
  });

  it('[forcing] a six-seat Grand Chart pick renders BOTH notices — the lowered target and the over-ceiling warning, which m2-gate-06 made reachable (67.6 min at the VP floor)', () => {
    const html = renderIn('ru', <LobbyDurationSection estimate={SIX_SEAT} />);

    expect(html).toContain('Примерная длительность — около 68 минут');
    expect(html).toContain('Для такого стола победная цель снижена до 8 очков славы.');
    expect(html).toContain(
      'Даже на самой короткой дистанции такая команда играет дольше часа.',
    );
    expect(html.match(/role="status"/g)).toHaveLength(2);
    // The two tones: the disclosure carries the base (info) class, the
    // over-ceiling sentence adds the warning modifier.
    expect(html.match(/lobby-screen__duration-notice/g)).toHaveLength(3);
    expect(html.match(/lobby-screen__duration-notice--warning/g)).toHaveLength(1);
  });

  it('[forcing] every preset that plays its base rules renders the length alone — no lowered-target notice, no warning, no live region', () => {
    for (const profileId of ['classic', 'balanced', 'blitz', 'twoPlayer'] as const) {
      const estimate = selectDurationEstimate({ profileId, botCount: 1 });
      const html = renderIn('ru', <LobbyDurationSection estimate={estimate} />);

      expect(html).toContain('Примерная длительность');
      expect(html).not.toContain('победная цель снижена');
      expect(html).not.toContain('дольше часа');
      expect(html).not.toContain('role="status"');
    }
  });

  it('[forcing] the section carries its own a11y label, and the notices are sentences in the flow — never `Pill` chips (DESIGN.md §11: chips are counts and timers)', () => {
    const html = renderIn('ru', <LobbyDurationSection estimate={SIX_SEAT} />);

    expect(html).toContain('aria-label="Оценка длительности партии"');
    expect(html).not.toContain('pill');
  });

  it('[forcing] both notices ship in all three locales — EN and UK render their own copy, not the RU fallback or a bare key', () => {
    const en = renderIn('en', <LobbyDurationSection estimate={SIX_SEAT} />);
    expect(en).toContain('Estimated length — about 68 minutes');
    expect(en).toContain('A table this size lowers the victory target to 8 renown.');
    expect(en).toContain(
      'Even on the shortest victory track, a crew this size sails past the hour.',
    );
    expect(en).toContain('aria-label="Estimated match length"');

    const uk = renderIn('uk', <LobbyDurationSection estimate={SIX_SEAT} />);
    expect(uk).toContain('Приблизна тривалість — близько 68 хвилин');
    expect(uk).toContain('Для такого столу переможну ціль знижено до 8 очок слави.');
    expect(uk).toContain(
      'Навіть на найкоротшій дистанції така команда грає довше за годину.',
    );
    expect(uk).toContain('aria-label="Оцінка тривалості партії"');

    // No locale leaks a raw key through `translate`'s missing-message fallback.
    for (const html of [en, uk]) {
      expect(html).not.toContain('lobby.duration');
      expect(html).not.toContain('a11y.duration');
    }
  });

  it('a hand-built estimate with no adjustment renders neither notice — the branch is driven by the data, not by the preset id', () => {
    const untouched: LobbyDurationEstimate = {
      playerCount: 6,
      minutes: 42,
      loweredVpToWin: null,
      exceedsCeiling: false,
    };
    const html = renderIn('en', <LobbyDurationSection estimate={untouched} />);

    expect(html).toContain('Estimated length — about 42 minutes');
    expect(html).not.toContain('victory target');
    expect(html).not.toContain('role="status"');
  });
});
