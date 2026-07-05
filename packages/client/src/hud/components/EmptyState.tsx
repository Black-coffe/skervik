// EmptyState — DESIGN.md §8/§11: a teaching empty message (this story: the
// ship's-log placeholder only — real log content is a later story).
import './components.css';

export interface EmptyStateProps {
  readonly message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return <p className="empty-state">{message}</p>;
}
