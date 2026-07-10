// LobbyScreen (S2.5.4) — the pre-match "Instruments" surface (DESIGN.md §1):
// choose a rule preset + how many bots fill the table, then Start. Reuses the
// LocaleSwitcher's roving-tabindex radiogroup pattern (DESIGN.md §10 keyboard
// law) for both selectors; selection state is never color-only — the active
// option also carries a checkmark glyph and a border/background change.
import './LobbyScreen.css';

import { type RuleProfileId, SHIPPING_PROFILE_IDS } from '@skervik/core';
import type { KeyboardEvent } from 'react';
import { useRef } from 'react';

import { Button } from '../hud/components/Button.js';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import type { LobbyJoinFields } from '../net/wsClient.js';
import { MAX_LOBBY_BOTS, selectLobbySelection, useLobbyStore } from './lobbyStore.js';

/** One name/description key pair per shipping preset — authored in `docs`/`i18n/locales/*` (S2.5.4, all 3 locales). */
const PRESET_KEYS: Record<
  RuleProfileId,
  { readonly name: TranslationKey; readonly description: TranslationKey }
> = {
  classic: {
    name: 'lobby.preset.classic.name',
    description: 'lobby.preset.classic.description',
  },
  balanced: {
    name: 'lobby.preset.balanced.name',
    description: 'lobby.preset.balanced.description',
  },
  blitz: {
    name: 'lobby.preset.blitz.name',
    description: 'lobby.preset.blitz.description',
  },
  twoPlayer: {
    name: 'lobby.preset.twoPlayer.name',
    description: 'lobby.preset.twoPlayer.description',
  },
};

/** [0, 1, ..., MAX_LOBBY_BOTS] — the selectable bot-count options. */
const BOT_COUNT_OPTIONS = Array.from({ length: MAX_LOBBY_BOTS + 1 }, (_, i) => i);

export interface LobbyScreenProps {
  /** Fires once, when Start is pressed — `main.tsx` owns turning this into a `connect()` call. */
  readonly onStart: (selection: LobbyJoinFields) => void;
}

export function LobbyScreen({ onStart }: LobbyScreenProps) {
  const { t } = useTranslation();
  const profileId = useLobbyStore((state) => state.profileId);
  const botCount = useLobbyStore((state) => state.botCount);
  const setProfileId = useLobbyStore((state) => state.setProfileId);
  const setBotCount = useLobbyStore((state) => state.setBotCount);

  const presetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const botRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handlePresetKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % SHIPPING_PROFILE_IDS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + SHIPPING_PROFILE_IDS.length) % SHIPPING_PROFILE_IDS.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = SHIPPING_PROFILE_IDS[nextIndex] as RuleProfileId;
    setProfileId(next);
    presetRefs.current[nextIndex]?.focus();
  }

  function handleBotKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % BOT_COUNT_OPTIONS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + BOT_COUNT_OPTIONS.length) % BOT_COUNT_OPTIONS.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = BOT_COUNT_OPTIONS[nextIndex] as number;
    setBotCount(next);
    botRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-screen__panel">
        <h1 className="lobby-screen__title">{t('lobby.title')}</h1>

        <section className="lobby-screen__section">
          <span className="lobby-screen__label">{t('lobby.presetLabel')}</span>
          <div
            className="lobby-screen__presets"
            role="radiogroup"
            aria-label={t('a11y.presetSelector')}
          >
            {SHIPPING_PROFILE_IDS.map((id, index) => {
              const active = id === profileId;
              const keys = PRESET_KEYS[id];
              return (
                <button
                  key={id}
                  ref={(el) => {
                    presetRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-active={active}
                  tabIndex={active ? 0 : -1}
                  className="lobby-screen__preset"
                  onClick={() => setProfileId(id)}
                  onKeyDown={(event) => handlePresetKeyDown(event, index)}
                >
                  <span className="lobby-screen__preset-mark" aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                  <span className="lobby-screen__preset-name">{t(keys.name)}</span>
                  <span className="lobby-screen__preset-description">
                    {t(keys.description)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="lobby-screen__section">
          <span className="lobby-screen__label">
            {t('lobby.botCountLabel')} — {t('lobby.botCount', { count: botCount })}
          </span>
          <div
            className="lobby-screen__bot-count"
            role="radiogroup"
            aria-label={t('a11y.botCountSelector')}
          >
            {BOT_COUNT_OPTIONS.map((count, index) => {
              const active = count === botCount;
              return (
                <button
                  key={count}
                  ref={(el) => {
                    botRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-active={active}
                  tabIndex={active ? 0 : -1}
                  className="lobby-screen__bot-option"
                  onClick={() => setBotCount(count)}
                  onKeyDown={(event) => handleBotKeyDown(event, index)}
                >
                  {count}
                </button>
              );
            })}
          </div>
        </section>

        <Button
          variant="primary"
          className="lobby-screen__start"
          onClick={() => onStart(selectLobbySelection(useLobbyStore.getState()))}
        >
          {t('lobby.startButton')}
        </Button>
      </div>
    </div>
  );
}
