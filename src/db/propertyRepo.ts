// EstateFlow property domain data layer: properties, ownership, listings, availability.
// Uses the same Db interface/transactions as the inherited CRM repo, so it runs on expo-sqlite and node:sqlite alike.
import { getDb } from './repo';
import { assertDomain, DomainError } from '../domain/errors';
import { AreaUnit, MarlaBasis, toSqft, AREA_UNITS, MARLA_BASES } from '../domain/units';
import { Availability, AvailabilityAction, AvailabilityResult, ListingStatus, LISTING_STATUSES, TransactionType, canMoveListing, transitionAvailability } from '../domain/availability';
import { NewOwner, OwnershipRow, planOwnershipTransfer, validateOwnerSet } from '../domain/ownership';

export const PROPERTY_CATEGORIES = ['residential_plot', 'commercial_plot', 'house', 'apartment', 'agricultural_land', 'shop', 'office', 'commercial_building', 'property_file', 'other'] as const;
export type PropertyCategory = (typeof PROPERTY_CATEGORIES)[number];

export interface PropertyInput {
  title: string; category: PropertyCategory; transactionType?: TransactionType;
  province?: string; city?: string; area?: string; society?: string; phase?: string; block?: string; street?: string; plotNo?: string; address?: string;
  latitude?: number | null; longitude?: number | null;
  areaValue: number; areaUnit: AreaUnit; marlaBasis?: MarlaBasis;
  front?: number | null; depth?: number | null; coveredArea?: number | null; floors?: number | null; bedrooms?: number | null; bathrooms?: number | null;
  constructionStatus?: string; condition?: string; facing?: string; utilities?: string[]; parking?: string; amenities?: string[];
  description?: string; notes?: string; registeredAt?: string;
}

export interface Property extends Required<Pick<PropertyInput, 'title' | 'category' | 'areaValue' | 'areaUnit'>> {
  id: number; code: string; transactionType: TransactionType; availability: Availability; reservedByDealId: number | null; recordStatus: 'active' | 'archived';
  marlaBasis: MarlaBasis; areaSqft: number; province: string; city: string; area: string; society: string; phase: string; block: string; street: string; plotNo: string; address: string;
  latitude: number | null; longitude: number | null; front: number | null; depth: number | null; coveredArea: number | null; floors: number | null; bedrooms: number | null; bathrooms: number | null;
  constructionStatus: string; condition: string; facing: string; utilities: string[]; parking: string; amenities: string[]; description: string; notes: string; registeredAt: string;
  createdAt: number; updatedAt: number;
}

const now = () => Date.now();
const json = <T,>(s: any, f: T): T => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const s = (v: string | undefined) => (v ?? '').trim();

