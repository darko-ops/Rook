export type Side = 'buy' | 'sell';
export type Actor = 'user' | 'house';

export type MagnitudeClass = 'small' | 'medium' | 'large';

export interface NewsEvent {
  id: string;
  ts: number; // tick index (engine is unit-agnostic; sim uses hours)
  assetId: string;
  sign: 1 | -1;
  magnitude: MagnitudeClass;
}

export interface AssetState {
  id: string;
  supply: number; // circulating supply bought from the curve
  reserve: number; // cash held by the curve; closed-loop by construction
}

export interface TradeResult {
  qty: number;
  cashDelta: number; // negative for buys (cash out), positive for sells
  priceBefore: number;
  priceAfter: number;
}

export interface Trade extends TradeResult {
  assetId: string;
  actor: Actor;
  actorId: string;
  side: Side;
  ts: number;
}

export interface MoverDecision {
  execute: boolean;
  qty: number;
  notional: number;
  delta: number; // δ(a) at decision time
  reason:
    | 'ok'
    | 'zero-delta'
    | 'rate-limited'
    | 'cap-limited'
    | 'budget-exhausted';
}
