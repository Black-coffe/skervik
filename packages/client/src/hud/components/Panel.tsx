// Panel — DESIGN.md §11: docked, collapsible container (used for the ship's
// log this story). The toggle button ships default/hover/focus/active
// states via native `<button>` semantics; `disabled`/`loading`/`error` are
// not meaningful for a plain collapse toggle.
import './components.css';

import type { ReactNode } from 'react';
import { useState } from 'react';

export interface PanelProps {
  readonly title: string;
  readonly collapseLabel: string;
  readonly expandLabel: string;
  readonly children: ReactNode;
  readonly defaultCollapsed?: boolean;
}

export function Panel({
  title,
  collapseLabel,
  expandLabel,
  children,
  defaultCollapsed = false,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="panel__title">{title}</span>
        <button
          type="button"
          className="panel__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      <div className="panel__body" data-collapsed={collapsed}>
        {children}
      </div>
    </div>
  );
}
