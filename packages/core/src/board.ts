// @skervik/core — hex board topology model (S1.1.1). A pure, serializable
// geometric foundation for the radius-2 board (19 tiles, 54 vertices, 72
// edges): canonical IDs + embedded adjacency for tiles/vertices/edges, plus
// the 9 fixed coastal port-slot positions. ADR-0003: pure data + pure
// functions only, zero runtime deps, no classes/Map/Set in exported shapes.
//
// `BoardTopology` is computed on demand (memoizable by the caller) — it is
// NOT wired into `GameState` here; board *state* (tokens, buildings, robber)
// lands in S1.1.2/S1.1.3.

/** Axial hex coordinate (see redblobgames.com/grids/hexagons — Axial coordinates). */
export interface AxialCoord {
  readonly q: number;
  readonly r: number;
}

/** Canonical tile id: `"q,r"`. */
export type TileId = string;

/**
 * Canonical vertex id: the 3 hex coords that meet at this corner (each
 * rendered `"q,r"`), sorted lexicographically and joined with `|`. A coastal
 * vertex still has 3 defining coords — some are simply off-board (not present
 * in `BoardTopology.tiles`), which is why `adjacentTileIds` can be < 3.
 */
export type VertexId = string;

/** Canonical edge id: its 2 endpoint {@link VertexId}s, sorted and joined with `::`. */
export type EdgeId = string;

/** One tile: its coord and the 6 vertex/edge ids around it (fixed corner order, see {@link AXIAL_DIRECTIONS}). */
export interface TileTopology {
  readonly id: TileId;
  readonly coord: AxialCoord;
  readonly vertexIds: readonly VertexId[];
  readonly edgeIds: readonly EdgeId[];
}

/** One vertex (corner where 3 hexes meet) with its embedded adjacency. */
export interface VertexTopology {
  readonly id: VertexId;
  /** The 3 defining hex coords, sorted by {@link TileId} (some possibly off-board). */
  readonly tileCoords: readonly AxialCoord[];
  /** On-board subset of `tileCoords` — the real neighboring tiles (≤ 3). */
  readonly adjacentTileIds: readonly TileId[];
  /** The other endpoint of each incident edge (≤ 3, interior vertices have 3, coastal 2). */
  readonly adjacentVertexIds: readonly VertexId[];
  readonly edgeIds: readonly EdgeId[];
}

/** One edge, identified by its 2 (sorted) endpoint vertices. */
export interface EdgeTopology {
  readonly id: EdgeId;
  readonly vertexIds: readonly [VertexId, VertexId];
}

/**
 * A fixed coastal port position. `index` is the port's clockwise position
 * (0..8) around the coast — stable across builds, used by S1.1.2 to assign
 * port *contents* (3:1 vs a specific 2:1 resource) deterministically.
 */
export interface PortSlot {
  readonly edgeId: EdgeId;
  readonly index: number;
}

/** The full computed board geometry. Not part of `GameState` (see file header). */
export interface BoardTopology {
  readonly tiles: readonly TileTopology[];
  readonly vertices: readonly VertexTopology[];
  readonly edges: readonly EdgeTopology[];
  readonly portSlots: readonly PortSlot[];
}

/**
 * Default board radius in rings around the center tile — 2 rings = 19 tiles
 * (the Classic profile board). `buildTopology` takes `radius` as a parameter
 * (ADR-0013): radius 3 = 37 tiles (the expanded 5–6 player board). The default
 * keeps every existing no-arg caller byte-identical at radius 2.
 */
const DEFAULT_RADIUS = 2;

/** Default coastal port-slot count (the Classic 9-port layout). */
const DEFAULT_PORT_SLOT_COUNT = 9;

/**
 * The 6 axial neighbor direction vectors, in a fixed rotational order.
 * Consecutive entries are themselves mutual neighbors (their difference is
 * also one of these 6 vectors) — the vertex-building loop in
 * `buildTopology` relies on that to turn each `{dir[i], dir[i+1]}` pair into
 * a valid 3-mutually-adjacent-hex corner triad.
 */
