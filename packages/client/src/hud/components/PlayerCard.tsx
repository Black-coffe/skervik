// PlayerCard — DESIGN.md §11/§6 players-rail card: flotilla emblem+color,
// public Renown, hand size, ventures, awards, current-player kerosene edge.
// Purely presentational — every string arrives already localized from
// `PlayersRail.tsx` (which owns `useTranslation()`), so this component has
// no i18n dependency of its own and stays trivially testable.
import './components.css';

import type { FlotillaId } from '../../theme/flotillaColors.js';
import { FlotillaEmblem } from '../flotillaEmblems.js';
import { Pill } from './Pill.js';

export interface PlayerCardProps {
  readonly flotillaId: FlotillaId;
  readonly colorCss: string;
  readonly flotillaLabel: string;
  readonly renownValue: number;
  readonly renownLabel: string;
  readonly handSizeLabel: string;
  readonly venturesLabel: string;
  readonly knightsLabel: string;
  readonly hasLongestRoad: boolean;
  readonly longestRoadLabel: string;
  readonly hasLargestArmy: boolean;
  readonly largestArmyLabel: string;
  readonly isCurrentPlayer: boolean;
  readonly connectionLabel: string;
}

export function PlayerCard({
  flotillaId,
  colorCss,
  flotillaLabel,
  renownValue,
  renownLabel,
  handSizeLabel,
  venturesLabel,
  knightsLabel,
  hasLongestRoad,
  longestRoadLabel,
  hasLargestArmy,
  largestArmyLabel,
  isCurrentPlayer,
  connectionLabel,
}: PlayerCardProps) {
  return (
    <div
      className={['player-card', isCurrentPlayer ? 'player-card--current' : '']
        .filter(Boolean)
        .join(' ')}
      data-flotilla={flotillaId}
    >
      <div className="player-card__header">
        <FlotillaEmblem flotillaId={flotillaId} color={colorCss} />
        <span className="player-card__name">{flotillaLabel}</span>
        <Pill variant="count" aria-label={`${renownLabel}: ${renownValue}`}>
          {renownValue}
        </Pill>
      </div>
      <div className="player-card__stats">
        <Pill variant="count">{handSizeLabel}</Pill>
        <Pill variant="count">{venturesLabel}</Pill>
        <Pill variant="count">{knightsLabel}</Pill>
        {hasLongestRoad && <Pill variant="count">{longestRoadLabel}</Pill>}
        {hasLargestArmy && <Pill variant="count">{largestArmyLabel}</Pill>}
      </div>
      <span className="player-card__connection">{connectionLabel}</span>
    </div>
  );
}
