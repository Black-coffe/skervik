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
import { useMemo, useRef, useState } from 'react';

import { Button } from '../hud/components/Button.js';
import { Pill } from '../hud/components/Pill.js';
import { useUiStore } from '../hud/store.js';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import type { JoinMode, LobbyJoinFields } from '../net/wsClient.js';
import {
  deriveLobbyViewState,
  type LobbyJoinModeChoice,
  maxBotsForProfile,
  selectDurationEstimate,
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
  expanded: {
    name: 'lobby.preset.expanded.name',
    description: 'lobby.preset.expanded.description',
  },
};

/** [0, 1, ..., maxBotsForProfile(profileId)] — the selectable bot-count options, preset-dependent (S2.1.7b-05). */
function botCountOptionsFor(profileId: RuleProfileId): readonly number[] {
  return Array.from({ length: maxBotsForProfile(profileId) + 1 }, (_, i) => i);
}

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
  // S2.5.2: transport-only host/manual-start signals, folded from
  // `state.snapshot` (never derived from `gameState`).
  const isHost = useUiStore((state) => state.isHost);
  const isPrivateRoom = useUiStore((state) => state.isPrivateRoom);
  const [copied, setCopied] = useState(false);

  // Preset-dependent (S2.1.7b-05): recomputed only when the selected preset
  // changes, not on every render.
  const botCountOptions = useMemo(() => botCountOptionsFor(profileId), [profileId]);

  // The advisory ≤60-min readout (S2.1.3 wired live, m2-gate-02) — the SAME
  // core calculator the room applies at genesis, re-run only when the two
  // inputs it reads actually change.
  const duration = useMemo(
    () => selectDurationEstimate({ profileId, botCount }),
    [profileId, botCount],
  );

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
      nextIndex = (index + 1) % botCountOptions.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + botCountOptions.length) % botCountOptions.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = botCountOptions[nextIndex] as number;
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

  const connected = connection !== null;
  const {
    showRuleSelectors,
    showInvite,
    startDisabled,
    showStartMatchButton,
    showWaitingForHost,
    showWaitingForPlayers,
  } = deriveLobbyViewState({ joinMode, roomCode }, connection?.roomId ?? null, {
    isHost,
    isPrivate: isPrivateRoom,
  });

  return (
    <div className="lobby-screen">
      <div className="lobby-screen__panel">
        <h1 className="lobby-screen__title">{t('lobby.title')}</h1>

        {/* Join-mode/preset/bot pick + the connect-Start button — the
            PRE-CONNECT picker (S2.5.4/S2.5.3). Once connected (S2.5.2), this
            whole picker is replaced by the invite/waiting/Begin-match
            sections below: "Only the host sees and can press 'Start match'.
            Joiners see a 'waiting for host to start' state" — a REPLACEMENT
            of the picker, not an addition alongside it (you already joined). */}
        {!connected && (
          <>
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
                  {botCountOptions.map((count, index) => {
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

            {/* Adaptive match length (S2.1.3 wired live, m2-gate-02): the
                estimate for the picked preset + table size, and — only when
                even the VP floor can't fit the 60-min ceiling — the warning.
                A PLAIN conditional render (no debounce, no animation); the
                warning borrows `Pill`'s `warning` tone so it carries DESIGN.md
                tokens rather than a colour of its own. Shown alongside the
                rule selectors: it describes the very pick they make, and is
                meaningless for a joiner who inherits the host's rules. */}
            {showRuleSelectors && (
              <section className="lobby-screen__section">
                <span className="lobby-screen__label">
                  {t('lobby.durationLabel')} —{' '}
                  {t('lobby.durationMinutes', { count: duration.minutes })}
                </span>
                {duration.exceedsCeiling && (
                  <Pill tone="warning">{t('lobby.durationWarning')}</Pill>
                )}
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
          </>
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

        {/* S2.5.2: host-only manual start (private rooms) vs. the
            corresponding waiting states — mutually exclusive with the
            pre-connect picker above and with each other. */}
        {showStartMatchButton && connection && (
          <Button
            variant="primary"
            className="lobby-screen__start"
            onClick={() => connection.startMatch()}
          >
            {t('lobby.beginMatchButton')}
          </Button>
        )}
        {showWaitingForHost && (
          <p className="lobby-screen__waiting">{t('lobby.waitingForHost')}</p>
        )}
        {showWaitingForPlayers && (
          <p className="lobby-screen__waiting">{t('lobby.waitingForPlayers')}</p>
        )}
      </div>
    </div>
  );
}