const AXIAL_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function addAxial(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Canonical `TileId` for an axial coord. Exported: callers building intents/queries key off it. */
export function tileId(coord: AxialCoord): TileId {
  return `${coord.q},${coord.r}`;
}

function sortedJoin(parts: readonly string[], separator: string): string {
  return [...parts].sort().join(separator);
}

/** Canonical, order-independent vertex id from its 3 defining hex coords. */
function makeVertexId(coords: readonly [AxialCoord, AxialCoord, AxialCoord]): VertexId {
  return sortedJoin(coords.map(tileId), '|');
}

/** Canonical, order-independent edge id from its 2 endpoint vertex ids. */
function makeEdgeId(vertexIds: readonly [VertexId, VertexId]): EdgeId {
  return sortedJoin(vertexIds, '::');
}

/**
 * Enumerates the radius-`radius` hexagon's tile coords in a fixed deterministic
 * ring-spiral order: the center tile, then ring 1 (6 tiles), then ring 2 (12
 * tiles), … up to `radius` — each ring walked starting `ring` steps along
 * `AXIAL_DIRECTIONS[4]` and stepping through the 6 directions in order (the
 * standard hex-ring walk, see redblobgames.com/grids/hexagons/#rings). Same
 * order on every call — nothing here iterates a `Set`/`Map`, so there is no
 * ambient ordering risk. `radius` 2 = 19 tiles (Classic), 3 = 37 (expanded).
 */
function enumerateTileCoords(radius: number): AxialCoord[] {
  const coords: AxialCoord[] = [{ q: 0, r: 0 }];
  for (let ring = 1; ring <= radius; ring++) {
    const start = AXIAL_DIRECTIONS[4] as AxialCoord;
    let hex: AxialCoord = { q: start.q * ring, r: start.r * ring };
    for (let side = 0; side < 6; side++) {
      const direction = AXIAL_DIRECTIONS[side] as AxialCoord;
      for (let step = 0; step < ring; step++) {
        coords.push(hex);
        hex = addAxial(hex, direction);
      }
    }
  }
  return coords;
}

/** Sorts 3 hex coords by their `TileId` — the canonical order backing `makeVertexId`. */
function sortTileCoords(
  coords: readonly [AxialCoord, AxialCoord, AxialCoord],
): [AxialCoord, AxialCoord, AxialCoord] {
  return [...coords].sort((a, b) =>
    tileId(a) < tileId(b) ? -1 : tileId(a) > tileId(b) ? 1 : 0,
  ) as [AxialCoord, AxialCoord, AxialCoord];
}

/**
 * Builds the full {@link BoardTopology} for a hexagon of `radius` rings with
 * `portSlotCount` coastal port slots (ADR-0013). Pure and deterministic —
 * calling it twice with the same args yields deep-equal results (no object
 * identity or iteration-order dependence anywhere in the construction).
 * Callers should memoize the result (see {@link topologyForRadius}); it never
 * changes. `buildTopology(2, 9)` is byte-identical to the pre-parameterisation
 * radius-2/9-port Classic topology — every existing no-arg caller is unaffected.
 */
export function buildTopology(
  radius: number = DEFAULT_RADIUS,
  portSlotCount: number = DEFAULT_PORT_SLOT_COUNT,
): BoardTopology {
  const tileCoords = enumerateTileCoords(radius);
  const onBoardTileIds = tileCoords.map(tileId);

  // ---- Vertices: each tile's 6 corners are the triples {tile, tile+dir[i],
  // tile+dir[i+1]} for i in 0..5 (see AXIAL_DIRECTIONS docstring). Corner ids
  // are deduped as they're discovered while walking tiles in the spiral
  // order above, so first-discovery order is deterministic too.
  const vertexRecords: {
    id: VertexId;
    tileCoords: [AxialCoord, AxialCoord, AxialCoord];
  }[] = [];
  const tileCornerIds: VertexId[][] = [];

  for (const coord of tileCoords) {
    const cornerIds: VertexId[] = [];
    for (let i = 0; i < 6; i++) {
      const dirA = AXIAL_DIRECTIONS[i] as AxialCoord;
      const dirB = AXIAL_DIRECTIONS[(i + 1) % 6] as AxialCoord;
      const triad = sortTileCoords([coord, addAxial(coord, dirA), addAxial(coord, dirB)]);
      const id = makeVertexId(triad);
      cornerIds.push(id);
      if (!vertexRecords.some((v) => v.id === id)) {
        vertexRecords.push({ id, tileCoords: triad });
      }
    }
    tileCornerIds.push(cornerIds);
  }

  // ---- Edges: for tile T, edge i connects corner i and corner (i+1)%6 —
  // those two corners share exactly 2 of their 3 defining coords (T and
  // T+dir[i+1]), i.e. this is the edge of T facing neighbor T+dir[i+1].
  const edgeRecords: { id: EdgeId; vertexIds: [VertexId, VertexId] }[] = [];
  const tileEdgeIds: EdgeId[][] = [];

  tileCoords.forEach((_coord, tileIndex) => {
    const cornerIds = tileCornerIds[tileIndex] as VertexId[];
    const edgeIds: EdgeId[] = [];
    for (let i = 0; i < 6; i++) {
      const vA = cornerIds[i] as VertexId;
      const vB = cornerIds[(i + 1) % 6] as VertexId;
      const pair: [VertexId, VertexId] = vA < vB ? [vA, vB] : [vB, vA];
      const id = makeEdgeId(pair);
      edgeIds.push(id);
      if (!edgeRecords.some((e) => e.id === id)) {
        edgeRecords.push({ id, vertexIds: pair });
      }
    }
    tileEdgeIds.push(edgeIds);
  });

  const tiles: TileTopology[] = tileCoords.map((coord, i) => ({
    id: tileId(coord),
    coord,
    vertexIds: tileCornerIds[i] as VertexId[],
    edgeIds: tileEdgeIds[i] as EdgeId[],
  }));

  const edges: EdgeTopology[] = edgeRecords.map(({ id, vertexIds }) => ({
    id,
    vertexIds,
  }));

  const vertices: VertexTopology[] = vertexRecords.map(({ id, tileCoords: triad }) => {
    const adjacentTileIds = triad
      .map(tileId)
      .filter((tid) => onBoardTileIds.includes(tid));
    const incidentEdges = edges.filter((e) => e.vertexIds.includes(id));
    return {
      id,
      tileCoords: triad,
      adjacentTileIds,
      adjacentVertexIds: incidentEdges.map((e) =>
        e.vertexIds[0] === id ? e.vertexIds[1] : e.vertexIds[0],
      ),
      edgeIds: incidentEdges.map((e) => e.id),
    };
  });

  // ---- Port slots: the coastal (boundary) edges are those bordering
  // exactly 1 on-board tile. Only ring-2 tiles have any (ring 0/1 are fully
  // interior), so walking `tiles` in the spiral order and each tile's edges
  // in direction order visits the coastline in one deterministic cycle —
  // that cycle is what "evenly spaced around the coast" is computed against
  // below. Port *contents* (3:1 vs a specific 2:1) are an S1.1.2 concern.
  const boundaryEdgeIds: EdgeId[] = [];
  for (const tile of tiles) {
    for (const edgeId of tile.edgeIds) {
      if (boundaryEdgeIds.includes(edgeId)) continue;
      const incidentTileCount = tiles.filter((t) => t.edgeIds.includes(edgeId)).length;
      if (incidentTileCount === 1) boundaryEdgeIds.push(edgeId);
    }
  }

  const portSlots: PortSlot[] = Array.from({ length: portSlotCount }, (_, index) => {
    const boundaryIndex = Math.floor((index * boundaryEdgeIds.length) / portSlotCount);
    return { edgeId: boundaryEdgeIds[boundaryIndex] as EdgeId, index };
  });

  return { tiles, vertices, edges, portSlots };
}

/**
 * Per-radius {@link BoardTopology} cache (ADR-0013 invariant 2). `buildTopology`
 * is pure and its result never changes for a given `(radius, portSlotCount)`, so
 * each distinct board size is built at most once per process — a pure `Map`
 * cache, no wall-clock, no ambient state. This replaces the former
 * `validate.ts` single-topology singleton so the engine can follow a match's
 * profile (radius 2 for Classic, 3 for the expanded 5–6 player board).
 *
 * `portSlotCount` is ALWAYS the active profile's `board.ports.length` — the one
 * source of truth (never a second constant). The registry maps each radius to
 * exactly one board, so keying the cache by `radius` alone is unambiguous.
 */
const topologyByRadius = new Map<number, BoardTopology>();

export function topologyForRadius(radius: number, portSlotCount: number): BoardTopology {
  let topo = topologyByRadius.get(radius);
  if (topo === undefined) {
    topo = buildTopology(radius, portSlotCount);
    topologyByRadius.set(radius, topo);
  }
  return topo;
}

/** Finds a tile by id in an already-built topology. Pure lookup, no caching. */
export function findTile(topology: BoardTopology, id: TileId): TileTopology | undefined {
  return topology.tiles.find((tile) => tile.id === id);
}

/** Finds a vertex by id in an already-built topology. Pure lookup, no caching. */
export function findVertex(
  topology: BoardTopology,
  id: VertexId,
): VertexTopology | undefined {
  return topology.vertices.find((vertex) => vertex.id === id);
}

/** Finds an edge by id in an already-built topology. Pure lookup, no caching. */
export function findEdge(topology: BoardTopology, id: EdgeId): EdgeTopology | undefined {
  return topology.edges.find((edge) => edge.id === id);
}
