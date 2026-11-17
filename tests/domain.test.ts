import assert from 'node:assert/strict';
import { convertArea, formatArea, fromSqft, sqftPerUnit, toSqft } from '../src/domain/units';
import { transitionAvailability, canMoveListing, AvailabilityContext } from '../src/domain/availability';
import { isCurrent, planOwnershipTransfer, validateOwnerSet } from '../src/domain/ownership';
import { assertPayoutAllowed, computeCommission, computeDealCommission, finalizeAgreement, percentToBps, settlementStatus, splitCommission } from '../src/domain/commission';
import { addMonths, buildInstallments, dealBalance, installmentStatus, validateRefund, validateReversal } from '../src/domain/finance';
import { DomainError } from '../src/domain/errors';

const throwsCode = (fn: () => any, code: string) => assert.throws(fn, (e: any) => e instanceof DomainError && e.code === code, `expected DomainError ${code}`);

// ---------- units: Marla/Kanal depend on the basis, never guessed ----------
assert.equal(toSqft(10, 'marla', 'revenue'), 2722.5);
assert.equal(toSqft(10, 'marla', 'society'), 2250);
assert.equal(sqftPerUnit('kanal', 'society'), 4500);
assert.equal(sqftPerUnit('kanal', 'revenue'), 5445);
assert.equal(toSqft(8, 'kanal', 'revenue'), toSqft(1, 'acre'), '8 kanal (revenue) = 1 acre');
assert.notEqual(toSqft(8, 'kanal', 'society'), toSqft(1, 'acre'), 'society kanals are smaller than revenue kanals');
assert.equal(toSqft(1, 'sqyd'), 9);
assert.equal(convertArea(1, 'kanal', 'marla', 'society'), 20);
assert.equal(convertArea(1, 'kanal', 'marla', 'revenue'), 20);
assert.equal(convertArea(225, 'sqft', 'marla', 'society'), 1);
assert.equal(fromSqft(2722.5, 'marla', 'revenue'), 10);
assert.equal(formatArea(25, 'marla'), '1 Kanal 5 Marla');
assert.equal(formatArea(20, 'marla'), '1 Kanal');
assert.equal(formatArea(7, 'marla'), '7 Marla');
assert.equal(formatArea(2400, 'sqft'), '2,400 Sq Ft');
throwsCode(() => toSqft(0, 'marla'), 'area');
throwsCode(() => toSqft(-3, 'sqft'), 'area');
throwsCode(() => toSqft(5, 'bigha' as any), 'unit');
throwsCode(() => toSqft(5, 'marla', 'lahore' as any), 'basis');

// ---------- availability ----------
const ctx = (o: Partial<AvailabilityContext> = {}): AvailabilityContext => ({ current: 'available', reservedByDealId: null, activeDealIds: [], propertyTransaction: 'sale', ...o });
const to = (r: any) => (r.ok ? r.to : r.code);
assert.equal(to(transitionAvailability(ctx(), { type: 'start_negotiation', dealId: 1 })), 'under_negotiation');
// buyer interest never reserves; reservation needs explicit confirmation
assert.equal(to(transitionAvailability(ctx(), { type: 'reserve', dealId: 1, confirmed: false })), 'confirmation_required');
assert.equal(to(transitionAvailability(ctx(), { type: 'reserve', dealId: 1, confirmed: true })), 'reserved');
// second buyer cannot take a reserved property; negotiating on it warns and keeps the reservation
const reserved = ctx({ current: 'reserved', reservedByDealId: 1, activeDealIds: [1, 2] });
assert.equal(to(transitionAvailability(reserved, { type: 'reserve', dealId: 2, confirmed: true })), 'reserved_by_other_deal');
const neg2 = transitionAvailability(reserved, { type: 'start_negotiation', dealId: 2 });
assert.ok(neg2.ok && neg2.to === 'reserved' && neg2.warnings.length === 1);
assert.equal(to(transitionAvailability(reserved, { type: 'complete_deal', dealId: 2, dealType: 'sale' })), 'reserved_by_other_deal');
const done = transitionAvailability(reserved, { type: 'complete_deal', dealId: 1, dealType: 'sale' });
assert.ok(done.ok && done.to === 'sold' && done.warnings.length === 1, 'other open deals produce a warning');
// completed transactions conflict with everything else
const sold = ctx({ current: 'sold' });
for (const a of [{ type: 'start_negotiation', dealId: 3 }, { type: 'reserve', dealId: 3, confirmed: true }, { type: 'complete_deal', dealId: 3, dealType: 'sale' }] as const)
  assert.equal(to(transitionAvailability(sold, a as any)), 'already_closed');
