# EstateFlow business rules (implemented in `src/domain`, covered by `tests/domain.test.ts` and `tests/estate.test.ts`)

**Property ≠ Ownership ≠ Listing ≠ Availability ≠ Deal.** Each has its own table.

## Area units (`units.ts`)
Marla and Kanal are not universal, so every property stores value, unit **and basis**:
- `revenue`: 1 Marla = 272.25 sq ft, 1 Kanal = 20 Marla = 5,445 sq ft, 8 Kanal = 1 Acre
- `society`: 1 Marla = 225 sq ft, 1 Kanal = 20 Marla = 4,500 sq ft
- Sq Yd = 9 sq ft, Acre = 43,560 sq ft (fixed)

A normalised `area_sqft` is stored for filtering and sorting. The UI must make the user pick the basis; nothing is guessed.

## Availability (`availability.ts`)
States: available, under_negotiation, reserved, sold, rented, on_hold. Independent of listing status.
- Buyer interest never reserves. Reserve needs an explicit, confirmed action.
- A second reservation or completion on a reserved/closed property is a conflict and is returned (not applied).
- Negotiating on a property reserved for another deal warns and keeps the reservation.
- Completing a deal needs the matching transaction type (sale to sold, rent to rented) and warns about other open deals.
- Cancelling a deal never rewrites history; cancelling the deal that closed a property needs an explicit **reopen**.
- Every change writes an append-only `availability_history` row.

## Listings
Many simultaneous listings per property (different dealers/prices/terms). Status machine: draft, active, paused, expired, withdrawn, closed (withdrawn/closed are terminal; expired can be renewed). Every change writes `listing_history`. Asking price is a whole-rupee integer; the restricted minimum price cannot exceed it.

## Ownership (`ownership.ts`)
Joint owners must add up to 100% (0.005 tolerance), no duplicates. A change end-dates the old rows and inserts new ones; rows are never edited or deleted (trigger-enforced). Verification is dealer-entered (`unverified`/`documents_seen`/`dealer_verified`). EstateFlow does not certify legal title.

## Commission (`commission.ts`)
Integer PKR; percentages as basis points; round half up. Buyer-side and seller-side terms. Shares are percentage **or** fixed (never mixed) and must add up exactly (largest-remainder rounding). A finalised agreement is a frozen snapshot stored in `commission_agreements`/`commission_shares`, which triggers make immutable, so later setting changes cannot alter old deals. Payouts cannot exceed a participant's remaining share.

## Finance (`finance.ts`)
`payments` and `expenses` are append-only (no delete, no edit of amount/kind/date/party). A correction is a reversal row (`reversal_of`, one per original). Buckets are kept apart: buyer funds (token, bayana, installment, buyer_payment minus refunds), seller pass-through, and the dealer's own commission received/paid. Installments split evenly with the remainder on the last one; month-end dates clamp (31 Jan to 28 Feb).

## Duplicates
Same society + phase + block + plot number + category (case-insensitive) is *suggested*, never merged.
