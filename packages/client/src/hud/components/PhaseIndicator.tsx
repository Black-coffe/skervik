// PhaseIndicator — DESIGN.md §11/§6: a small localized badge naming the
// current match phase. Purely presentational; the caller resolves
// `GamePhase` -> a localized label via `t('phase.*')` (see `TopBar.tsx`).
import './components.css';

export interface PhaseIndicatorProps {
  readonly label: string;
}

export function PhaseIndicator({ label }: PhaseIndicatorProps) {
  return <span className="phase-indicator">{label}</span>;
}
