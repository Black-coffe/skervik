// SeedChip — DESIGN.md §8/§11: fairness chip, first 8 chars of `seedHash` in
// Ledger mono. The click-through "Честный жребий" dashboard is a later
// story (§8) — this story ships only the static chip.
import './components.css';

export interface SeedChipProps {
  readonly label: string;
  readonly seedHash: string;
}

export function SeedChip({ label, seedHash }: SeedChipProps) {
  const shortHash = seedHash.slice(0, 8);
  return (
    <span className="seed-chip" aria-label={`${label}: ${shortHash}`}>
      <span>{label}</span>
      <span className="seed-chip__hash">{shortHash}</span>
    </span>
  );
}
