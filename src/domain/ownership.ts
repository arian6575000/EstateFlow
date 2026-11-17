// Ownership is its own history-preserving record: a property can have several owners (joint ownership),
// ownership never gets overwritten, and a transfer closes the old rows with an end date.
// The app records dealer-entered verification only; it does NOT certify legal title.
import { assertDomain } from './errors';

export const VERIFICATION = ['unverified', 'documents_seen', 'dealer_verified'] as const;
export type Verification = (typeof VERIFICATION)[number];

export interface OwnershipRow { id?: number; personId: number; percentage: number; startDate: string; endDate: string | null }
export interface NewOwner { personId: number; percentage: number; verification?: Verification; notes?: string }

const iso = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const isCurrent = (o: OwnershipRow, asOf: string) => o.startDate <= asOf && (o.endDate === null || o.endDate > asOf);

export function validateOwnerSet(owners: NewOwner[]): void {
  assertDomain(owners.length > 0, 'owners_empty', 'At least one owner is required');
  const seen = new Set<number>();
  let sum = 0;
  for (const o of owners) {
    assertDomain(!seen.has(o.personId), 'owner_duplicate', 'The same person is listed twice as owner');
    seen.add(o.personId);
    assertDomain(Number.isFinite(o.percentage) && o.percentage > 0 && o.percentage <= 100, 'owner_percentage', 'Ownership percentage must be between 0 and 100');
    sum += o.percentage;
  }
  assertDomain(Math.abs(r2(sum) - 100) < 0.005, 'owner_sum', `Ownership shares add up to ${r2(sum)}%, not 100%`);
}

export interface TransferPlan { closeIds: number[]; endDate: string; insert: NewOwner[] }

/** Close every current owner row at `effectiveDate` and insert the new owner set. Nothing is deleted. */
export function planOwnershipTransfer(existing: OwnershipRow[], next: NewOwner[], effectiveDate: string): TransferPlan {
  assertDomain(iso.test(effectiveDate), 'date', 'Effective date must be YYYY-MM-DD');
  validateOwnerSet(next);
  const current = existing.filter((o) => o.endDate === null);
  for (const o of current) assertDomain(effectiveDate >= o.startDate, 'date_before_start', 'Effective date is before the current ownership started');
  return { closeIds: current.map((o) => o.id!).filter((x) => x != null), endDate: effectiveDate, insert: next };
}
