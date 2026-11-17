import assert from 'node:assert/strict';
import { createNodeDb } from './nodeDb';
import { initRepo, getDb, Repo } from '../src/db/repo';
import { migrate, SCHEMA_VERSION } from '../src/db/schema';
import { PropertyRepo } from '../src/db/propertyRepo';
import { DomainError } from '../src/domain/errors';

const rejects = async (p: Promise<any>, match: RegExp | string) => {
  try { await p; } catch (e: any) { assert.match(`${e.code} ${e.message}`, typeof match === 'string' ? new RegExp(match) : match); return; }
  assert.fail('expected rejection: ' + match);
};

(async () => {
  // ---- migration: v1 (inherited RetailX data) survives the upgrade to the EstateFlow schema
  {
    const db = createNodeDb();
    await migrate(db, 1);
    await db.runAsync("INSERT INTO customers (name, phone, created_at, updated_at) VALUES ('Legacy Ali', '0300', 1, 1)");
    await db.runAsync("INSERT INTO followups (title, due_at, created_at) VALUES ('Call back', 5, 1)");
    await migrate(db);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    assert.equal(v!.user_version, SCHEMA_VERSION); assert.ok(SCHEMA_VERSION >= 3);
    const c = await db.getFirstAsync<any>('SELECT * FROM customers WHERE name = ?', ['Legacy Ali']);
    assert.equal(c.phone, '0300'); assert.equal(c.whatsapp, ''); assert.equal(c.cnic, '');
    assert.equal((await db.getAllAsync('SELECT * FROM followups')).length, 1);
    await migrate(db); // idempotent
  }

  await initRepo(createNodeDb());
  const db = getDb();
  const seller = await Repo.saveCustomer({ name: 'Seller One', phone: '0300 1111111' });
  const seller2 = await Repo.saveCustomer({ name: 'Seller Two' });
  const dealerA = await Repo.saveCustomer({ name: 'Dealer A' }), dealerB = await Repo.saveCustomer({ name: 'Dealer B' });
  const buyer = await Repo.saveCustomer({ name: 'Buyer One' });

  // ---- property create / edit / identity
  const p1 = await PropertyRepo.createProperty({ title: '10 Marla Plot', category: 'residential_plot', society: 'DHA', phase: '6', block: 'K', plotNo: '123', city: 'Lahore', areaValue: 10, areaUnit: 'marla', marlaBasis: 'society' });
  const p2 = await PropertyRepo.createProperty({ title: '1 Kanal House', category: 'house', society: 'Bahria Town', city: 'Lahore', areaValue: 1, areaUnit: 'kanal', bedrooms: 5, bathrooms: 5, utilities: ['gas', 'electricity'], transactionType: 'sale' });
  const p3 = await PropertyRepo.createProperty({ title: 'Shop F-7', category: 'shop', city: 'Islamabad', areaValue: 400, areaUnit: 'sqft', transactionType: 'rent' });
  const prop1 = (await PropertyRepo.getProperty(p1))!;
  assert.equal(prop1.code, 'PR-000001'); assert.equal(prop1.areaSqft, 2250); assert.equal(prop1.availability, 'available');
  assert.equal((await PropertyRepo.getProperty(p2))!.areaSqft, 5445);
  assert.deepEqual((await PropertyRepo.getProperty(p2))!.utilities, ['gas', 'electricity']);
  await rejects(PropertyRepo.createProperty({ title: ' ', category: 'house', areaValue: 5, areaUnit: 'marla' }), 'title');
  await rejects(PropertyRepo.createProperty({ title: 'x', category: 'house', areaValue: 0, areaUnit: 'marla' }), 'area');
  await rejects(PropertyRepo.createProperty({ title: 'x', category: 'house', areaValue: 5, areaUnit: 'marla', latitude: 95, longitude: 10 }), 'coordinates');
  await rejects(PropertyRepo.createProperty({ title: 'x', category: 'villa' as any, areaValue: 5, areaUnit: 'marla' }), 'category');
  assert.equal((await db.getAllAsync('SELECT id FROM properties')).length, 3, 'rejected inputs leave no rows');
  await PropertyRepo.updateProperty(p1, { title: '10 Marla Corner Plot', category: 'residential_plot', society: 'DHA', phase: '6', block: 'K', plotNo: '123', city: 'Lahore', areaValue: 11, areaUnit: 'marla', marlaBasis: 'society' });
  const upd = (await PropertyRepo.getProperty(p1))!;
  assert.equal(upd.title, '10 Marla Corner Plot'); assert.equal(upd.areaSqft, 2475); assert.equal(upd.code, 'PR-000001');

  // ---- search / filter / pagination
  assert.equal((await PropertyRepo.listProperties({ q: 'dha' })).length, 1);
  assert.equal((await PropertyRepo.listProperties({ q: 'PR-000002' }))[0].id, p2);
  assert.equal((await PropertyRepo.listProperties({ city: 'lahore' })).length, 2);
  assert.equal((await PropertyRepo.listProperties({ category: 'shop', transactionType: 'rent' })).length, 1);
  assert.deepEqual((await PropertyRepo.listProperties({ minSqft: 3000 })).map((p) => p.id), [p2]);
  assert.equal((await PropertyRepo.listProperties({ q: '100%' })).length, 0, 'LIKE wildcards are escaped');
  assert.deepEqual((await PropertyRepo.listProperties({ sort: 'oldest', limit: 2 })).map((p) => p.id), [p1, p2]);
  assert.deepEqual((await PropertyRepo.listProperties({ sort: 'oldest', limit: 2, offset: 2 })).map((p) => p.id), [p3]);
  await PropertyRepo.archiveProperty(p3);
  assert.equal((await PropertyRepo.listProperties()).length, 2); assert.equal((await PropertyRepo.listProperties({ includeArchived: true })).length, 3);
  await PropertyRepo.archiveProperty(p3, false);

  // ---- duplicates are suggested, never merged; independent records stay possible
  const dup = await PropertyRepo.createProperty({ title: 'Same plot, other dealer', category: 'residential_plot', society: 'dha', phase: '6', block: 'k', plotNo: '123', city: 'Lahore', areaValue: 10, areaUnit: 'marla' });
  assert.deepEqual((await PropertyRepo.findPossibleDuplicates({ society: 'DHA', phase: '6', block: 'K', plotNo: '123', category: 'residential_plot' }, dup)).map((p) => p.id), [p1]);
  assert.deepEqual(await PropertyRepo.findPossibleDuplicates({ society: '', plotNo: '', category: 'house' }), []);
  assert.equal((await PropertyRepo.listProperties()).length, 4, 'both records exist');

  // ---- ownership: joint owners, validation, history preserved
  await rejects(PropertyRepo.setOwnership(p1, [{ personId: seller, percentage: 60 }], '2025-01-01'), 'owner_sum');
  await PropertyRepo.setOwnership(p1, [{ personId: seller, percentage: 60 }, { personId: seller2, percentage: 40, verification: 'documents_seen' }], '2025-01-01');
  let own = await PropertyRepo.getOwnership(p1);
  assert.equal(own.current.length, 2); assert.equal(own.history.length, 0);
  assert.ok((await db.getAllAsync("SELECT 1 FROM person_roles WHERE person_id = ? AND role = 'owner'", [seller])).length === 1);
  await PropertyRepo.setOwnership(p1, [{ personId: buyer, percentage: 100 }], '2026-06-01');
  own = await PropertyRepo.getOwnership(p1);
  assert.deepEqual(own.current.map((o) => o.personName), ['Buyer One']);
  assert.equal(own.history.length, 2); assert.ok(own.history.every((o) => o.endDate === '2026-06-01'));
  await rejects(db.runAsync('DELETE FROM ownerships WHERE id = 1'), 'append-only');
  await rejects(Repo.deleteCustomer ? Repo.deleteCustomer(seller) : db.runAsync('DELETE FROM customers WHERE id = ?', [seller]), /FOREIGN KEY|constraint/i);
  await rejects(db.runAsync("INSERT INTO ownerships (property_id, person_id, percentage, start_date, created_at) VALUES (?,?,150,'2026-01-01',1)", [p1, seller]), /CHECK/i);

  // ---- multiple simultaneous listings, independent of availability
  const l1 = await PropertyRepo.createListing({ propertyId: p2, dealerId: dealerA, ownerId: seller, askingPrice: 65_000_000, minPrice: 62_000_000, commissionType: 'percent', commissionValue: 2, startDate: '2026-11-01', expiryDate: '2026-11-20', status: 'active' });
  const l2 = await PropertyRepo.createListing({ propertyId: p2, dealerId: dealerB, askingPrice: 66_500_000, source: 'dealer', status: 'active' });
  await rejects(PropertyRepo.createListing({ propertyId: p2, askingPrice: 100, minPrice: 200 }), 'min_price');
  await rejects(PropertyRepo.createListing({ propertyId: p2, askingPrice: 1.5 }), 'asking_price');
  await rejects(PropertyRepo.createListing({ propertyId: p2, askingPrice: 100, startDate: '2026-02-01', expiryDate: '2026-01-01' }), 'expiry');
  await rejects(PropertyRepo.createListing({ propertyId: 999, askingPrice: 100 }), 'not_found');
  assert.equal((await PropertyRepo.listingsForProperty(p2)).length, 2);
  assert.deepEqual((await PropertyRepo.listProperties({ dealerId: dealerB })).map((p) => p.id), [p2]);
  assert.deepEqual((await PropertyRepo.listProperties({ minPrice: 66_000_000 })).map((p) => p.id), [p2]);
  assert.equal((await PropertyRepo.listProperties({ maxPrice: 60_000_000 })).length, 0);
  await PropertyRepo.changeListingStatus(l1, 'paused', 'owner asked'); await PropertyRepo.changeListingStatus(l1, 'active');
  await rejects(PropertyRepo.changeListingStatus(l1, 'draft'), 'listing_transition');
  await PropertyRepo.changeListingStatus(l2, 'withdrawn');
  await rejects(PropertyRepo.changeListingStatus(l2, 'active'), 'listing_transition');
  assert.deepEqual((await PropertyRepo.listingHistory(l1)).map((h) => h.to_status), ['active', 'paused', 'active']);
  assert.deepEqual((await PropertyRepo.expiringListings('2026-11-25')).map((x) => x.id), [l1]);
  assert.deepEqual(await PropertyRepo.expiringListings('2026-10-01'), []);
  assert.equal((await PropertyRepo.getProperty(p2))!.availability, 'available', 'listing status never changes availability');

  // ---- availability driven by real deals
  const mkDeal = async (propertyId: number, type = 'sale') => (await db.runAsync(
    "INSERT INTO deals (code, property_id, buyer_id, seller_id, transaction_type, created_at, updated_at) VALUES (?,?,?,?,?,1,1)", [`D-${Math.random()}`, propertyId, buyer, seller, type])).lastInsertRowId;
  const d1 = await mkDeal(p2), d2 = await mkDeal(p2);
  let r = await PropertyRepo.applyAvailability(p2, { type: 'start_negotiation', dealId: d1 });
  assert.ok(r.ok && r.to === 'under_negotiation');
  assert.equal((await PropertyRepo.listingsForProperty(p2)).filter((l) => l.status === 'active').length, 1, 'listing stays active while under negotiation');
  r = await PropertyRepo.applyAvailability(p2, { type: 'reserve', dealId: d1, confirmed: false });
  assert.ok(!r.ok && r.code === 'confirmation_required');
  assert.equal((await PropertyRepo.getProperty(p2))!.availability, 'under_negotiation');
  r = await PropertyRepo.applyAvailability(p2, { type: 'reserve', dealId: d1, confirmed: true }, 'token paid');
  assert.ok(r.ok && r.to === 'reserved'); assert.equal((await PropertyRepo.getProperty(p2))!.reservedByDealId, d1);
  r = await PropertyRepo.applyAvailability(p2, { type: 'reserve', dealId: d2, confirmed: true });
  assert.ok(!r.ok && r.code === 'reserved_by_other_deal');
  r = await PropertyRepo.applyAvailability(p2, { type: 'complete_deal', dealId: d2, dealType: 'sale' });
  assert.ok(!r.ok && r.code === 'reserved_by_other_deal');
  r = await PropertyRepo.applyAvailability(p2, { type: 'complete_deal', dealId: d1, dealType: 'sale' });
  assert.ok(r.ok && r.to === 'sold' && r.warnings.length === 1);
  const sold = (await PropertyRepo.getProperty(p2))!; assert.equal(sold.availability, 'sold'); assert.equal(sold.reservedByDealId, null);
  r = await PropertyRepo.applyAvailability(p2, { type: 'complete_deal', dealId: d2, dealType: 'sale' });
  assert.ok(!r.ok && r.code === 'already_closed', 'a second completion conflicts');
  const hist = await PropertyRepo.availabilityHistory(p2);
  assert.deepEqual(hist.map((h) => h.to_state), ['under_negotiation', 'reserved', 'sold']);
  assert.equal(hist[1].reason, 'token paid');
  await rejects(db.runAsync('UPDATE availability_history SET to_state = ? WHERE id = 1', ['available']), 'append-only');
  await rejects(db.runAsync('DELETE FROM availability_history'), 'append-only');
  // cancelling the completed deal needs an explicit reopen; the deal itself is never deleted
  r = await PropertyRepo.applyAvailability(p2, { type: 'cancel_deal', dealId: d1, otherActiveDealIds: [] });
  assert.ok(!r.ok && r.code === 'reopen_required');
  r = await PropertyRepo.applyAvailability(p2, { type: 'reopen', confirmed: true }, 'buyer defaulted');
  assert.ok(r.ok && r.to === 'available');
  await rejects(PropertyRepo.applyAvailability(999, { type: 'hold' }), 'not_found');
  const rent = await mkDeal(p3, 'rent');
  r = await PropertyRepo.applyAvailability(p3, { type: 'complete_deal', dealId: rent, dealType: 'rent' });
  assert.ok(r.ok && r.to === 'rented');

  // ---- finance tables are append-only; corrections are reversal rows
  const dealRow = d2;
  const ins = (code: string, kind: string, amount: number, reversalOf: number | null = null) => db.runAsync(
    'INSERT INTO payments (code, deal_id, person_id, kind, amount, paid_at, reversal_of, created_at) VALUES (?,?,?,?,?,?,?,?)', [code, dealRow, buyer, kind, amount, 10, reversalOf, 10]);
  const pay1 = (await ins('RC-1', 'token', 500_000)).lastInsertRowId;
  await rejects(db.runAsync('UPDATE payments SET amount = 1 WHERE id = ?', [pay1]), 'append-only');
  await rejects(db.runAsync('UPDATE payments SET kind = ? WHERE id = ?', ['refund', pay1]), 'append-only');
  await rejects(db.runAsync('DELETE FROM payments WHERE id = ?', [pay1]), 'append-only');
  await rejects(ins('RC-2', 'token', 0), /CHECK/i);
  await rejects(ins('RC-3', 'cash_bonus', 5), /CHECK/i);
  await db.runAsync('UPDATE payments SET notes = ? WHERE id = ?', ['receipt re-scanned', pay1]); // non-financial annotation is allowed
  await ins('RC-4', 'token', 500_000, pay1);
  await rejects(ins('RC-5', 'token', 500_000, pay1), /UNIQUE/i);
  await rejects(db.runAsync("INSERT INTO expenses (category, amount, spent_at, created_at) VALUES ('office', -5, 1, 1)"), /CHECK/i);
  const ex = (await db.runAsync("INSERT INTO expenses (category, amount, spent_at, created_at) VALUES ('marketing', 5000, 1, 1)")).lastInsertRowId;
  await rejects(db.runAsync('UPDATE expenses SET amount = 1 WHERE id = ?', [ex]), 'append-only');
  await rejects(db.runAsync('DELETE FROM expenses WHERE id = ?', [ex]), 'append-only');
  // commission agreements are immutable snapshots
  const agr = (await db.runAsync("INSERT INTO commission_agreements (deal_id, total_amount, snapshot, finalized_at) VALUES (?, 200000, '{}', 1)", [d2])).lastInsertRowId;
  await rejects(db.runAsync('UPDATE commission_agreements SET total_amount = 1 WHERE id = ?', [agr]), 'immutable');
  await rejects(db.runAsync('DELETE FROM commission_agreements WHERE id = ?', [agr]), 'immutable');
  const sh = (await db.runAsync("INSERT INTO commission_shares (agreement_id, person_id, role, amount, share_bps) VALUES (?,?,?,?,?)", [agr, dealerA, 'listing_dealer', 120_000, 6000])).lastInsertRowId;
  await rejects(db.runAsync('UPDATE commission_shares SET amount = 1 WHERE id = ?', [sh]), 'immutable');
  // a cancelled deal keeps its history: deals with payments cannot be deleted
  await rejects(db.runAsync('DELETE FROM deals WHERE id = ?', [d2]), /FOREIGN KEY|constraint/i);

  // ---- data-safety guard: a legacy-table wipe/restore must not silently destroy EstateFlow data
  await rejects(Repo.eraseAll(), 'estateDataPresent');
  assert.equal((await db.getAllAsync('SELECT id FROM properties')).length, 5 - 1, 'nothing was erased');

  // ---- empty database still erases cleanly
  await initRepo(createNodeDb());
  await Repo.saveCustomer({ name: 'Only legacy data' });
  await Repo.eraseAll();
  assert.equal((await Repo.listCustomers()).length, 0);
  console.log('estate tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