assert.equal(to(transitionAvailability(ctx(), { type: 'complete_deal', dealId: 1, dealType: 'rent' })), 'transaction_mismatch');
assert.equal(to(transitionAvailability(ctx({ propertyTransaction: 'rent' }), { type: 'complete_deal', dealId: 1, dealType: 'rent' })), 'rented');
// cancelling
assert.equal(to(transitionAvailability(reserved, { type: 'cancel_deal', dealId: 1, otherActiveDealIds: [2] })), 'under_negotiation');
assert.equal(to(transitionAvailability(reserved, { type: 'cancel_deal', dealId: 1, otherActiveDealIds: [] })), 'available');
const keep = transitionAvailability(reserved, { type: 'cancel_deal', dealId: 2, otherActiveDealIds: [1] });
assert.ok(keep.ok && keep.to === 'reserved' && keep.reservedByDealId === 1, "cancelling another deal never drops the reservation");
assert.equal(to(transitionAvailability(sold, { type: 'cancel_deal', dealId: 1, otherActiveDealIds: [] })), 'reopen_required');
assert.equal(to(transitionAvailability(sold, { type: 'reopen', confirmed: false })), 'confirmation_required');
assert.equal(to(transitionAvailability(sold, { type: 'reopen', confirmed: true })), 'available');
assert.equal(to(transitionAvailability(ctx(), { type: 'reopen', confirmed: true })), 'not_closed');
// hold / release
assert.equal(to(transitionAvailability(ctx(), { type: 'hold' })), 'on_hold');
assert.equal(to(transitionAvailability(ctx({ current: 'under_negotiation' }), { type: 'hold' })), 'hold_not_available');
assert.equal(to(transitionAvailability(ctx({ current: 'on_hold' }), { type: 'start_negotiation', dealId: 1 })), 'on_hold');
assert.equal(to(transitionAvailability(ctx({ current: 'on_hold' }), { type: 'release' })), 'available');
// listing status is its own state machine
assert.ok(canMoveListing('draft', 'active') && canMoveListing('expired', 'active') && !canMoveListing('closed', 'active') && !canMoveListing('withdrawn', 'active'));

// ---------- ownership ----------
validateOwnerSet([{ personId: 1, percentage: 60 }, { personId: 2, percentage: 40 }]);
validateOwnerSet([{ personId: 1, percentage: 33.33 }, { personId: 2, percentage: 33.33 }, { personId: 3, percentage: 33.34 }]);
throwsCode(() => validateOwnerSet([{ personId: 1, percentage: 60 }, { personId: 2, percentage: 30 }]), 'owner_sum');
throwsCode(() => validateOwnerSet([{ personId: 1, percentage: 50 }, { personId: 1, percentage: 50 }]), 'owner_duplicate');
throwsCode(() => validateOwnerSet([{ personId: 1, percentage: 0 }, { personId: 2, percentage: 100 }]), 'owner_percentage');
throwsCode(() => validateOwnerSet([]), 'owners_empty');
const plan = planOwnershipTransfer([{ id: 5, personId: 1, percentage: 100, startDate: '2024-01-01', endDate: null }], [{ personId: 9, percentage: 100 }], '2026-03-01');
assert.deepEqual(plan.closeIds, [5]); assert.equal(plan.endDate, '2026-03-01');
throwsCode(() => planOwnershipTransfer([{ id: 5, personId: 1, percentage: 100, startDate: '2024-01-01', endDate: null }], [{ personId: 9, percentage: 100 }], '2023-01-01'), 'date_before_start');
assert.ok(isCurrent({ personId: 1, percentage: 100, startDate: '2024-01-01', endDate: null }, '2026-01-01'));
assert.ok(!isCurrent({ personId: 1, percentage: 100, startDate: '2024-01-01', endDate: '2025-01-01' }, '2026-01-01'));

