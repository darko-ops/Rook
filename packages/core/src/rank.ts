/**
 * Rank ladder (§14): percentile-based, Grandmaster is top percentile —
 * never a fixed score threshold. Provisional badge until enough windows.
 */
export type Rank =
  | 'Rookie'
  | 'Club Player'
  | 'Candidate'
  | 'Expert'
  | 'Master'
  | 'Grandmaster';

export function rankFor(percentile: number): Rank {
  // percentile = fraction of field at or below this user (1 = top)
  if (percentile >= 0.98) return 'Grandmaster';
  if (percentile >= 0.9) return 'Master';
  if (percentile >= 0.75) return 'Expert';
  if (percentile >= 0.5) return 'Candidate';
  if (percentile >= 0.2) return 'Club Player';
  return 'Rookie';
}

export function isProvisional(windowsPlayed: number, provisionalWindows: number): boolean {
  return windowsPlayed < provisionalWindows;
}
