// Pill — DESIGN.md §11/§4: resource / count / timer variants, 999px radius.
// Non-interactive badge (no click states this story); `tone` covers the
// meaningful "state" a Pill can carry — a timer nearing its limit (§8) —
// default/warning/critical. Icon-first layout (§6: colorblind read).
import './components.css';

import type { ReactNode } from 'react';

export type PillVariant = 'resource' | 'count' | 'timer';
export type PillTone = 'default' | 'warning' | 'critical';

export interface PillProps {
  readonly variant?: PillVariant;
  readonly tone?: PillTone;
  /** A resource icon glyph or swatch — rendered before the label (icon-first, §6). */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly 'aria-label'?: string;
}

export function Pill({
  variant = 'count',
  tone = 'default',
  icon,
  children,
  ...rest
}: PillProps) {
  const toneClass = tone !== 'default' ? ` pill--${tone}` : '';
  return (
    <span className={`pill pill--${variant}${toneClass}`} {...rest}>
      {icon ? (
        <span className="pill__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
