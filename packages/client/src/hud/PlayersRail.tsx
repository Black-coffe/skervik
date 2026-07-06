// PlayersRail — DESIGN.md §6 left rail: one PlayerCard per player in the
// STABLE `playerOrder` (never reordered). Also hosts the `aria-live="polite"`
// turn-change announcement (§10).
import './PlayersRail.css';

import { publicDevCardCount } from '@skervik/core';

import { useTranslation } from '../i18n/index.js';
import { flotillaForPlayer } from '../theme/flotillaColors.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { PlayerCard } from './components/PlayerCard.js';
import { FLOTILLA_KEY } from './flotillaLabels.js';
import { handSize, myHiddenVictoryPointCards, publicRenown } from './renown.js';
import { selectIsMyTurn, selectSeatOrder, useUiStore } from './store.js';

export function PlayersRail() {
  const { t } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const connectionStatus = useUiStore((state) => state.connectionStatus);
  const versionMismatch = useUiStore((state) => state.versionMismatch);

  const seatOrder = selectSeatOrder(gameState);
  const isMyTurn = selectIsMyTurn(gameState, myPlayerId);

  return (
    <div className="players-rail">
      <p className="players-rail__live" aria-live="polite">
        {isMyTurn ? t('hud.yourTurn') : t('hud.opponentTurn')}
      </p>
      <ConnectionIndicator status={connectionStatus} versionMismatch={versionMismatch} />
      {seatOrder.map((playerId) => {
        const player = gameState.players.find((p) => p.id === playerId);
        if (!player) return null;

        const flotilla = flotillaForPlayer(playerId, seatOrder);
        if (!flotilla) return null;
        const colorCss = `#${flotilla.color.toString(16).padStart(6, '0')}`;

        const isMe = playerId === myPlayerId;
        const renownValue =
          publicRenown(gameState, playerId) +
          (isMe ? myHiddenVictoryPointCards(gameState, myPlayerId) : 0);

        const ventures = publicDevCardCount(
          gameState.devCards?.[playerId] ?? { held: {}, boughtThisTurn: {} },
        );
        const knights = gameState.knightsPlayed?.[playerId] ?? 0;

        return (
          <PlayerCard
            key={playerId}
            flotillaId={flotilla.id}
            colorCss={colorCss}
            flotillaLabel={t(FLOTILLA_KEY[flotilla.id])}
            renownValue={renownValue}
            renownLabel={t('hud.renownLabel')}
            handSizeLabel={t('hud.resourceCards', { count: handSize(player.resources) })}
            venturesLabel={t('hud.ventures', { count: ventures })}
            knightsLabel={t('hud.knightsPlayed', { count: knights })}
            hasLongestRoad={gameState.longestRoadHolder === playerId}
            longestRoadLabel={t('hud.awardLongestRoad')}
            hasLargestArmy={gameState.largestArmyHolder === playerId}
            largestArmyLabel={t('hud.awardLargestArmy')}
            isCurrentPlayer={gameState.currentPlayerId === playerId}
            connectionLabel={t('hud.connectionOnline')}
          />
        );
      })}
    </div>
  );
}
