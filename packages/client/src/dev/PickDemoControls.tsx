// Dev-only board-picking harness (S2.8.1 manual smoke) — lets a developer
// cycle the board's pick mode and see what a click resolves to, without any
// real game-loop story wiring it yet (that's S2.8.2+). Rendered ONLY under
// `import.meta.env.DEV`, and ONLY while `GameTable` isn't already driven by
// a real `pickMode`/`onPick` prop pair — see `GameTable.tsx`. Never ships.
import './PickDemoControls.css';

import type { Pick, PickMode } from '../board/BoardScene.js';

const MODES: readonly PickMode[] = ['none', 'vertex', 'edge', 'tile'];

export interface PickDemoControlsProps {
  readonly pickMode: PickMode;
  readonly onPickModeChange: (mode: PickMode) => void;
  readonly lastPick: Pick | null;
}

export function PickDemoControls({
  pickMode,
  onPickModeChange,
  lastPick,
}: PickDemoControlsProps) {
  return (
    <div className="pick-demo-controls" aria-label="Board picking demo (dev)">
      <span className="pick-demo-controls__label">dev · pick</span>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={
            mode === pickMode
              ? 'btn btn--primary pick-demo-controls__btn'
              : 'btn btn--quiet pick-demo-controls__btn'
          }
          onClick={() => onPickModeChange(mode)}
        >
          {mode}
        </button>
      ))}
      <span className="pick-demo-controls__last">
        {lastPick === null ? '—' : `${lastPick.kind}:${lastPick.id}`}
      </span>
    </div>
  );
}
