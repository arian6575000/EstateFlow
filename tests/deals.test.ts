import assert from 'node:assert/strict';
import { createNodeDb } from './nodeDb';
import { initRepo, getDb, Repo } from '../src/db/repo';
import { PropertyRepo } from '../src/db/propertyRepo';
import { DealRepo } from '../src/db/dealRepo';
import { ReportRepo, rangeFor, reportTable, REPORT_LABEL, ReportKind } from '../src/db/reportRepo';
import { tableToCsv, tableToHtml } from '../src/lib/reportExport';
import { buildInstallments } from '../src/domain/finance';
import { percentToBps } from '../src/domain/commission';

const rejects = async (p: Promise<any>, match: RegExp | string) => {
  try { await p; } catch (e: any) { assert.match(`${e.code} ${e.message}`, typeof match === 'string' ? new RegExp(match) : match); return; }
  assert.fail('expected rejection: ' + match);
};
const avail = async (id: number) => (await PropertyRepo.getProperty(id))!.availability;

(async () => {
  await initRepo(createNodeDb());
  const db = getDb();
  const buyer = await Repo.saveCustomer({ name: 'Buyer One' }), buyer2 = await Repo.saveCustomer({ name: 'Buyer Two' });
  const seller = await Repo.saveCustomer({ name: 'Seller One' });
  const dealerA = await Repo.saveCustomer({ name: 'Dealer A' }), dealerB = await Repo.saveCustomer({ name: 'Dealer B' });
  const plot = await PropertyRepo.createProperty({ title: '10 Marla Plot', category: 'residential_plot', society: 'DHA', areaValue: 10, areaUnit: 'marla' });
  const rentShop = await PropertyRepo.createProperty({ title: 'Shop', category: 'shop', areaValue: 400, areaUnit: 'sqft', transactionType: 'rent' });

  // ---- opening a deal: availability + deal commit together, roles are added
  await rejects(DealRepo.createDeal({ propertyId: plot, buyerId: 999 }), 'buyer_required');
  await rejects(DealRepo.createDeal({ propertyId: plot, buyerId: buyer, sellerId: buyer }), 'same_party');
  await rejects(DealRepo.createDeal({ propertyId: plot, buyerId: buyer, transactionType: 'rent' }), 'transaction_mismatch');
  assert.equal(await avail(plot), 'available', 'a rejected deal changes nothing');
  assert.equal((await db.getAllAsync('SELECT id FROM deals')).length, 0);
  const d1 = await DealRepo.createDeal({ propertyId: plot, buyerId: buyer, sellerId: seller, agreedPrice: 10_000_000 });
  assert.equal((await DealRepo.getDeal(d1))!.code, 'DL-000001');
  assert.equal(await avail(plot), 'under_negotiation');
  assert.deepEqual((await db.getAllAsync<any>('SELECT role FROM person_roles WHERE person_id = ? ORDER BY role', [buyer])).map((r) => r.role), ['buyer']);
  // buyer interest on a second deal does not reserve; both stay open
  const d2 = await DealRepo.createDeal({ propertyId: plot, buyerId: buyer2, agreedPrice: 9_800_000 });
  assert.equal(await avail(plot), 'under_negotiation');

  // ---- stages are forward-only, price gate, explicit reservation
  await rejects(DealRepo.advanceStage(d2, 'initial_interest'), 'stage_backward');
  await DealRepo.advanceStage(d1, 'negotiation');
  await rejects(DealRepo.advanceStage(d1, 'initial_interest'), 'stage_backward');
  await rejects(DealRepo.reserveProperty(d1, false), 'confirmation_required');
  await DealRepo.reserveProperty(d1, true);
  assert.equal(await avail(plot), 'reserved');
  await rejects(DealRepo.reserveProperty(d2, true), 'reserved_by_other_deal');
  const noPrice = await DealRepo.createDeal({ propertyId: rentShop, buyerId: buyer });
  await rejects(DealRepo.advanceStage(noPrice, 'offer_accepted'), 'price_required');
  await rejects(DealRepo.advanceStage(d1, 'cancelled'), 'use_cancel');

  // ---- payments: partial, installments, balance, append-only
  await DealRepo.advanceStage(d1, 'offer_accepted');
  const tok = await DealRepo.addPayment({ dealId: d1, kind: 'token', amount: 500_000, reference: 'RCPT-1' });
  assert.equal((await DealRepo.balance(d1)).outstanding, 9_500_000);
  assert.equal((await DealRepo.listPayments({ dealId: d1 }))[0].code, 'PM-000001');
  await rejects(DealRepo.addPayment({ dealId: d1, kind: 'bayana', amount: 0 }), 'amount');
  await rejects(DealRepo.addPayment({ dealId: d1, kind: 'bayana', amount: 10.5 }), 'amount');
  await rejects(db.runAsync('UPDATE payments SET amount = 1 WHERE id = ?', [tok]), 'append-only');
  await rejects(db.runAsync('DELETE FROM payments WHERE id = ?', [tok]), 'append-only');
  await DealRepo.setSchedule(d1, buildInstallments(10_000_000, 4, '2026-01-10'));
  await rejects(DealRepo.setSchedule(d1, [{ seq: 1, dueDate: '2026-01-10', amount: 5 }]), 'schedule_sum');
  await rejects(DealRepo.updateTerms(d1, { agreedPrice: 9_000_000 }), 'price_locked');
  let sch = await DealRepo.schedule(d1, '2026-02-01');
  assert.deepEqual(sch.map((s) => s.state), ['overdue', 'upcoming', 'upcoming', 'upcoming'], 'part-paid but past due counts as overdue');
  assert.equal(sch[0].applied, 500_000);

  // ---- reversal instead of edit; double reversal blocked
  const bad = await DealRepo.addPayment({ dealId: d1, kind: 'installment', amount: 2_000_000 });
  assert.equal((await DealRepo.balance(d1)).heldFromBuyer, 2_500_000);
  const rev = await DealRepo.reversePayment(bad, 'wrong deal');
  assert.equal((await DealRepo.balance(d1)).heldFromBuyer, 500_000);
  await rejects(DealRepo.reversePayment(bad, 'again'), 'reversal_duplicate');
  await rejects(DealRepo.reversePayment(rev, 'x'), 'reversal_of_reversal');
  assert.equal((await DealRepo.listPayments({ dealId: d1 })).find((p) => p.id === bad)!.reversed, true);

  // ---- completing needs the full balance; completion sells the property; second completion conflicts
  await DealRepo.advanceStage(d1, 'payment_in_progress');
  await rejects(DealRepo.advanceStage(d1, 'completed'), 'unpaid_balance');
  await DealRepo.addPayment({ dealId: d1, kind: 'buyer_payment', amount: 9_500_000, method: 'bank_transfer' });
  assert.equal((await DealRepo.balance(d1)).outstanding, 0);
  await DealRepo.advanceStage(d1, 'completed');
  assert.equal(await avail(plot), 'sold');
  await rejects(DealRepo.advanceStage(d2, 'offer_accepted').then(() => DealRepo.advanceStage(d2, 'completed', { allowOutstanding: true })), 'already_closed');
  await rejects(DealRepo.updateTerms(d1, { notes: 'x' }), 'deal_closed');
  await rejects(DealRepo.addPayment({ dealId: d1, kind: 'seller_payment', amount: 0 }), 'amount');

  // ---- cancel: reason required, history + payments kept, availability recalculated, refund bounded
  const plot2 = await PropertyRepo.createProperty({ title: 'House', category: 'house', areaValue: 5, areaUnit: 'marla' });
  const c1 = await DealRepo.createDeal({ propertyId: plot2, buyerId: buyer, agreedPrice: 5_000_000 });
  const c2 = await DealRepo.createDeal({ propertyId: plot2, buyerId: buyer2, agreedPrice: 4_900_000 });
  await DealRepo.addPayment({ dealId: c1, kind: 'token', amount: 300_000 });
  await rejects(DealRepo.cancelDeal(c1, '  '), 'reason_required');
  await DealRepo.cancelDeal(c1, 'Buyer backed out');
  assert.equal(await avail(plot2), 'under_negotiation', 'other deal still open');
  assert.equal((await DealRepo.getDeal(c1))!.cancelReason, 'Buyer backed out');
  assert.equal((await DealRepo.listPayments({ dealId: c1 })).length, 1, 'payment kept after cancel');
  assert.ok((await DealRepo.stageHistory(c1)).some((h) => h.to_stage === 'cancelled'));
  await rejects(DealRepo.addPayment({ dealId: c1, kind: 'buyer_payment', amount: 1000 }), 'deal_cancelled');
  await rejects(DealRepo.addPayment({ dealId: c1, kind: 'refund', amount: 400_000 }), 'refund_exceeds');
  await DealRepo.addPayment({ dealId: c1, kind: 'refund', amount: 300_000 });
  assert.equal((await DealRepo.balance(c1)).heldFromBuyer, 0);
  await rejects(DealRepo.cancelDeal(c1, 'again'), 'deal_closed');
  await DealRepo.cancelDeal(c2, 'No longer interested');
  assert.equal(await avail(plot2), 'available');
  await rejects(db.runAsync('UPDATE deal_stage_history SET note = ?', ['x']), 'append-only');

  // ---- commission: snapshot is frozen; shares exact; payouts bounded; received separate from customer funds
  await rejects(DealRepo.finalizeCommission(d1, {}, [{ personId: dealerA, role: 'listing_dealer', shareBps: 10000 }]), 'no_terms');
  const sides = { seller: { type: 'percent' as const, bps: percentToBps(1) }, buyer: { type: 'percent' as const, bps: percentToBps(1) } };
  await rejects(DealRepo.finalizeCommission(d1, sides, [{ personId: dealerA, role: 'a', shareBps: 5000 }]), 'share_sum');
  const snap = await DealRepo.finalizeCommission(d1, sides, [{ personId: dealerA, role: 'listing_dealer', shareBps: 6000 }, { personId: dealerB, role: 'buyer_dealer', shareBps: 4000 }]);
  assert.equal(snap.total, 200_000); assert.deepEqual(snap.shares.map((s) => s.amount), [120_000, 80_000]);
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.shares[0]), 'snapshot is frozen');
  await rejects(db.runAsync('UPDATE commission_agreements SET total_amount = 1'), 'immutable');
  await rejects(db.runAsync('UPDATE commission_shares SET amount = 1'), 'immutable');
  let st = (await DealRepo.commissionStatus(d1))!;
  assert.equal(st.pendingFromClient, 200_000);
  await rejects(DealRepo.recordCommissionReceived(d1, 300_000), 'commission_exceeds');
  await DealRepo.recordCommissionReceived(d1, 200_000);
  const shareA = st.lines[0].shareId;
  await rejects(DealRepo.payCommissionShare(shareA, 130_000), 'payout_exceeds');
  await DealRepo.payCommissionShare(shareA, 50_000);
  st = (await DealRepo.commissionStatus(d1))!;
  assert.equal(st.lines[0].remaining, 70_000); assert.equal(st.lines[1].remaining, 80_000); assert.equal(st.received, 200_000);
  // changing the price/defaults later must not touch the stored snapshot
  assert.equal(JSON.parse((await db.getFirstAsync<any>('SELECT snapshot FROM commission_agreements WHERE deal_id = ?', [d1]))!.snapshot).total, 200_000);
  await rejects(DealRepo.finalizeCommission(d1, sides, [{ personId: dealerA, role: 'a', shareBps: 10000 }]), 'commission_paid_out');

  // ---- expenses are append-only with reversals
  const e1 = await DealRepo.addExpense({ category: 'marketing', amount: 15_000, description: 'Banner' });
  await DealRepo.addExpense({ category: 'travel', amount: 5_000 });
  await rejects(DealRepo.addExpense({ category: 'office', amount: -5 }), 'amount');
  await rejects(db.runAsync('DELETE FROM expenses WHERE id = ?', [e1]), 'append-only');
  await DealRepo.reverseExpense(e1);
  await rejects(DealRepo.reverseExpense(e1), 'reversal_duplicate');

  // ---- reports come from real rows
  const all = rangeFor('year');
  const k = await ReportRepo.kpis(all);
  assert.equal(k.totalProperties, 3); assert.equal(k.sold, 1); assert.equal(k.completedDeals, 1); assert.equal(k.salesVolume, 10_000_000);
  assert.equal(k.commissionEarned, 200_000); assert.equal(k.commissionPaidOut, 50_000); assert.equal(k.expenses, 5_000);
  assert.equal(k.netIncome, 200_000 - 50_000 - 5_000, 'customer funds are not income');
  assert.equal(k.pendingCommission, 0);
  assert.equal(k.outstandingPayments, 9_800_000, 'd2 is open with nothing paid');
  assert.equal((await ReportRepo.pendingPayments())[0].outstanding, 9_800_000);
  assert.equal(k.activeDeals, 2, 'd2 and the rent shop deal are still open');
  const m = await ReportRepo.monthly(3); assert.equal(m.length, 3);
  assert.equal(m[2].deals, 1); assert.equal(m[2].volume, 10_000_000); assert.equal(m[2].commission, 200_000);
  assert.equal((await ReportRepo.dealFunnel()).find((f) => f.stage === 'completed')!.count, 1);
  assert.equal((await ReportRepo.commissionByPerson(all))[0].name, 'Dealer A');
  assert.equal(rangeFor('week', Date.parse('2026-11-18T10:00:00')).from, new Date(2026, 10, 16).getTime(), 'week starts Monday');

  // ---- exportable report tables run against the real schema; CSV/HTML carry the credit
  for (const kind of Object.keys(REPORT_LABEL) as ReportKind[]) {
    const t = await reportTable(kind, all);
    for (const row of t.rows) assert.equal(row.length, t.columns.length, `${kind}: row width`);
    assert.match(tableToCsv(t, 'test'), /RetailX Solution/); assert.match(tableToHtml(t, 'test', 'Biz'), /RetailX Solution/);
  }
  const dt = await reportTable('deals', all); assert.equal(dt.totals!.find((x) => x.label === 'Completed sales volume')!.value, 10_000_000);
  const ct = await reportTable('commission', all); assert.equal(ct.totals![0].value, 200_000);
  assert.equal((await reportTable('commission', all, { dealerId: dealerA })).rows.length, 1);
  assert.ok(tableToCsv({ kind: 'expenses', title: 'T', columns: ['a'], rows: [['=cmd()'], [-5]] }, 'r').includes("'=cmd()"));

  assert.ok(Array.isArray(await ReportRepo.expiringListings(7, 5)));
  console.log('deals tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