const toProperty = (r: any): Property => ({
  id: r.id, code: r.code, title: r.title, category: r.category, transactionType: r.transaction_type, availability: r.availability, reservedByDealId: r.reserved_by_deal_id ?? null,
  recordStatus: r.record_status, marlaBasis: r.marla_basis, areaValue: r.area_value, areaUnit: r.area_unit, areaSqft: r.area_sqft,
  province: r.province, city: r.city, area: r.area, society: r.society, phase: r.phase, block: r.block, street: r.street, plotNo: r.plot_no, address: r.address,
  latitude: r.latitude ?? null, longitude: r.longitude ?? null, front: r.front ?? null, depth: r.depth ?? null, coveredArea: r.covered_area ?? null,
  floors: r.floors ?? null, bedrooms: r.bedrooms ?? null, bathrooms: r.bathrooms ?? null,
  constructionStatus: r.construction_status, condition: r.condition, facing: r.facing, utilities: json(r.utilities, []), parking: r.parking, amenities: json(r.amenities, []),
  description: r.description, notes: r.notes, registeredAt: r.registered_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

function validateProperty(i: PropertyInput) {
  assertDomain(s(i.title).length > 0, 'title', 'Property title is required');
  assertDomain((PROPERTY_CATEGORIES as readonly string[]).includes(i.category), 'category', 'Choose a property category');
  assertDomain((AREA_UNITS as readonly string[]).includes(i.areaUnit), 'unit', 'Choose an area unit');
  assertDomain(!i.marlaBasis || (MARLA_BASES as readonly string[]).includes(i.marlaBasis), 'basis', 'Unknown Marla basis');
  if (i.latitude != null || i.longitude != null) {
    assertDomain(i.latitude != null && i.longitude != null && Math.abs(i.latitude) <= 90 && Math.abs(i.longitude) <= 180, 'coordinates', 'Coordinates are invalid');
  }
  for (const [k, v] of Object.entries({ front: i.front, depth: i.depth, coveredArea: i.coveredArea })) assertDomain(v == null || (Number.isFinite(v) && v > 0), k, `${k} must be a positive number`);
  for (const [k, v] of Object.entries({ floors: i.floors, bedrooms: i.bedrooms, bathrooms: i.bathrooms })) assertDomain(v == null || (Number.isInteger(v) && v >= 0), k, `${k} must be a whole number`);
}

function columns(i: PropertyInput) {
  const basis = i.marlaBasis ?? 'revenue';
  return {
    title: s(i.title), category: i.category, transaction_type: i.transactionType ?? 'sale', country: 'Pakistan',
    province: s(i.province), city: s(i.city), area: s(i.area), society: s(i.society), phase: s(i.phase), block: s(i.block), street: s(i.street), plot_no: s(i.plotNo), address: s(i.address),
    latitude: i.latitude ?? null, longitude: i.longitude ?? null,
    area_value: i.areaValue, area_unit: i.areaUnit, marla_basis: basis, area_sqft: toSqft(i.areaValue, i.areaUnit, basis),
    front: i.front ?? null, depth: i.depth ?? null, covered_area: i.coveredArea ?? null, floors: i.floors ?? null, bedrooms: i.bedrooms ?? null, bathrooms: i.bathrooms ?? null,
    construction_status: s(i.constructionStatus), condition: s(i.condition), facing: s(i.facing), utilities: JSON.stringify(i.utilities ?? []), parking: s(i.parking),
    amenities: JSON.stringify(i.amenities ?? []), description: s(i.description), notes: s(i.notes), registered_at: s(i.registeredAt),
  };
}

export interface PropertyFilter {
  q?: string; city?: string; area?: string; society?: string; phase?: string; block?: string; category?: PropertyCategory; transactionType?: TransactionType;
  availability?: Availability; minSqft?: number; maxSqft?: number; dealerId?: number; minPrice?: number; maxPrice?: number; includeArchived?: boolean;
  sort?: 'newest' | 'oldest' | 'area_desc'; limit?: number; offset?: number;
}

export const PropertyRepo = {
  // ---------- properties ----------
  async createProperty(i: PropertyInput): Promise<number> {
    validateProperty(i);
    const db = getDb(), c = columns(i), t = now();
    let id = 0;
    await db.withTransactionAsync(async () => {
      const keys = Object.keys(c);
      const res = await db.runAsync(
        `INSERT INTO properties (code, ${keys.join(',')}, created_at, updated_at) VALUES (?, ${keys.map(() => '?').join(',')}, ?, ?)`,
        [`TMP-${t}-${Math.random().toString(36).slice(2, 8)}`, ...keys.map((k) => (c as any)[k]), t, t],
      );
      id = res.lastInsertRowId;
      await db.runAsync('UPDATE properties SET code = ? WHERE id = ?', [`PR-${String(id).padStart(6, '0')}`, id]); // permanent internal identity
    });
    return id;
  },
  async updateProperty(id: number, i: PropertyInput): Promise<void> {
    validateProperty(i);
    const db = getDb(), c = columns(i);
    const cur = await db.getFirstAsync<any>('SELECT id FROM properties WHERE id = ?', [id]);
    assertDomain(cur, 'not_found', 'Property not found');
    const keys = Object.keys(c);
    // availability, code and ownership are deliberately NOT editable here: they have their own audited flows.
    await db.runAsync(`UPDATE properties SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => (c as any)[k]), now(), id]);
  },
  async archiveProperty(id: number, archived = true) {
    await getDb().runAsync('UPDATE properties SET record_status = ?, updated_at = ? WHERE id = ?', [archived ? 'archived' : 'active', now(), id]);
  },
  async getProperty(id: number): Promise<Property | null> {
    const r = await getDb().getFirstAsync<any>('SELECT * FROM properties WHERE id = ?', [id]);
    return r ? toProperty(r) : null;
  },
  async listProperties(f: PropertyFilter = {}): Promise<Property[]> {
    const where: string[] = [], p: any[] = [];
    if (!f.includeArchived) where.push("p.record_status = 'active'");
    if (f.q?.trim()) {
      const l = like(f.q.trim());
      where.push(`(p.title LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.society LIKE ? ESCAPE '\\' OR p.area LIKE ? ESCAPE '\\' OR p.city LIKE ? ESCAPE '\\' OR p.plot_no LIKE ? ESCAPE '\\' OR p.address LIKE ? ESCAPE '\\')`);
      p.push(l, l, l, l, l, l, l);
    }
    const eq = (col: string, v: any) => { if (v !== undefined && v !== '') { where.push(`${col} = ? COLLATE NOCASE`); p.push(v); } };
    eq('p.city', f.city); eq('p.area', f.area); eq('p.society', f.society); eq('p.phase', f.phase); eq('p.block', f.block);
    if (f.category) { where.push('p.category = ?'); p.push(f.category); }
    if (f.transactionType) { where.push('p.transaction_type = ?'); p.push(f.transactionType); }
    if (f.availability) { where.push('p.availability = ?'); p.push(f.availability); }
    if (f.minSqft != null) { where.push('p.area_sqft >= ?'); p.push(f.minSqft); }
    if (f.maxSqft != null) { where.push('p.area_sqft <= ?'); p.push(f.maxSqft); }
    if (f.dealerId != null || f.minPrice != null || f.maxPrice != null) {
      const sub: string[] = ["l.property_id = p.id", "l.status = 'active'"]; const sp: any[] = [];
      if (f.dealerId != null) { sub.push('l.dealer_id = ?'); sp.push(f.dealerId); }
      if (f.minPrice != null) { sub.push('l.asking_price >= ?'); sp.push(f.minPrice); }
      if (f.maxPrice != null) { sub.push('l.asking_price <= ?'); sp.push(f.maxPrice); }
      where.push(`EXISTS (SELECT 1 FROM listings l WHERE ${sub.join(' AND ')})`); p.push(...sp);
    }
    const order = f.sort === 'oldest' ? 'p.created_at ASC, p.id ASC' : f.sort === 'area_desc' ? 'p.area_sqft DESC, p.id DESC' : 'p.created_at DESC, p.id DESC';
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200), offset = Math.max(f.offset ?? 0, 0);
    const rows = await getDb().getAllAsync<any>(`SELECT p.* FROM properties p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ? OFFSET ?`, [...p, limit, offset]);
    return rows.map(toProperty);
  },
  /** Suggest (never merge) properties that look like the same real-world property. Independent records stay possible. */
  async findPossibleDuplicates(i: Pick<PropertyInput, 'society' | 'block' | 'plotNo' | 'category' | 'phase'>, excludeId?: number): Promise<Property[]> {
    if (!s(i.society) || !s(i.plotNo)) return [];
    const rows = await getDb().getAllAsync<any>(
      `SELECT * FROM properties WHERE society = ? COLLATE NOCASE AND plot_no = ? COLLATE NOCASE AND block = ? COLLATE NOCASE AND phase = ? COLLATE NOCASE AND category = ? AND id != ? ORDER BY id`,
      [s(i.society), s(i.plotNo), s(i.block), s(i.phase), i.category, excludeId ?? -1],
    );
    return rows.map(toProperty);
  },

  // ---------- ownership ----------
  async getOwnership(propertyId: number) {
    const rows = await getDb().getAllAsync<any>(
      `SELECT o.*, c.name AS person_name FROM ownerships o JOIN customers c ON c.id = o.person_id WHERE o.property_id = ? ORDER BY o.start_date DESC, o.id DESC`, [propertyId]);
    const map = (r: any) => ({ id: r.id, personId: r.person_id, personName: r.person_name as string, percentage: r.percentage as number, startDate: r.start_date as string, endDate: (r.end_date ?? null) as string | null, verification: r.verification_status as string, notes: r.notes as string });
    const all = rows.map(map);
    return { current: all.filter((o) => o.endDate === null), history: all.filter((o) => o.endDate !== null) };
  },
  /** First owners or a change of owners. Old rows are end-dated, never edited or deleted. Every owner gets the 'owner' role. */
  async setOwnership(propertyId: number, owners: NewOwner[], effectiveDate: string): Promise<void> {
    const db = getDb();
    const existing = await db.getAllAsync<any>('SELECT id, person_id, percentage, start_date, end_date FROM ownerships WHERE property_id = ?', [propertyId]);
    const rows: OwnershipRow[] = existing.map((r) => ({ id: r.id, personId: r.person_id, percentage: r.percentage, startDate: r.start_date, endDate: r.end_date ?? null }));
    const plan = planOwnershipTransfer(rows, owners, effectiveDate);
    await db.withTransactionAsync(async () => {
      for (const id of plan.closeIds) await db.runAsync('UPDATE ownerships SET end_date = ? WHERE id = ?', [plan.endDate, id]);
      for (const o of plan.insert) {
        await db.runAsync('INSERT INTO ownerships (property_id, person_id, percentage, start_date, verification_status, notes, created_at) VALUES (?,?,?,?,?,?,?)',
          [propertyId, o.personId, o.percentage, effectiveDate, o.verification ?? 'unverified', o.notes ?? '', now()]);
        await db.runAsync("INSERT OR IGNORE INTO person_roles (person_id, role, created_at) VALUES (?, 'owner', ?)", [o.personId, now()]);
      }
    });
  },
  async setOwnerVerification(ownershipId: number, v: 'unverified' | 'documents_seen' | 'dealer_verified') {
    await getDb().runAsync('UPDATE ownerships SET verification_status = ? WHERE id = ?', [v, ownershipId]);
  },

  // ---------- listings ----------
  async createListing(i: { propertyId: number; source?: string; dealerId?: number | null; ownerId?: number | null; askingPrice: number; minPrice?: number | null; commissionType?: 'none' | 'fixed' | 'percent'; commissionValue?: number; commissionTerms?: string; startDate?: string; expiryDate?: string; marketingPermissions?: string; description?: string; status?: ListingStatus }): Promise<number> {
    assertDomain(Number.isInteger(i.askingPrice) && i.askingPrice >= 0, 'asking_price', 'Asking price must be a whole number of rupees');
    assertDomain(i.minPrice == null || (Number.isInteger(i.minPrice) && i.minPrice >= 0 && i.minPrice <= i.askingPrice), 'min_price', 'Minimum acceptable price cannot be above the asking price');
    assertDomain(!i.startDate || !i.expiryDate || i.expiryDate >= i.startDate, 'expiry', 'Expiry date is before the start date');
    const db = getDb(), t = now();
    assertDomain(await db.getFirstAsync('SELECT id FROM properties WHERE id = ?', [i.propertyId]), 'not_found', 'Property not found');
    const status = i.status ?? 'draft';
    assertDomain(status === 'draft' || status === 'active', 'listing_status', 'A new listing starts as draft or active');
    let id = 0;
    await db.withTransactionAsync(async () => {
      const res = await db.runAsync(
        `INSERT INTO listings (code, property_id, source, dealer_id, owner_id, asking_price, min_price, commission_type, commission_value, commission_terms, start_date, expiry_date, marketing_permissions, description, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`TMP-${t}-${Math.random().toString(36).slice(2, 8)}`, i.propertyId, i.source ?? 'own', i.dealerId ?? null, i.ownerId ?? null, i.askingPrice, i.minPrice ?? null,
          i.commissionType ?? 'none', i.commissionValue ?? 0, s(i.commissionTerms), s(i.startDate), s(i.expiryDate), s(i.marketingPermissions), s(i.description), status, t, t]);
      id = res.lastInsertRowId;
      await db.runAsync('UPDATE listings SET code = ? WHERE id = ?', [`LS-${String(id).padStart(6, '0')}`, id]);
      await db.runAsync('INSERT INTO listing_history (listing_id, from_status, to_status, note, at) VALUES (?,?,?,?,?)', [id, null, status, 'Created', t]);
    });
    return id;
  },
  async changeListingStatus(listingId: number, to: ListingStatus, note = ''): Promise<void> {
    assertDomain((LISTING_STATUSES as readonly string[]).includes(to), 'listing_status', 'Unknown listing status');
    const db = getDb();
    const cur = await db.getFirstAsync<{ status: ListingStatus }>('SELECT status FROM listings WHERE id = ?', [listingId]);
    assertDomain(cur, 'not_found', 'Listing not found');
    assertDomain(canMoveListing(cur!.status, to), 'listing_transition', `A ${cur!.status} listing cannot become ${to}`);
    const t = now();
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [to, t, listingId]);
      await db.runAsync('INSERT INTO listing_history (listing_id, from_status, to_status, note, at) VALUES (?,?,?,?,?)', [listingId, cur!.status, to, note, t]);
    });
  },
  async listingsForProperty(propertyId: number) {
    return (await getDb().getAllAsync<any>('SELECT * FROM listings WHERE property_id = ? ORDER BY created_at DESC, id DESC', [propertyId]))
      .map((r) => ({ id: r.id as number, code: r.code as string, dealerId: (r.dealer_id ?? null) as number | null, askingPrice: r.asking_price as number, minPrice: (r.min_price ?? null) as number | null, status: r.status as ListingStatus, expiryDate: r.expiry_date as string, source: r.source as string }));
  },
  async listingHistory(listingId: number) {
    return getDb().getAllAsync<{ from_status: string | null; to_status: string; note: string; at: number }>('SELECT from_status, to_status, note, at FROM listing_history WHERE listing_id = ? ORDER BY at, id', [listingId]);
  },
  /** Active listings whose expiry date falls on or before `isoDate` (YYYY-MM-DD) — for reminders and the dashboard. */
  async expiringListings(isoDate: string) {
    return getDb().getAllAsync<{ id: number; code: string; property_id: number; expiry_date: string }>(
      "SELECT id, code, property_id, expiry_date FROM listings WHERE status = 'active' AND expiry_date != '' AND expiry_date <= ? ORDER BY expiry_date", [isoDate]);
  },

  // ---------- availability ----------
  /** Apply a business action to a property's availability. Writes an audit row; returns the rule result (conflicts are returned, not thrown). */
  async applyAvailability(propertyId: number, action: AvailabilityAction, reason = ''): Promise<AvailabilityResult> {
    const db = getDb();
    let result: AvailabilityResult = { ok: false, code: 'unknown', message: 'Not applied' };
    await db.withTransactionAsync(async () => {
      const p = await db.getFirstAsync<any>('SELECT availability, reserved_by_deal_id, transaction_type FROM properties WHERE id = ?', [propertyId]);
      assertDomain(p, 'not_found', 'Property not found');
      const active = await db.getAllAsync<{ id: number }>("SELECT id FROM deals WHERE property_id = ? AND stage NOT IN ('completed','cancelled')", [propertyId]);
      result = transitionAvailability({ current: p.availability, reservedByDealId: p.reserved_by_deal_id ?? null, activeDealIds: active.map((d) => d.id), propertyTransaction: p.transaction_type }, action);
      if (!result.ok) return;
      const dealId = 'dealId' in action ? action.dealId : null;
      await db.runAsync('UPDATE properties SET availability = ?, reserved_by_deal_id = ?, updated_at = ? WHERE id = ?', [result.to, result.reservedByDealId, now(), propertyId]);
      if (result.to !== p.availability || result.reservedByDealId !== (p.reserved_by_deal_id ?? null)) {
        await db.runAsync('INSERT INTO availability_history (property_id, from_state, to_state, action, deal_id, reason, at) VALUES (?,?,?,?,?,?,?)',
          [propertyId, p.availability, result.to, action.type, dealId, reason, now()]);
      }
    });
    return result;
  },
  async availabilityHistory(propertyId: number) {
    return getDb().getAllAsync<{ from_state: string; to_state: string; action: string; deal_id: number | null; reason: string; at: number }>(
      'SELECT from_state, to_state, action, deal_id, reason, at FROM availability_history WHERE property_id = ? ORDER BY at, id', [propertyId]);
  },
};

export { DomainError, validateOwnerSet };
