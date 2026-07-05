// Placeholder resource glyphs (DESIGN.md §2.3 "resources are NEVER
// hue-only" + §5 "filled silhouette glyphs ... must read at 14px" + §6
// "icon first — colorblind read"). Same discipline as `flotillaEmblems.tsx`:
// final commissioned icon art is a later art-asset story, but each of the 5
// Classic resources already needs a shape distinct from the others TODAY,
// not just a color swatch — a color-blind reader (or a screen reader with
// no image) must be able to tell timber from clay from the shape alone.
//
// Lightly evocative placeholders, filled with the resource's §2.3 color:
// timber = a log's round cross-section, clay = a coursed brick, fleece = a
// tuft of wool (overlapping puffs), barley = an ear of grain, iron = a
// cast ingot bar.

import type { ResourceType } from '@skervik/core';

export type ClassicResource = 'timber' | 'clay' | 'fleece' | 'barley' | 'iron';

export interface ResourceGlyphProps {
  readonly resource: ResourceType;
  /** CSS color string (e.g. `var(--res-timber)`). */
  readonly color: string;
}

export function ResourceGlyph({ resource, color }: ResourceGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      {resource === 'timber' && (
        <>
          <circle cx="12" cy="12" r="9" fill={color} />
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="none"
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        </>
      )}
      {resource === 'clay' && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="1.5" fill={color} />
          <line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
          <line x1="9" y1="5" x2="9" y2="12" stroke="var(--surface)" strokeWidth="1.5" />
          <line
            x1="15"
            y1="12"
            x2="15"
            y2="19"
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        </>
      )}
      {resource === 'fleece' && (
        <>
          <circle cx="8" cy="13" r="5.5" fill={color} />
          <circle cx="14" cy="10" r="5.5" fill={color} />
          <circle cx="16" cy="15" r="4.5" fill={color} />
        </>
      )}
      {resource === 'barley' && (
        <g stroke={color} strokeWidth="2.4" strokeLinecap="round" fill="none">
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="12" y1="7" x2="7" y2="5" />
          <line x1="12" y1="7" x2="17" y2="5" />
          <line x1="12" y1="12" x2="7" y2="10" />
          <line x1="12" y1="12" x2="17" y2="10" />
          <line x1="12" y1="17" x2="7" y2="15" />
          <line x1="12" y1="17" x2="17" y2="15" />
        </g>
      )}
      {resource === 'iron' && <polygon points="5,17 7,7 17,7 19,17" fill={color} />}
    </svg>
  );
}
