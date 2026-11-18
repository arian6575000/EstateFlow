// EstateFlow deals, payments, commission and expenses.
// Rules enforced here (not in the UI):
//  - a deal can only open on a property whose availability allows it; availability and deal rows commit in ONE transaction;
//  - stages only move forward (or to cancelled); history rows are append-only;
//  - payments / expenses are append-only: corrections are reversal rows; refunds cannot exceed what the buyer paid;
//  - the commission agreement is a frozen snapshot; commission payouts can never exceed a participant's share;
//  - customer money (buyer payments, refunds, seller payments) never counts as dealer income.
import { getDb } from './repo';
import { applyAvailabilityTx } from './propertyRepo';
import { assertDomain, DomainError } from '../domain/errors';
import { TransactionType, assertAvailabilityOk } from '../domain/availability';
import { AgreementSnapshot, ShareInput, SideTerms, assertPayoutAllowed, finalizeAgreement, settlementStatus } from '../domain/commission';
import { CUSTOMER_IN, Installment, PAYMENT_KINDS, PAYMENT_METHODS, PaymentKind, PaymentMethod, PaymentRow, dealBalance, installmentStatus, validateRefund, validateReversal } from '../domain/finance';

export const DEAL_STAGES = ['initial_interest', 'negotiation', 'offer_submitted', 'offer_accepted', 'token_received', 'bayana_agreement', 'payment_in_progress', 'completed', 'cancelled'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const STAGE_LABEL: Record<DealStage, string> = {
  initial_interest: 'Initial Interest', negotiation: 'Negotiation', offer_submitted: 'Offer Submitted', offer_accepted: 'Offer Accepted', token_received: 'Token Received',
  bayana_agreement: 'Bayana / Agreement', payment_in_progress: 'Payment in Progress', completed: 'Completed', cancelled: 'Cancelled',
};
const OPEN_STAGES: readonly DealStage[] = DEAL_STAGES.filter((s) => s !== 'completed' && s !== 'cancelled');
const NEEDS_PRICE: DealStage[] = ['offer_accepted', 'token_received', 'bayana_agreement', 'payment_in_progress', 'completed'];
export const EXPENSE_CATEGORIES = ['office', 'marketing', 'travel', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const now = () => Date.now();
const tmp = () => `TMP-${now()}-${Math.random().toString(36).slice(2, 8)}`;
const pad = (prefix: string, id: number) => `${prefix}-${String(id).padStart(6, '0')}`;
const isWhole = (n: any) => Number.isInteger(n) && n >= 0;

export interface Deal {
  id: number; code: string; propertyId: number; listingId: number | null; buyerId: number | null; sellerId: number | null; transactionType: TransactionType;
  stage: DealStage; agreedPrice: number | null; dealDate: string; paymentTerms: string; notes: string; cancelReason: string;
  createdAt: number; updatedAt: number; closedAt: number | null;
  propertyTitle: string; propertyCode: string; buyerName: string; sellerName: string;
}
const toDeal = (r: any): Deal => ({
  id: r.id, code: r.code, propertyId: r.property_id, listingId: r.listing_id ?? null, buyerId: r.buyer_id ?? null, sellerId: r.seller_id ?? null, transactionType: r.transaction_type,
  stage: r.stage, agreedPrice: r.agreed_price ?? null, dealDate: r.deal_date, paymentTerms: r.payment_terms, notes: r.notes, cancelReason: r.cancel_reason,
  createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at ?? null,
  propertyTitle: r.property_title ?? '', propertyCode: r.property_code ?? '', buyerName: r.buyer_name ?? '', sellerName: r.seller_name ?? '',
});
const DEAL_SELECT = `SELECT d.*, p.title AS property_title, p.code AS property_code, b.name AS buyer_name, s.name AS seller_name
  FROM deals d JOIN properties p ON p.id = d.property_id LEFT JOIN customers b ON b.id = d.buyer_id LEFT JOIN customers s ON s.id = d.seller_id`;

export interface Payment {
  id: number; code: string; dealId: number | null; personId: number | null; personName: string; commissionShareId: number | null;
  kind: PaymentKind; amount: number; paidAt: number; method: PaymentMethod; reference: string; notes: string; reversalOf: number | null; reversed: boolean;
}
const toPayment = (r: any): Payment => ({
  id: r.id, code: r.code, dealId: r.deal_id ?? null, personId: r.person_id ?? null, personName: r.person_name ?? '', commissionShareId: r.commission_share_id ?? null,
  kind: r.kind, amount: r.amount, paidAt: r.paid_at, method: r.method, reference: r.reference, notes: r.notes, reversalOf: r.reversal_of ?? null, reversed: !!r.reversed,
});
const asRow = (p: Payment): PaymentRow => ({ id: p.id, kind: p.kind, amount: p.amount, reversalOf: p.reversalOf });

export interface Expense { id: number; category: ExpenseCategory; amount: number; spentAt: number; description: string; method: PaymentMethod; reversalOf: number | null; reversed: boolean }
const toExpense = (r: any): Expense => ({ id: r.id, category: r.category, amount: r.amount, spentAt: r.spent_at, description: r.description, method: r.method, reversalOf: r.reversal_of ?? null, reversed: !!r.reversed });

export const DealRepo = {
  // ---------- deals ----------
  async createDeal(i: { propertyId: number; listingId?: number | null; buyerId: number; sellerId?: number | null; agreedPrice?: number | null; dealDate?: string; paymentTerms?: string; notes?: string; transactionType?: TransactionType }): Promise<number> {
    const db = getDb();
    const prop = await db.getFirstAsync<any>('SELECT id, transaction_type FROM properties WHERE id = ? AND record_status = ?', [i.propertyId, 'active']);
    assertDomain(prop, 'not_found', 'Property not found');
    assertDomain(await db.getFirstAsync('SELECT id FROM customers WHERE id = ?', [i.buyerId]), 'buyer_required', 'Choose the buyer / tenant for this deal');
    assertDomain(i.sellerId == null || (await db.getFirstAsync('SELECT id FROM customers WHERE id = ?', [i.sellerId])), 'seller_missing', 'Seller not found');
    assertDomain(i.sellerId == null || i.sellerId !== i.buyerId, 'same_party', 'Buyer and seller cannot be the same person');
    assertDomain(i.agreedPrice == null || (isWhole(i.agreedPrice) && i.agreedPrice > 0), 'price', 'Price must be a whole number of rupees above zero');
    const type = i.transactionType ?? prop.transaction_type;
    assertDomain(type === prop.transaction_type, 'transaction_mismatch', `This property is for ${prop.transaction_type}, so the deal must be a ${prop.transaction_type}`);
    if (i.listingId != null) assertDomain(await db.getFirstAsync('SELECT id FROM listings WHERE id = ? AND property_id = ?', [i.listingId, i.propertyId]), 'listing_mismatch', 'The listing does not belong to this property');
    const t = now(); let id = 0;
    await db.withTransactionAsync(async () => {
      const res = await db.runAsync(
        `INSERT INTO deals (code, property_id, listing_id, buyer_id, seller_id, transaction_type, stage, agreed_price, deal_date, payment_terms, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [tmp(), i.propertyId, i.listingId ?? null, i.buyerId, i.sellerId ?? null, type, 'initial_interest', i.agreedPrice ?? null, i.dealDate ?? '', i.paymentTerms ?? '', i.notes ?? '', t, t]);
      id = res.lastInsertRowId;
      await db.runAsync('UPDATE deals SET code = ? WHERE id = ?', [pad('DL', id), id]);
      await db.runAsync('INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, note, at) VALUES (?,?,?,?,?)', [id, null, 'initial_interest', 'Deal opened', t]);
      await db.runAsync("INSERT INTO deal_participants (deal_id, person_id, role) VALUES (?,?,'buyer')", [id, i.buyerId]);
      await db.runAsync("INSERT OR IGNORE INTO person_roles (person_id, role, created_at) VALUES (?, ?, ?)", [i.buyerId, type === 'rent' ? 'tenant' : 'buyer', t]);
      if (i.sellerId != null) {
        await db.runAsync("INSERT INTO deal_participants (deal_id, person_id, role) VALUES (?,?,'seller')", [id, i.sellerId]);
        await db.runAsync("INSERT OR IGNORE INTO person_roles (person_id, role, created_at) VALUES (?, 'seller', ?)", [i.sellerId, t]);
      }
      assertAvailabilityOk(await applyAvailabilityTx(i.propertyId, { type: 'start_negotiation', dealId: id }, `Deal ${pad('DL', id)} opened`)); // throws → whole deal rolls back
    });
    return id;
  },

  async getDeal(id: number): Promise<Deal | null> {
    const r = await getDb().getFirstAsync<any>(`${DEAL_SELECT} WHERE d.id = ?`, [id]);
    return r ? toDeal(r) : null;
  },
  async listDeals(f: { stage?: DealStage | 'open'; propertyId?: number; personId?: number; q?: string; limit?: number; offset?: number } = {}): Promise<Deal[]> {
    const where: string[] = [], p: any[] = [];
    if (f.stage === 'open') where.push("d.stage NOT IN ('completed','cancelled')");
    else if (f.stage) { where.push('d.stage = ?'); p.push(f.stage); }
    if (f.propertyId != null) { where.push('d.property_id = ?'); p.push(f.propertyId); }
    if (f.personId != null) { where.push('(d.buyer_id = ? OR d.seller_id = ?)'); p.push(f.personId, f.personId); }
    if (f.q?.trim()) { const l = `%${f.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`; where.push("(d.code LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')"); p.push(l, l, l, l); }
    const rows = await getDb().getAllAsync<any>(`${DEAL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?`, [...p, Math.min(f.limit ?? 100, 500), f.offset ?? 0]);
    return rows.map(toDeal);
  },

  /** Terms can change while the deal is open; the price is locked once a commission agreement has been finalised. */
  async updateTerms(id: number, i: { agreedPrice?: number | null; dealDate?: string; paymentTerms?: string; notes?: string }) {
    const db = getDb(); const d = await DealRepo.getDeal(id);
    assertDomain(d, 'not_found', 'Deal not found');
    assertDomain(OPEN_STAGES.includes(d!.stage), 'deal_closed', `A ${d!.stage} deal can no longer be edited`);
    if (i.agreedPrice !== undefined) {
      assertDomain(i.agreedPrice === null || (isWhole(i.agreedPrice) && i.agreedPrice > 0), 'price', 'Price must be a whole number of rupees above zero');
      if (i.agreedPrice !== d!.agreedPrice) {
        assertDomain(!(await db.getFirstAsync('SELECT id FROM commission_agreements WHERE deal_id = ? AND superseded_by IS NULL', [id])), 'price_locked', 'The price is locked because the commission agreement is finalised. Re-finalise the commission first.');
        assertDomain(!(await db.getFirstAsync('SELECT id FROM installments WHERE deal_id = ?', [id])), 'price_locked', 'The price is locked because an installment schedule exists. Clear the schedule first.');
      }
    }
    await db.runAsync('UPDATE deals SET agreed_price = ?, deal_date = ?, payment_terms = ?, notes = ?, updated_at = ? WHERE id = ?',
      [i.agreedPrice === undefined ? d!.agreedPrice : i.agreedPrice, i.dealDate ?? d!.dealDate, i.paymentTerms ?? d!.paymentTerms, i.notes ?? d!.notes, now(), id]);
  },

  /** Forward-only stage changes. Completing needs a price and (unless `allowOutstanding`) a fully paid balance, and sets the property sold/rented. */
  async advanceStage(id: number, to: DealStage, opts: { note?: string; allowOutstanding?: boolean } = {}): Promise<{ warnings: string[] }> {
    const db = getDb(); let warnings: string[] = [];
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(id);
      assertDomain(d, 'not_found', 'Deal not found');
      assertDomain(to !== 'cancelled', 'use_cancel', 'Use Cancel deal (it needs a reason)');
      assertDomain(OPEN_STAGES.includes(d!.stage), 'deal_closed', `This deal is already ${d!.stage}`);
      assertDomain(DEAL_STAGES.indexOf(to) > DEAL_STAGES.indexOf(d!.stage), 'stage_backward', 'A deal stage can only move forward');
      if (NEEDS_PRICE.includes(to)) assertDomain(d!.agreedPrice != null && d!.agreedPrice > 0, 'price_required', 'Set the agreed price before moving to this stage');
      if (to === 'completed') {
        if (!opts.allowOutstanding) {
          const b = await DealRepo.balance(id);
          assertDomain(b.outstanding === 0, 'unpaid_balance', `Rs ${b.outstanding.toLocaleString('en-US')} is still outstanding. Collect it, or confirm completing with an open balance.`);
        }
        const r = assertAvailabilityOk(await applyAvailabilityTx(d!.propertyId, { type: 'complete_deal', dealId: id, dealType: d!.transactionType }, `Deal ${d!.code} completed`));
        warnings = r.warnings;
      }
      const t = now();
      await db.runAsync('UPDATE deals SET stage = ?, updated_at = ?, closed_at = ? WHERE id = ?', [to, t, to === 'completed' ? t : null, id]);
      await db.runAsync('INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, note, at) VALUES (?,?,?,?,?)', [id, d!.stage, to, opts.note ?? '', t]);
    });
    return { warnings };
  },

  /** Cancelling keeps every record (history, payments, commission snapshot). Refunds are separate, explicit payments. */
  async cancelDeal(id: number, reason: string) {
    assertDomain(reason.trim().length > 0, 'reason_required', 'Enter a reason for cancelling');
    const db = getDb();
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(id);
      assertDomain(d, 'not_found', 'Deal not found');
      assertDomain(OPEN_STAGES.includes(d!.stage), 'deal_closed', `This deal is already ${d!.stage}`);
      const others = (await db.getAllAsync<{ id: number }>("SELECT id FROM deals WHERE property_id = ? AND id != ? AND stage NOT IN ('completed','cancelled')", [d!.propertyId, id])).map((x) => x.id);
      assertAvailabilityOk(await applyAvailabilityTx(d!.propertyId, { type: 'cancel_deal', dealId: id, otherActiveDealIds: others }, `Deal ${d!.code} cancelled`));
      const t = now();
      await db.runAsync("UPDATE deals SET stage = 'cancelled', cancel_reason = ?, updated_at = ?, closed_at = ? WHERE id = ?", [reason.trim(), t, t, id]);
      await db.runAsync('INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, note, at) VALUES (?,?,?,?,?)', [id, d!.stage, 'cancelled', reason.trim(), t]);
    });
  },

  /** Explicit reservation (never automatic). */
  async reserveProperty(dealId: number, confirmed: boolean) {
    const db = getDb();
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(dealId);
      assertDomain(d && OPEN_STAGES.includes(d.stage), 'deal_closed', 'Only an open deal can reserve the property');
      assertAvailabilityOk(await applyAvailabilityTx(d!.propertyId, { type: 'reserve', dealId, confirmed }, `Reserved for ${d!.code}`));
    });
  },
  async releaseReservation(dealId: number) {
    const db = getDb();
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(dealId); assertDomain(d, 'not_found', 'Deal not found');
      const p = await db.getFirstAsync<any>('SELECT availability, reserved_by_deal_id FROM properties WHERE id = ?', [d!.propertyId]);
      assertDomain(p.availability === 'reserved' && p.reserved_by_deal_id === dealId, 'not_reserved', 'This deal does not hold the reservation');
      const others = (await db.getAllAsync<{ id: number }>("SELECT id FROM deals WHERE property_id = ? AND id != ? AND stage NOT IN ('completed','cancelled')", [d!.propertyId, dealId]));
      // releasing = going back to negotiation (this deal is still open) — recorded in the audit trail
      const to = 'under_negotiation';
      await db.runAsync('UPDATE properties SET availability = ?, reserved_by_deal_id = NULL, updated_at = ? WHERE id = ?', [to, now(), d!.propertyId]);
      await db.runAsync('INSERT INTO availability_history (property_id, from_state, to_state, action, deal_id, reason, at) VALUES (?,?,?,?,?,?,?)', [d!.propertyId, 'reserved', to, 'release_reservation', dealId, `Reservation released (${others.length} other open deal(s))`, now()]);
    });
  },

  async stageHistory(dealId: number) {
    return getDb().getAllAsync<{ from_stage: string | null; to_stage: DealStage; note: string; at: number }>('SELECT from_stage, to_stage, note, at FROM deal_stage_history WHERE deal_id = ? ORDER BY at, id', [dealId]);
  },

  // ---------- payments ----------
  async listPayments(f: { dealId?: number; personId?: number; limit?: number; sinceMs?: number } = {}): Promise<Payment[]> {
    const where: string[] = [], p: any[] = [];
    if (f.dealId != null) { where.push('p.deal_id = ?'); p.push(f.dealId); }
    if (f.personId != null) { where.push('p.person_id = ?'); p.push(f.personId); }
    if (f.sinceMs != null) { where.push('p.paid_at >= ?'); p.push(f.sinceMs); }
    const rows = await getDb().getAllAsync<any>(
      `SELECT p.*, c.name AS person_name, EXISTS (SELECT 1 FROM payments r WHERE r.reversal_of = p.id) AS reversed FROM payments p LEFT JOIN customers c ON c.id = p.person_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.paid_at DESC, p.id DESC LIMIT ?`, [...p, Math.min(f.limit ?? 200, 1000)]);
    return rows.map(toPayment);
  },
  async balance(dealId: number) {
    const d = await DealRepo.getDeal(dealId); assertDomain(d, 'not_found', 'Deal not found');
    const rows = (await DealRepo.listPayments({ dealId, limit: 1000 })).map(asRow);
    return { ...dealBalance(d!.agreedPrice ?? 0, rows), agreedPrice: d!.agreedPrice ?? 0 };
  },

  /** Record money against a deal. kind: buyer_payment/token/bayana/installment (in), seller_payment (pass-through out), refund (out). */
  async addPayment(i: { dealId: number; kind: Exclude<PaymentKind, 'commission_received' | 'commission_paid'>; amount: number; paidAt?: number; method?: PaymentMethod; reference?: string; notes?: string }): Promise<number> {
    assertDomain((PAYMENT_KINDS as readonly string[]).includes(i.kind) && !(['commission_received', 'commission_paid'] as string[]).includes(i.kind), 'kind', 'Unknown payment type');
    assertDomain(isWhole(i.amount) && i.amount > 0, 'amount', 'Amount must be a whole number of rupees above zero');
    assertDomain(!i.method || (PAYMENT_METHODS as readonly string[]).includes(i.method), 'method', 'Unknown payment method');
    const db = getDb(); let id = 0;
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(i.dealId); assertDomain(d, 'not_found', 'Deal not found');
      const isIn = (CUSTOMER_IN as readonly string[]).includes(i.kind);
      if (isIn) assertDomain(d!.stage !== 'cancelled', 'deal_cancelled', 'This deal is cancelled. Take no new payments; refund what was paid instead.');
      if (isIn) assertDomain(d!.agreedPrice != null || i.kind === 'token' || i.kind === 'bayana', 'price_required', 'Set the agreed price before recording this payment');
      if (i.kind === 'refund') { const b = await DealRepo.balance(i.dealId); validateRefund(b.heldFromBuyer, i.amount); }
      const person = i.kind === 'seller_payment' ? d!.sellerId : d!.buyerId;
      const t = now();
      const res = await db.runAsync('INSERT INTO payments (code, deal_id, person_id, kind, amount, paid_at, method, reference, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [tmp(), i.dealId, person, i.kind, i.amount, i.paidAt ?? t, i.method ?? 'cash', (i.reference ?? '').trim(), (i.notes ?? '').trim(), t]);
      id = res.lastInsertRowId;
      await db.runAsync('UPDATE payments SET code = ? WHERE id = ?', [pad('PM', id), id]);
    });
    return id;
  },
  /** Correction = a new row that points at the original. The original is never edited or deleted. */
  async reversePayment(paymentId: number, reason: string): Promise<number> {
    const db = getDb(); let id = 0;
    await db.withTransactionAsync(async () => {
      const r = await db.getFirstAsync<any>('SELECT * FROM payments WHERE id = ?', [paymentId]);
      const existing = (await db.getAllAsync<any>('SELECT id, kind, amount, reversal_of FROM payments WHERE reversal_of = ?', [paymentId])).map((x) => ({ id: x.id, kind: x.kind, amount: x.amount, reversalOf: x.reversal_of ?? null }));
      validateReversal(r ? { id: r.id, kind: r.kind, amount: r.amount, reversalOf: r.reversal_of ?? null } : undefined, existing);
      if (r.kind === 'refund') { /* reversing a refund puts the money back on the deal: always allowed */ }
      else if ((CUSTOMER_IN as readonly string[]).includes(r.kind)) {
        const rows = (await DealRepo.listPayments({ dealId: r.deal_id, limit: 1000 })).map(asRow);
        const held = dealBalance(0, rows).heldFromBuyer;
        assertDomain(held - r.amount >= 0, 'reversal_makes_negative', 'Reversing this would leave the deal with a negative balance because of a later refund. Reverse the refund first.');
      }
      const t = now();
      const res = await db.runAsync('INSERT INTO payments (code, deal_id, person_id, commission_share_id, kind, amount, paid_at, method, reference, notes, reversal_of, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [tmp(), r.deal_id, r.person_id, r.commission_share_id, r.kind, r.amount, t, r.method, `Reversal of ${r.code}`, reason.trim(), r.id, t]);
      id = res.lastInsertRowId;
      await db.runAsync('UPDATE payments SET code = ? WHERE id = ?', [pad('PM', id), id]);
    });
    return id;
  },

  // ---------- installments ----------
  async setSchedule(dealId: number, schedule: Installment[]) {
    const db = getDb(); const d = await DealRepo.getDeal(dealId); assertDomain(d, 'not_found', 'Deal not found');
    assertDomain(OPEN_STAGES.includes(d!.stage), 'deal_closed', 'The schedule of a closed deal cannot change');
    assertDomain(d!.agreedPrice != null, 'price_required', 'Set the agreed price first');
    assertDomain(schedule.every((s) => isWhole(s.amount) && s.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.dueDate)), 'schedule', 'Every installment needs a date and a whole amount above zero');
    const sum = schedule.reduce((a, s) => a + s.amount, 0);
    assertDomain(schedule.length === 0 || sum === d!.agreedPrice, 'schedule_sum', `Installments add up to ${sum}, but the agreed price is ${d!.agreedPrice}`);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM installments WHERE deal_id = ?', [dealId]);
      for (const s of schedule) await db.runAsync('INSERT INTO installments (deal_id, seq, due_date, amount) VALUES (?,?,?,?)', [dealId, s.seq, s.dueDate, s.amount]);
    });
  },
  async schedule(dealId: number, today: string) {
    const rows = await getDb().getAllAsync<any>('SELECT seq, due_date, amount FROM installments WHERE deal_id = ? ORDER BY seq', [dealId]);
    const sched: Installment[] = rows.map((r) => ({ seq: r.seq, dueDate: r.due_date, amount: r.amount }));
    const b = await DealRepo.balance(dealId);
    return installmentStatus(sched, b.heldFromBuyer, today);
  },

  // ---------- commission ----------
  async finalizeCommission(dealId: number, sides: SideTerms, participants: ShareInput[]): Promise<AgreementSnapshot> {
    const db = getDb(); let snap!: AgreementSnapshot;
    await db.withTransactionAsync(async () => {
      const d = await DealRepo.getDeal(dealId); assertDomain(d, 'not_found', 'Deal not found');
      assertDomain(d!.stage !== 'cancelled', 'deal_cancelled', 'This deal is cancelled');
      assertDomain(d!.agreedPrice != null && d!.agreedPrice > 0, 'price_required', 'Set the agreed price before finalising the commission');
      for (const p of participants) assertDomain(await db.getFirstAsync('SELECT id FROM customers WHERE id = ?', [p.personId]), 'participant_missing', 'A commission participant no longer exists');
      snap = finalizeAgreement({ dealId, agreedPrice: d!.agreedPrice!, sides, participants });
      const prev = await db.getFirstAsync<{ id: number }>('SELECT id FROM commission_agreements WHERE deal_id = ? AND superseded_by IS NULL', [dealId]);
      if (prev) {
        const paid = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM payments p JOIN commission_shares s ON s.id = p.commission_share_id WHERE s.agreement_id = ?", [prev.id]);
        assertDomain(!paid || paid.n === 0, 'commission_paid_out', 'Commission was already paid out under the current agreement; it can no longer be replaced');
      }
      const res = await db.runAsync('INSERT INTO commission_agreements (deal_id, total_amount, snapshot, finalized_at) VALUES (?,?,?,?)', [dealId, snap.total, JSON.stringify(snap), now()]);
      for (const s of snap.shares) await db.runAsync('INSERT INTO commission_shares (agreement_id, person_id, role, amount, share_bps) VALUES (?,?,?,?,?)', [res.lastInsertRowId, s.personId, s.role, s.amount, s.shareBps]);
      if (prev) await db.runAsync('UPDATE commission_agreements SET superseded_by = ? WHERE id = ?', [res.lastInsertRowId, prev.id]);
    });
    return snap;
  },
  /** Current agreement + what has been received from clients and paid to each participant. */
  async commissionStatus(dealId: number) {
    const db = getDb();
    const a = await db.getFirstAsync<any>('SELECT * FROM commission_agreements WHERE deal_id = ? AND superseded_by IS NULL', [dealId]);
    if (!a) return null;
    const shares = await db.getAllAsync<any>('SELECT s.*, c.name AS person_name FROM commission_shares s JOIN customers c ON c.id = s.person_id WHERE s.agreement_id = ? ORDER BY s.id', [a.id]);
    const pays = await db.getAllAsync<any>("SELECT commission_share_id, person_id, amount, reversal_of FROM payments WHERE deal_id = ? AND kind = 'commission_paid'", [dealId]);
    const rec = await db.getAllAsync<any>("SELECT amount, reversal_of FROM payments WHERE deal_id = ? AND kind = 'commission_received'", [dealId]);
    const lines = settlementStatus(shares.map((s) => ({ personId: s.person_id, role: s.role, amount: s.amount, shareBps: s.share_bps ?? null })),
      pays.map((p) => ({ personId: p.person_id, amount: p.reversal_of ? -p.amount : p.amount })));
    const received = rec.reduce((n, p) => n + (p.reversal_of ? -p.amount : p.amount), 0);
    return {
      agreementId: a.id as number, total: a.total_amount as number, finalizedAt: a.finalized_at as number, snapshot: JSON.parse(a.snapshot) as AgreementSnapshot,
      received, pendingFromClient: Math.max(0, a.total_amount - received),
      lines: lines.map((l, i) => ({ ...l, shareId: shares[i].id as number, name: shares[i].person_name as string })),
    };
  },
  async recordCommissionReceived(dealId: number, amount: number, o: { method?: PaymentMethod; reference?: string; paidAt?: number } = {}) {
    assertDomain(isWhole(amount) && amount > 0, 'amount', 'Amount must be a whole number of rupees above zero');
    const db = getDb(); let id = 0;
    await db.withTransactionAsync(async () => {
      const st = await DealRepo.commissionStatus(dealId);
      assertDomain(st, 'no_agreement', 'Finalise the commission agreement first');
      assertDomain(amount <= st!.pendingFromClient, 'commission_exceeds', `Only Rs ${st!.pendingFromClient.toLocaleString('en-US')} of commission is still pending from the client`);
      const d = await DealRepo.getDeal(dealId); const t = now();
      const res = await db.runAsync("INSERT INTO payments (code, deal_id, person_id, kind, amount, paid_at, method, reference, created_at) VALUES (?,?,?,'commission_received',?,?,?,?,?)",
        [tmp(), dealId, d!.buyerId, amount, o.paidAt ?? t, o.method ?? 'cash', o.reference ?? '', t]);
      id = res.lastInsertRowId; await db.runAsync('UPDATE payments SET code = ? WHERE id = ?', [pad('PM', id), id]);
    });
    return id;
  },
  async payCommissionShare(shareId: number, amount: number, o: { method?: PaymentMethod; reference?: string; paidAt?: number } = {}) {
    const db = getDb(); let id = 0;
    await db.withTransactionAsync(async () => {
      const sh = await db.getFirstAsync<any>('SELECT s.*, a.deal_id FROM commission_shares s JOIN commission_agreements a ON a.id = s.agreement_id WHERE s.id = ?', [shareId]);
      assertDomain(sh, 'not_found', 'Commission share not found');
      const st = await DealRepo.commissionStatus(sh.deal_id);
      const line = st?.lines.find((l) => l.shareId === shareId);
      assertDomain(line, 'superseded', 'This commission share belongs to an older agreement');
      assertPayoutAllowed(line!, amount);
      const t = now();
      const res = await db.runAsync("INSERT INTO payments (code, deal_id, person_id, commission_share_id, kind, amount, paid_at, method, reference, created_at) VALUES (?,?,?,?,'commission_paid',?,?,?,?,?)",
        [tmp(), sh.deal_id, sh.person_id, shareId, amount, o.paidAt ?? t, o.method ?? 'cash', o.reference ?? '', t]);
      id = res.lastInsertRowId; await db.runAsync('UPDATE payments SET code = ? WHERE id = ?', [pad('PM', id), id]);
    });
    return id;
  },

  // ---------- expenses ----------
  async addExpense(i: { category: ExpenseCategory; amount: number; spentAt?: number; description?: string; method?: PaymentMethod }): Promise<number> {
    assertDomain((EXPENSE_CATEGORIES as readonly string[]).includes(i.category), 'category', 'Choose an expense category');
    assertDomain(isWhole(i.amount) && i.amount > 0, 'amount', 'Amount must be a whole number of rupees above zero');
    const t = now();
    return (await getDb().runAsync('INSERT INTO expenses (category, amount, spent_at, description, method, created_at) VALUES (?,?,?,?,?,?)', [i.category, i.amount, i.spentAt ?? t, (i.description ?? '').trim(), i.method ?? 'cash', t])).lastInsertRowId;
  },
  async reverseExpense(id: number) {
    const db = getDb();
    await db.withTransactionAsync(async () => {
      const e = await db.getFirstAsync<any>('SELECT * FROM expenses WHERE id = ?', [id]);
      assertDomain(e, 'not_found', 'Expense not found');
      assertDomain(!e.reversal_of, 'reversal_of_reversal', 'A reversal cannot be reversed');
      assertDomain(!(await db.getFirstAsync('SELECT id FROM expenses WHERE reversal_of = ?', [id])), 'reversal_duplicate', 'This expense was already reversed');
      await db.runAsync('INSERT INTO expenses (category, amount, spent_at, description, method, reversal_of, created_at) VALUES (?,?,?,?,?,?,?)', [e.category, e.amount, now(), `Reversal: ${e.description}`, e.method, id, now()]);
    });
  },
  async listExpenses(f: { sinceMs?: number; untilMs?: number; limit?: number } = {}): Promise<Expense[]> {
    const where: string[] = [], p: any[] = [];
    if (f.sinceMs != null) { where.push('e.spent_at >= ?'); p.push(f.sinceMs); }
    if (f.untilMs != null) { where.push('e.spent_at < ?'); p.push(f.untilMs); }
    return (await getDb().getAllAsync<any>(`SELECT e.*, EXISTS (SELECT 1 FROM expenses r WHERE r.reversal_of = e.id) AS reversed FROM expenses e ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.spent_at DESC, e.id DESC LIMIT ?`, [...p, f.limit ?? 200])).map(toExpense);
  },
};

export { DomainError };
