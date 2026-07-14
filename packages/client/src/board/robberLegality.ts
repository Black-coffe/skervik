// S2.8.4a — pure ADVISORY legality hints for the `robber` phase (moving the
// robber after a rolled 7). Mirrors `validate.ts`'s `resolveRobberMove`
// (`validate.ts:855-909`) WITHOUT calling core `validate` — the client has no
// seed and is never the authority (see the story's Constraints). Consumed only
// to (a) decide whether a tile pick needs a victim choice and (b) list the
// eligible victims for the picker; a click is dispatched as-is regardless of
// membership here — the SERVER remains the sole gate.
//
// `isStealable` (friendly-robber protection) is REUSED from core — a no-op for
// every shipping preset (`friendlyRobber:false`), so for Classic the eligible
// set is simply "building-owner-on-tile, not me, has cards".

import type {
  BoardTopology,
  GameState,
  PlayerId,
  ResourceType,
  TileId,
} from '@skervik/core';
import { findTile, isStealable, loadRuleProfile } from '@skervik/core';

const EMPTY_BUILDINGS: NonNullable<GameState['buildings']> = {
  settlements: {},
  roads: {},
};

/** Sum a hand — mirrors core's private `handSize` (a bare resource-count total). */
function handSize(resources: Readonly<Record<ResourceType, number>>): number {
  return Object.values(resources).reduce((sum, count) => sum + count, 0);
}

/** Stable seat order for the current state — never reorder mid-match (DESIGN.md §6). */
function seatOrder(state: GameState): readonly PlayerId[] {
  return state.playerOrder ?? state.players.map((p) => p.id);
}

/**
 * Every tile the robber may LEGALLY be moved to: all tiles except its current
 * one (`state.board.robberTileId` — a move there is `ROBBER_SAME_TILE`). Used by
 * the prompt/derive; NOT used to highlight (tiles aren't a `setLegalTargets`
 * kind) nor to gate a dispatch (advisory — the SERVER is authoritative).
 */
export function legalRobberTiles(
  state: GameState,
  topology: BoardTopology,
): readonly TileId[] {
  const current = state.board?.robberTileId;
  return topology.tiles.filter((tile) => tile.id !== current).map((tile) => tile.id);
}

/**
 * The eligible steal victims if the robber moves to `tileId`
 * (`validate.ts:865-909`): owners of a settlement OR city on any of the tile's
 * vertices, EXCLUDING the mover, who hold ≥1 card and aren't friendly-robber
 * protected (`isStealable`, a no-op in Classic). Returned in stable seat order
 * so the picker is deterministic. 0 victims ⇒ `moveRobber{tileId}` is a legal
 * no-op steal (no `victimId`).
 */
export function stealVictims(
  state: GameState,
  topology: BoardTopology,
  tileId: TileId,
  myPlayerId: PlayerId,
): readonly PlayerId[] {
  const tile = findTile(topology, tileId);
  if (!tile) return [];
  const buildings = state.buildings ?? EMPTY_BUILDINGS;

  const ownersOnTile = new Set<PlayerId>();
  for (const vertexId of tile.vertexIds) {
    const owner = buildings.cities?.[vertexId] ?? buildings.settlements[vertexId];
    if (owner !== undefined && owner !== myPlayerId) ownersOnTile.add(owner);
  }
  if (ownersOnTile.size === 0) return [];

  const { robber } = loadRuleProfile(state.profileId ?? 'classic');
  return seatOrder(state).filter((id) => {
    if (!ownersOnTile.has(id)) return false;
    const player = state.players.find((p) => p.id === id);
    if (!player || handSize(player.resources) <= 0) return false;
    return isStealable(state, id, robber);
  });
}
