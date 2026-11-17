// Commission engine. All money is integer PKR (no floats), percentages are carried as basis points (1% = 100 bps).
// Rules:
//  - commission comes only from the FINALISED deal terms (agreed price + agreement); changing defaults never touches old deals;
//  - shares must add up exactly (percentage shares = 10,000 bps, fixed shares = total);
//  - a finalised agreement is a frozen snapshot, persisted in an append-only table;
//  - payouts can never exceed a participant's share; commission income is separate from customer funds.
import { assertDomain } from './errors';

export type CommissionSide = 'buyer' | 'seller';
export type CommissionTerms = { type: 'fixed'; amount: number } | { type: 'percent'; bps: number };

export const percentToBps = (percent: number) => Math.round(percent * 100);

export function computeCommission(terms: CommissionTerms, agreedPrice: number): number {
  assertDomain(Number.isInteger(agreedPrice) && agreedPrice >= 0, 'price', 'Agreed price must be a whole number of rupees');
  if (terms.type === 'fixed') {
    assertDomain(Number.isInteger(terms.amount) && terms.amount >= 0, 'commission_amount', 'Fixed commission must be a whole number of rupees');
    return terms.amount;
  }
  assertDomain(Number.isInteger(terms.bps) && terms.bps >= 0 && terms.bps <= 10000, 'commission_percent', 'Commission percentage must be between 0 and 100');
  return Math.floor((agreedPrice * terms.bps + 5000) / 10000); // round half up
}

export type SideTerms = Partial<Record<CommissionSide, CommissionTerms>>;
export function computeDealCommission(agreedPrice: number, sides: SideTerms): { buyer: number; seller: number; total: number } {
  const buyer = sides.buyer ? computeCommission(sides.buyer, agreedPrice) : 0;
  const seller = sides.seller ? computeCommission(sides.seller, agreedPrice) : 0;
  return { buyer, seller, total: buyer + seller };
}

export interface ShareInput { personId: number; role: string; shareBps?: number; fixedAmount?: number }
export interface ShareResult { personId: number; role: string; amount: number; shareBps: number | null }

/** Split `total` between participants. Percentage shares use largest-remainder so the parts always add up exactly. */
export function splitCommission(total: number, participants: ShareInput[]): ShareResult[] {
  assertDomain(Number.isInteger(total) && total >= 0, 'commission_total', 'Commission total must be a whole number of rupees');
  assertDomain(participants.length > 0, 'no_participants', 'At least one participant is required');
  const ids = new Set<number>();
  for (const p of participants) { assertDomain(!ids.has(p.personId), 'participant_duplicate', 'A participant is listed twice'); ids.add(p.personId); }
  const pct = participants.filter((p) => p.shareBps !== undefined), fix = participants.filter((p) => p.fixedAmount !== undefined);
  assertDomain(pct.length + fix.length === participants.length && (pct.length === 0 || fix.length === 0), 'share_mixed', 'Use either percentage shares or fixed amounts for all participants, not both');

  if (fix.length) {
    let sum = 0;
    for (const p of fix) { assertDomain(Number.isInteger(p.fixedAmount!) && p.fixedAmount! >= 0, 'share_amount', 'Fixed share must be a whole number of rupees'); sum += p.fixedAmount!; }
    assertDomain(sum === total, 'share_sum', `Fixed shares add up to ${sum}, but the commission is ${total}`);
    return participants.map((p) => ({ personId: p.personId, role: p.role, amount: p.fixedAmount!, shareBps: null }));
  }
  let bps = 0;
  for (const p of pct) { assertDomain(Number.isInteger(p.shareBps!) && p.shareBps! >= 0, 'share_bps', 'Share must be a valid percentage'); bps += p.shareBps!; }
  assertDomain(bps === 10000, 'share_sum', `Shares add up to ${bps / 100}%, not 100%`);
  const raw = pct.map((p) => (total * p.shareBps!) / 10000);
  const floor = raw.map(Math.floor);
  let left = total - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (left <= 0) break; floor[o.i]++; left--; }
  return pct.map((p, i) => ({ personId: p.personId, role: p.role, amount: floor[i], shareBps: p.shareBps! }));
}

export interface AgreementSnapshot {
  version: 1; dealId: number; agreedPrice: number; finalizedAt: string;
  sides: { side: CommissionSide; terms: CommissionTerms; amount: number }[];
  total: number;
  shares: ShareResult[];
}

function deepFreeze<T>(o: T): T { if (o && typeof o === 'object') { Object.values(o as any).forEach(deepFreeze); Object.freeze(o); } return o; }

export function finalizeAgreement(a: { dealId: number; agreedPrice: number; sides: SideTerms; participants: ShareInput[]; now?: Date }): AgreementSnapshot {
  const c = computeDealCommission(a.agreedPrice, a.sides);
  const sides = (['buyer', 'seller'] as CommissionSide[]).filter((s) => a.sides[s]).map((s) => ({ side: s, terms: a.sides[s]!, amount: s === 'buyer' ? c.buyer : c.seller }));
  assertDomain(sides.length > 0, 'no_terms', 'Set commission terms for at least one side');
  return deepFreeze({
    version: 1 as const, dealId: a.dealId, agreedPrice: a.agreedPrice, finalizedAt: (a.now ?? new Date()).toISOString(),
    sides, total: c.total, shares: splitCommission(c.total, a.participants),
  });
}

export interface PayoutInput { personId: number; amount: number }
export interface SettlementLine { personId: number; role: string; payable: number; paid: number; remaining: number }

/** `paid` is the net commission already paid to each participant (payments minus reversals). */
export function settlementStatus(shares: ShareResult[], paid: PayoutInput[]): SettlementLine[] {
  return shares.map((s) => {
    const p = paid.filter((x) => x.personId === s.personId).reduce((a, b) => a + b.amount, 0);
    return { personId: s.personId, role: s.role, payable: s.amount, paid: p, remaining: s.amount - p };
  });
}

export function assertPayoutAllowed(line: SettlementLine, amount: number): void {
  assertDomain(Number.isInteger(amount) && amount > 0, 'payout_amount', 'Payout must be a positive whole number of rupees');
  assertDomain(amount <= line.remaining, 'payout_exceeds', `Payout of ${amount} exceeds the remaining commission of ${line.remaining}`);
}