// ---------- commission ----------
assert.equal(computeCommission({ type: 'percent', bps: percentToBps(2) }, 12_500_000), 250_000);
assert.equal(computeCommission({ type: 'percent', bps: percentToBps(1.5) }, 12_500_000), 187_500);
assert.equal(computeCommission({ type: 'percent', bps: 50 }, 999), 5, 'round half up: 4.995 -> 5');
assert.equal(computeCommission({ type: 'fixed', amount: 75_000 }, 9_000_000), 75_000);
assert.deepEqual(computeDealCommission(10_000_000, { buyer: { type: 'percent', bps: 100 }, seller: { type: 'fixed', amount: 50_000 } }), { buyer: 100_000, seller: 50_000, total: 150_000 });
throwsCode(() => computeCommission({ type: 'percent', bps: 10001 }, 1000), 'commission_percent');
throwsCode(() => computeCommission({ type: 'fixed', amount: 10.5 }, 1000), 'commission_amount');
// shares always add up exactly
const sh = splitCommission(100, [{ personId: 1, role: 'a', shareBps: 3333 }, { personId: 2, role: 'b', shareBps: 3333 }, { personId: 3, role: 'c', shareBps: 3334 }]);
assert.equal(sh.reduce((a, x) => a + x.amount, 0), 100);
const half = splitCommission(250_001, [{ personId: 1, role: 'listing', shareBps: 5000 }, { personId: 2, role: 'buyer', shareBps: 5000 }]);
assert.equal(half[0].amount + half[1].amount, 250_001);
assert.deepEqual(splitCommission(150_000, [{ personId: 1, role: 'a', fixedAmount: 100_000 }, { personId: 2, role: 'b', fixedAmount: 50_000 }]).map((x) => x.amount), [100_000, 50_000]);
throwsCode(() => splitCommission(100, [{ personId: 1, role: 'a', shareBps: 6000 }, { personId: 2, role: 'b', shareBps: 3000 }]), 'share_sum');
throwsCode(() => splitCommission(100, [{ personId: 1, role: 'a', fixedAmount: 60 }, { personId: 2, role: 'b', fixedAmount: 30 }]), 'share_sum');
throwsCode(() => splitCommission(100, [{ personId: 1, role: 'a', shareBps: 5000 }, { personId: 2, role: 'b', fixedAmount: 50 }]), 'share_mixed');
throwsCode(() => splitCommission(100, [{ personId: 1, role: 'a', shareBps: 5000 }, { personId: 1, role: 'b', shareBps: 5000 }]), 'participant_duplicate');
// the finalised agreement is a frozen snapshot
const snap = finalizeAgreement({ dealId: 7, agreedPrice: 10_000_000, sides: { seller: { type: 'percent', bps: 200 } }, participants: [{ personId: 1, role: 'listing_dealer', shareBps: 6000 }, { personId: 2, role: 'buyer_dealer', shareBps: 4000 }], now: new Date('2026-11-01T00:00:00Z') });
assert.equal(snap.total, 200_000); assert.deepEqual(snap.shares.map((x) => x.amount), [120_000, 80_000]);
try { (snap as any).total = 1; (snap.shares[0] as any).amount = 1; } catch { /* strict mode throws, sloppy mode ignores */ }
assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.shares) && Object.isFrozen(snap.shares[0]) && Object.isFrozen(snap.sides[0].terms));
assert.equal(snap.total, 200_000); assert.equal(snap.shares[0].amount, 120_000);
throwsCode(() => finalizeAgreement({ dealId: 1, agreedPrice: 100, sides: {}, participants: [{ personId: 1, role: 'a', shareBps: 10000 }] }), 'no_terms');
// settlement: payable / paid / remaining, no overpayment
const st = settlementStatus(snap.shares, [{ personId: 1, amount: 100_000 }]);
assert.deepEqual(st.map((x) => [x.payable, x.paid, x.remaining]), [[120_000, 100_000, 20_000], [80_000, 0, 80_000]]);
assertPayoutAllowed(st[0], 20_000);
throwsCode(() => assertPayoutAllowed(st[0], 20_001), 'payout_exceeds');
throwsCode(() => assertPayoutAllowed(st[0], 0), 'payout_amount');

