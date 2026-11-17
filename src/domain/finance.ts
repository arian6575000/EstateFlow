// Payments are APPEND-ONLY. A correction is a reversal row that points at the original (amount stays positive,
// the sign comes from the row's role). Customer funds, pass-through amounts and the dealer's own commission income
// are kept in separate buckets.
import { assertDomain } from './errors';

export const CUSTOMER_IN = ['buyer_payment', 'token', 'bayana', 'installment'] as const;
export const PAYMENT_KINDS = [...CUSTOMER_IN, 'seller_payment', 'refund', 'commission_received', 'commission_paid'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentRow { id: number; kind: PaymentKind; amount: number; reversalOf: number | null }
const signed = (p: PaymentRow) => (p.reversalOf ? -p.amount : p.amount);
const net = (rows: PaymentRow[], kinds: readonly PaymentKind[]) => rows.filter((p) => kinds.includes(p.kind)).reduce((a, p) => a + signed(p), 0);

/** Rows for one deal. A reversal row carries the kind of the payment it reverses. */
export function dealBalance(agreedPrice: number, rows: PaymentRow[]) {
  const collected = net(rows, CUSTOMER_IN);
  const refunded = net(rows, ['refund']);
  const heldFromBuyer = collected - refunded; // customer money actually kept against the deal
  return {
    collected, refunded, heldFromBuyer,
    paidToSeller: net(rows, ['seller_payment']), // pass-through, never dealer income
    commissionReceived: net(rows, ['commission_received']),
    commissionPaidOut: net(rows, ['commission_paid']),
    outstanding: Math.max(0, agreedPrice - heldFromBuyer),
    overpaid: Math.max(0, heldFromBuyer - agreedPrice),
  };
}

export function validateReversal(original: PaymentRow | undefined, existing: PaymentRow[]): void {
  assertDomain(!!original, 'reversal_missing', 'Original payment not found');
  assertDomain(!original!.reversalOf, 'reversal_of_reversal', 'A reversal cannot be reversed');
  assertDomain(!existing.some((p) => p.reversalOf === original!.id), 'reversal_duplicate', 'This payment was already reversed');
}

export function validateRefund(heldFromBuyer: number, amount: number): void {
  assertDomain(Number.isInteger(amount) && amount > 0, 'refund_amount', 'Refund must be a positive whole number of rupees');
  assertDomain(amount <= heldFromBuyer, 'refund_exceeds', `Refund of ${amount} exceeds the ${heldFromBuyer} held for this deal`);
}

// ---- installments ----
export interface Installment { seq: number; dueDate: string; amount: number }
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = (m - 1) + months, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/** Equal installments; the rounding remainder goes to the last one so the schedule adds up exactly. */
export function buildInstallments(total: number, count: number, firstDue: string, everyMonths = 1): Installment[] {
  assertDomain(Number.isInteger(total) && total > 0, 'inst_total', 'Installment total must be a positive whole number of rupees');
  assertDomain(Number.isInteger(count) && count >= 1 && count <= 360, 'inst_count', 'Installment count must be between 1 and 360');
  assertDomain(/^\d{4}-\d{2}-\d{2}$/.test(firstDue), 'inst_date', 'First due date must be YYYY-MM-DD');
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => ({ seq: i + 1, dueDate: addMonths(firstDue, i * everyMonths), amount: i === count - 1 ? total - base * (count - 1) : base }));
}

export type InstallmentState = 'paid' | 'partial' | 'overdue' | 'upcoming';
/** Apply what has been paid, oldest installment first. */
export function installmentStatus(schedule: Installment[], paid: number, today: string) {
  let left = paid;
  return schedule.map((i) => {
    const applied = Math.min(i.amount, Math.max(0, left)); left -= applied;
    const state: InstallmentState = applied >= i.amount ? 'paid' : i.dueDate < today ? 'overdue' : applied > 0 ? 'partial' : 'upcoming';
    return { ...i, applied, remaining: i.amount - applied, state };
  });
}
