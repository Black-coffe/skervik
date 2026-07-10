// LobbyScreen (S2.5.4, extended S2.5.3) — the pre-match "Instruments" surface
// (DESIGN.md §1): pick a join mode (quick match / create private / join by
// code), a rule preset + bot fill for the modes that create a fresh match,
// then Start. Reuses the LocaleSwitcher's roving-tabindex radiogroup pattern
// (DESIGN.md §10 keyboard law) for every selector; selection state is never
// color-only — the active option also carries a checkmark glyph and a
// border/background change.
import './LobbyScreen.css';

import { type RuleProfileId, SHIPPING_PROFILE_IDS } from '@skervik/core';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useRef, useState } from 'react';

import { Button } from '../hud/components/Button.js';
import { useUiStore } from '../hud/store.js';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import type { JoinMode, LobbyJoinFields } from '../net/wsClient.js';
import {
  deriveLobbyViewState,
  type LobbyJoinModeChoice,
  MAX_LOBBY_BOTS,
  selectJoinMode,
  selectLobbySelection,
  useLobbyStore,
} from './lobbyStore.js';

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

/** The three join-mode choices (S2.5.3), in display/keyboard-cycle order. */
const JOIN_MODES: readonly LobbyJoinModeChoice[] = [
  'quickMatch',
  'createPrivate',
  'joinByCode',
];

const JOIN_MODE_KEYS: Record<
  LobbyJoinModeChoice,
  { readonly name: TranslationKey; readonly description: TranslationKey }
> = {
  quickMatch: {
    name: 'lobby.joinMode.quickMatch.name',
    description: 'lobby.joinMode.quickMatch.description',
  },
  createPrivate: {
    name: 'lobby.joinMode.createPrivate.name',
    description: 'lobby.joinMode.createPrivate.description',
  },
  joinByCode: {
    name: 'lobby.joinMode.joinByCode.name',
    description: 'lobby.joinMode.joinByCode.description',
  },
};

export interface LobbyScreenProps {
  /** Fires once, when Start is pressed — `main.tsx` owns turning this into a `connect()` call. */
  readonly onStart: (selection: LobbyJoinFields, joinMode: JoinMode) => void;
}

export function LobbyScreen({ onStart }: LobbyScreenProps) {
  const { t } = useTranslation();
  const profileId = useLobbyStore((state) => state.profileId);
  const botCount = useLobbyStore((state) => state.botCount);
  const joinMode = useLobbyStore((state) => state.joinMode);
  const roomCode = useLobbyStore((state) => state.roomCode);
  const setProfileId = useLobbyStore((state) => state.setProfileId);
  const setBotCount = useLobbyStore((state) => state.setBotCount);
  const setJoinMode = useLobbyStore((state) => state.setJoinMode);
  const setRoomCode = useLobbyStore((state) => state.setRoomCode);
  // The live connection handle (S1.6.5) — once a `createPrivate` join
  // resolves, its `roomId` IS the shareable invite code/link (S2.5.3).
  const connection = useUiStore((state) => state.connection);
  const [copied, setCopied] = useState(false);

  const joinModeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const presetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const botRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleJoinModeKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % JOIN_MODES.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + JOIN_MODES.length) % JOIN_MODES.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = JOIN_MODES[nextIndex] as LobbyJoinModeChoice;
    setJoinMode(next);
    joinModeRefs.current[nextIndex]?.focus();
  }

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

  function handleRoomCodeChange(event: ChangeEvent<HTMLInputElement>) {
    setRoomCode(event.target.value);
  }

  async function handleCopyLink(roomId: string) {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions/insecure context) — the code
      // and link are still shown as plain text, so the host can select+copy
      // manually. No failure notice: this is a convenience affordance, not a
      // required action.
    }
  }

  const { showRuleSelectors, showInvite, startDisabled } = deriveLobbyViewState(
    { joinMode, roomCode },
    connection?.roomId ?? null,
  );

  return (
    <div className="lobby-screen">
      <div className="lobby-screen__panel">
        <h1 className="lobby-screen__title">{t('lobby.title')}</h1>

        <section className="lobby-screen__section">
          <span className="lobby-screen__label">{t('lobby.joinModeLabel')}</span>
          <div
            className="lobby-screen__presets"
            role="radiogroup"
            aria-label={t('a11y.joinModeSelector')}
          >
            {JOIN_MODES.map((mode, index) => {
              const active = mode === joinMode;
              const keys = JOIN_MODE_KEYS[mode];
              return (
                <button
                  key={mode}
                  ref={(el) => {
                    joinModeRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-active={active}
                  tabIndex={active ? 0 : -1}
                  className="lobby-screen__preset"
                  onClick={() => setJoinMode(mode)}
                  onKeyDown={(event) => handleJoinModeKeyDown(event, index)}
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

        {joinMode === 'joinByCode' && (
          <section className="lobby-screen__section">
            <label className="lobby-screen__label" htmlFor="lobby-room-code">
              {t('lobby.roomCodeLabel')}
            </label>
            <input
              id="lobby-room-code"
              className="lobby-screen__room-code-input"
              type="text"
              value={roomCode}
              onChange={handleRoomCodeChange}
              aria-label={t('a11y.roomCodeInput')}
              autoComplete="off"
            />
          </section>
        )}

        {showRuleSelectors && (
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
        )}

        {showRuleSelectors && (
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
        )}

        {showInvite && connection && (
          <section className="lobby-screen__section">
            <span className="lobby-screen__label">{t('lobby.inviteLabel')}</span>
            <div className="lobby-screen__invite">
              <code className="lobby-screen__invite-code">{connection.roomId}</code>
              <Button
                variant="quiet"
                onClick={() => void handleCopyLink(connection.roomId)}
              >
                {copied ? t('lobby.copied') : t('lobby.copyLink')}
              </Button>
            </div>
            <p className="lobby-screen__invite-hint">{t('lobby.inviteHint')}</p>
          </section>
        )}

        <Button
          variant="primary"
          className="lobby-screen__start"
          disabled={startDisabled}
          onClick={() =>
            onStart(
              selectLobbySelection(useLobbyStore.getState()),
              selectJoinMode(useLobbyStore.getState()),
            )
          }
        >
          {t('lobby.startButton')}
        </Button>
      </div>
    </div>
  );
}