// ---------- finance ----------
const pay = (id: number, kind: any, amount: number, reversalOf: number | null = null) => ({ id, kind, amount, reversalOf });
let rows = [pay(1, 'token', 500_000), pay(2, 'bayana', 2_000_000), pay(3, 'installment', 1_000_000), pay(4, 'seller_payment', 1_500_000), pay(5, 'commission_received', 200_000)];
let b = dealBalance(10_000_000, rows);
assert.equal(b.collected, 3_500_000); assert.equal(b.outstanding, 6_500_000); assert.equal(b.paidToSeller, 1_500_000); assert.equal(b.commissionReceived, 200_000);
assert.equal(b.heldFromBuyer, 3_500_000, 'commission income and seller pass-through never count as buyer funds');
rows = [...rows, pay(6, 'installment', 1_000_000, 3)]; // reversal of payment 3
b = dealBalance(10_000_000, rows);
assert.equal(b.collected, 2_500_000);
rows = [...rows, pay(7, 'refund', 500_000)];
b = dealBalance(10_000_000, rows); assert.equal(b.refunded, 500_000); assert.equal(b.heldFromBuyer, 2_000_000); assert.equal(b.outstanding, 8_000_000);
assert.equal(dealBalance(1_000_000, [pay(1, 'bayana', 1_200_000)]).overpaid, 200_000);
validateReversal(rows[0], rows);
throwsCode(() => validateReversal(rows[2], rows), 'reversal_duplicate');
throwsCode(() => validateReversal(rows[5], rows), 'reversal_of_reversal');
throwsCode(() => validateReversal(undefined, rows), 'reversal_missing');
validateRefund(2_000_000, 2_000_000);
throwsCode(() => validateRefund(2_000_000, 2_000_001), 'refund_exceeds');
// installments
const sched = buildInstallments(100, 3, '2026-01-31');
assert.deepEqual(sched.map((x) => x.amount), [33, 33, 34]);
assert.deepEqual(sched.map((x) => x.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
assert.equal(addMonths('2028-01-31', 1), '2028-02-29'); assert.equal(addMonths('2026-11-15', 3), '2027-02-15'); assert.equal(addMonths('2026-12-10', 1), '2027-01-10');
assert.equal(buildInstallments(1_000_000, 7, '2026-06-01').reduce((a, x) => a + x.amount, 0), 1_000_000);
const status = installmentStatus(buildInstallments(300, 3, '2026-01-01'), 150, '2026-02-15');
assert.deepEqual(status.map((x) => x.state), ['paid', 'overdue', 'upcoming']);
assert.equal(status[1].applied, 50);
assert.equal(installmentStatus(buildInstallments(300, 3, '2026-03-01'), 150, '2026-01-15')[1].state, 'partial');
throwsCode(() => buildInstallments(100, 0, '2026-01-01'), 'inst_count');
throwsCode(() => buildInstallments(100, 2, '01/01/2026'), 'inst_date');
console.log('domain tests passed');
