// Placeholder flotilla emblem glyphs (DESIGN.md §2.2 a11y invariant: color
// NEVER appears without the flotilla emblem glyph). Final commissioned
// emblem art (petrel silhouette / orca fin / walrus tusks / narwhal horn /
// moray silhouette / manta silhouette) is a later art-asset story — these
// are simple, DISTINCT geometric shapes so the rail already satisfies "not
// hue-only" today without blocking on art.

import type { FlotillaId } from '../theme/flotillaColors.js';

export interface FlotillaEmblemProps {
  readonly flotillaId: FlotillaId;
  /** CSS color string (e.g. `#4682cc`), NOT the Pixi numeric hex. */
  readonly color: string;
}

export function FlotillaEmblem({ flotillaId, color }: FlotillaEmblemProps) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {flotillaId === 'petrel' && <circle cx="12" cy="12" r="9" fill={color} />}
      {flotillaId === 'orca' && <polygon points="12,3 21,20 3,20" fill={color} />}
      {flotillaId === 'walrus' && (
        <rect x="4" y="4" width="16" height="16" rx="3" fill={color} />
      )}
      {flotillaId === 'narwhal' && (
        <polygon points="12,2 22,12 12,22 2,12" fill={color} />
      )}
      {flotillaId === 'moray' && (
        <path
          d="M4 6 C 4 6 15 2 19 8 C 22 13 9 11 6 15 C 4 18 4 20 4 20"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {flotillaId === 'manta' && (
        <polygon points="12,4 22,13 15,12 12,21 9,12 2,13" fill={color} />
      )}
    </svg>
  );
}
