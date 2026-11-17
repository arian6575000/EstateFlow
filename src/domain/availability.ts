// Property availability is a PROPERTY-level state, independent of listing status (marketing).
// Business rules (see EstateFlow spec §9):
//  1. An active listing can exist while the property is under negotiation.
//  2. Buyer interest never reserves a property: reservation is an explicit, confirmed action.
//  3. Completed sales/rentals set sold/rented; further reservations or completions are conflicts.
//  4. Cancelling a deal never erases history: callers must write availability_history for every change returned here.
import { DomainError } from './errors';

export const AVAILABILITY = ['available', 'under_negotiation', 'reserved', 'sold', 'rented', 'on_hold'] as const;
export type Availability = (typeof AVAILABILITY)[number];
export type TransactionType = 'sale' | 'rent';

export type AvailabilityAction =
  | { type: 'start_negotiation'; dealId: number }
  | { type: 'reserve'; dealId: number; confirmed: boolean }
  | { type: 'complete_deal'; dealId: number; dealType: TransactionType }
  | { type: 'cancel_deal'; dealId: number; otherActiveDealIds: number[] }
  | { type: 'hold' }
  | { type: 'release' }
  | { type: 'reopen'; confirmed: boolean };

export interface AvailabilityContext {
  current: Availability;
  /** Deal that currently holds the reservation (only meaningful when current === 'reserved'). */
  reservedByDealId: number | null;
  /** Deals that are open (not completed/cancelled) on this property, including the one in the action. */
  activeDealIds: number[];
  propertyTransaction: TransactionType;
}

export type AvailabilityResult =
  | { ok: true; to: Availability; reservedByDealId: number | null; warnings: string[] }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): AvailabilityResult => ({ ok: false, code, message });
const ok = (to: Availability, reservedByDealId: number | null = null, warnings: string[] = []): AvailabilityResult => ({ ok: true, to, reservedByDealId, warnings });

export function transitionAvailability(ctx: AvailabilityContext, a: AvailabilityAction): AvailabilityResult {
  const { current } = ctx;
  const closed = current === 'sold' || current === 'rented';
  switch (a.type) {
    case 'start_negotiation': {
      if (closed) return fail('already_closed', `Property is already ${current}. Reopen it before negotiating again.`);
      if (current === 'on_hold') return fail('on_hold', 'Property is on hold. Release it before starting a negotiation.');
      if (current === 'reserved') {
        const same = ctx.reservedByDealId === a.dealId;
        return ok('reserved', ctx.reservedByDealId, same ? [] : ['Property is reserved for another deal; this negotiation does not change the reservation.']);
      }
      return ok('under_negotiation');
    }
    case 'reserve': {
      if (!a.confirmed) return fail('confirmation_required', 'Reserving a property needs explicit confirmation.');
      if (closed) return fail('already_closed', `Property is already ${current}.`);
      if (current === 'on_hold') return fail('on_hold', 'Property is on hold. Release it before reserving.');
      if (current === 'reserved' && ctx.reservedByDealId !== a.dealId) return fail('reserved_by_other_deal', 'Property is already reserved for another deal.');
      return ok('reserved', a.dealId);
    }
    case 'complete_deal': {
      if (a.dealType !== ctx.propertyTransaction) return fail('transaction_mismatch', `This property is listed for ${ctx.propertyTransaction}, but the deal is a ${a.dealType}.`);
      if (closed) return fail('already_closed', `Property is already ${current}; a second completion conflicts with it.`);
      if (current === 'on_hold') return fail('on_hold', 'Property is on hold. Release it before completing a deal.');
      if (current === 'reserved' && ctx.reservedByDealId !== a.dealId) return fail('reserved_by_other_deal', 'Property is reserved for a different deal.');
      const others = ctx.activeDealIds.filter((d) => d !== a.dealId);
      const warnings = others.length ? [`${others.length} other open deal(s) on this property should be cancelled or closed.`] : [];
      return ok(a.dealType === 'sale' ? 'sold' : 'rented', null, warnings);
    }
    case 'cancel_deal': {
      if (closed) return fail('reopen_required', `Property is ${current}. Reopen it explicitly before cancelling the completed deal.`);
      const left = a.otherActiveDealIds.filter((d) => d !== a.dealId).length;
      if (current === 'reserved') {
        if (ctx.reservedByDealId !== a.dealId) return ok('reserved', ctx.reservedByDealId); // another deal's reservation is untouched
        return ok(left > 0 ? 'under_negotiation' : 'available');
      }
      if (current === 'under_negotiation') return ok(left > 0 ? 'under_negotiation' : 'available');
      return ok(current, ctx.reservedByDealId);
    }
    case 'hold': {
      if (current !== 'available') return fail('hold_not_available', `Only an available property can be put on hold (currently ${current}).`);
      return ok('on_hold');
    }
    case 'release': {
      if (current !== 'on_hold') return fail('not_on_hold', 'Property is not on hold.');
      return ok('available');
    }
    case 'reopen': {
      if (!closed) return fail('not_closed', 'Only a sold or rented property can be reopened.');
      if (!a.confirmed) return fail('confirmation_required', 'Reopening a completed transaction needs explicit confirmation.');
      return ok('available', null, ['Reopened after a completed transaction. The original deal and payments stay on record.']);
    }
  }
}

export function assertAvailabilityOk(r: AvailabilityResult): Extract<AvailabilityResult, { ok: true }> {
  if (!r.ok) throw new DomainError(r.code, r.message);
  return r;
}

// ---- listing status (marketing) — independent of availability ----
export const LISTING_STATUSES = ['draft', 'active', 'paused', 'expired', 'withdrawn', 'closed'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
const LISTING_NEXT: Record<ListingStatus, ListingStatus[]> = {
  draft: ['active', 'withdrawn'],
  active: ['paused', 'expired', 'withdrawn', 'closed'],
  paused: ['active', 'expired', 'withdrawn', 'closed'],
  expired: ['active', 'withdrawn'], // renew
  withdrawn: [],
  closed: [],
};
export const canMoveListing = (from: ListingStatus, to: ListingStatus) => LISTING_NEXT[from].includes(to);
