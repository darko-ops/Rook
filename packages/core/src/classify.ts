import type { MagnitudeClass } from '@rook/engine';

/**
 * Conservative headline classifier for the house mover's coarse input
 * (§13.3: sign + magnitude class only). Rules:
 *
 *  - Tag a team only when exactly one team is mentioned; multi-team
 *    headlines get tagged to the first match with NO sign (display-only).
 *  - Sign only when positive/negative keywords don't conflict.
 *  - When unsure, classify nothing — an unclassified item is still news
 *    for traders; the mover simply never sees it. Under-moving is
 *    recoverable (§13.2).
 *
 * Alias table includes 2026 driver lineups — update on driver moves.
 */
export const TEAM_ALIASES: Record<string, string[]> = {
  RBR: ['red bull', 'verstappen', 'tsunoda'],
  FER: ['ferrari', 'leclerc', 'hamilton'],
  MER: ['mercedes', 'russell', 'antonelli'],
  MCL: ['mclaren', 'norris', 'piastri'],
  AST: ['aston martin', 'alonso', 'stroll'],
  ALP: ['alpine', 'gasly', 'colapinto'],
  WIL: ['williams', 'albon', 'sainz'],
  VRB: ['racing bulls', 'hadjar', 'lawson'],
  AUD: ['audi', 'sauber', 'hulkenberg', 'bortoleto'],
  HAA: ['haas', 'ocon', 'bearman'],
  CAD: ['cadillac', 'perez', 'bottas'],
};

const POSITIVE = [
  'win', 'wins', 'victory', 'pole', 'podium', 'fastest', 'tops', 'dominant',
  'dominates', 'upgrade', 'extends', 'signs', 'secures', 'breakthrough',
  'impressive', 'stuns', 'charges', 'best', 'strong',
];
const NEGATIVE = [
  'crash', 'crashes', 'penalty', 'penalised', 'penalized', 'dnf', 'retires',
  'retirement', 'disqualif', 'exit', 'exits', 'struggle', 'struggles',
  'blow', 'fails', 'failure', 'damage', 'grid drop', 'fine', 'fined',
  'protest', 'investigation', 'quits', 'split', 'worst', 'disaster',
  'disappoint', 'setback', 'concern', 'unreliab', 'reliability',
];
const LARGE = ['win', 'wins', 'victory', 'dnf', 'disqualif', 'crash', 'disaster', 'quits'];
const MEDIUM = ['pole', 'podium', 'penalty', 'penalised', 'penalized', 'retires', 'upgrade', 'signs', 'extends', 'exit', 'exits', 'grid drop'];

export interface Classification {
  symbol: string | null;
  sign: 1 | -1 | null;
  magnitude: MagnitudeClass;
}

export function classifyHeadline(headline: string): Classification {
  const h = headline.toLowerCase();
  const teams = Object.entries(TEAM_ALIASES).filter(([, aliases]) =>
    aliases.some((a) => h.includes(a)),
  );
  if (teams.length === 0) return { symbol: null, sign: null, magnitude: 'small' };
  const symbol = teams[0]![0];

  const words = ` ${h} `;
  const hasPos = POSITIVE.some((k) => words.includes(` ${k}`) || words.includes(`${k} `));
  const hasNeg = NEGATIVE.some((k) => words.includes(` ${k}`) || words.includes(`${k} `));

  let sign: 1 | -1 | null = null;
  if (teams.length === 1 && hasPos !== hasNeg) sign = hasPos ? 1 : -1;

  let magnitude: MagnitudeClass = 'small';
  if (LARGE.some((k) => h.includes(k))) magnitude = 'large';
  else if (MEDIUM.some((k) => h.includes(k))) magnitude = 'medium';

  return { symbol, sign, magnitude };
}
