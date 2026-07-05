// TimerDisplay — DESIGN.md §8/§11: turn timer, tabular Ledger mono. This
// story only ever renders `state="idle"` (no live countdown until S1.6.5) —
// `normal`/`warning`/`critical` are defined now so the primitive is already
// the SAME one S1.6.5's live countdown reuses, per §8's state vocabulary
// (normal --muted, warning --primary, critical --danger + gentle pulse).
import './components.css';

export type TimerState = 'idle' | 'normal' | 'warning' | 'critical';

export interface TimerDisplayProps {
  readonly label: string;
  /** Pre-formatted mm:ss (or an idle placeholder like "--:--") — formatting is the caller's job. */
  readonly value: string;
  readonly state?: TimerState;
}

export function TimerDisplay({ label, value, state = 'idle' }: TimerDisplayProps) {
  const stateClass =
    state === 'idle' || state === 'normal' ? '' : ` timer-display--${state}`;
  return (
    <span className={`timer-display${stateClass}`} aria-label={`${label}: ${value}`}>
      {value}
    </span>
  );
}
