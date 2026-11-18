// Read-only business reports. Every number comes from persisted rows (nothing is hard-coded or sampled).
// Money rules: customer funds (buyer payments, refunds, seller payments) are NEVER income. Dealer income is commission actually
// received from clients minus commission paid out to other dealers. Reversal rows are netted with a negative sign.
import { getDb } from './repo';
import { DEAL_STAGES, DealStage } from './dealRepo';

export type RangeKey = 'today' | 'week' | 'month' | 'year' | 'custom';
export interface Range { from: number; to: number } // [from, to) in ms

export function rangeFor(key: RangeKey, nowMs = Date.now(), custom?: Range): Range {
  const d = new Date(nowMs); d.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (key === 'today') return { from: d.getTime(), to: d.getTime() + day };
  if (key === 'week') { const wd = (d.getDay() + 6) % 7; const from = d.getTime() - wd * day; return { from, to: from + 7 * day }; } // Monday-based
  if (key === 'month') return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  if (key === 'year') return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: new Date(d.getFullYear() + 1, 0, 1).getTime() };
  if (!custom || custom.to <= custom.from) throw new Error('Choose a valid date range');
  return custom;
}

const one = async <T,>(sql: string, p: any[] = []): Promise<T> => (await getDb().getFirstAsync<any>(sql, p)) as T;
const num = (v: any) => Number(v) || 0;
const SIGNED = '(CASE WHEN reversal_of IS NOT NULL THEN -amount ELSE amount END)';

export const ReportRepo = {
  async kpis(r: Range) {
    const [props, listings, avail, activeDeals, completed, volume, recv, paidOut, expenses, pend, outstanding] = await Promise.all([
      one<any>("SELECT COUNT(*) n FROM properties WHERE record_status = 'active'"),
      one<any>("SELECT COUNT(DISTINCT l.property_id) n FROM listings l JOIN properties p ON p.id = l.property_id WHERE l.status = 'active' AND (l.expiry_date = '' OR l.expiry_date >= date('now')) AND p.availability NOT IN ('sold','rented') AND p.record_status = 'active'"),
      getDb().getAllAsync<any>("SELECT availability a, COUNT(*) n FROM properties WHERE record_status = 'active' GROUP BY availability"),
      one<any>("SELECT COUNT(*) n FROM deals WHERE stage NOT IN ('completed','cancelled')"),
      one<any>("SELECT COUNT(*) n FROM deals WHERE stage = 'completed' AND closed_at >= ? AND closed_at < ?", [r.from, r.to]),
      one<any>("SELECT COALESCE(SUM(agreed_price),0) n FROM deals WHERE stage = 'completed' AND transaction_type = 'sale' AND closed_at >= ? AND closed_at < ?", [r.from, r.to]),
      one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM payments WHERE kind = 'commission_received' AND paid_at >= ? AND paid_at < ?`, [r.from, r.to]),
      one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM payments WHERE kind = 'commission_paid' AND paid_at >= ? AND paid_at < ?`, [r.from, r.to]),
      one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM expenses WHERE spent_at >= ? AND spent_at < ?`, [r.from, r.to]),
      // commission still to be collected from clients on live (non-cancelled) deals, all time
      one<any>(`SELECT COALESCE(SUM(a.total_amount),0) - COALESCE((SELECT SUM(${SIGNED}) FROM payments p WHERE p.kind = 'commission_received' AND p.deal_id IN (SELECT deal_id FROM commission_agreements a2 JOIN deals d2 ON d2.id = a2.deal_id WHERE a2.superseded_by IS NULL AND d2.stage != 'cancelled')),0) n
                FROM commission_agreements a JOIN deals d ON d.id = a.deal_id WHERE a.superseded_by IS NULL AND d.stage != 'cancelled'`),
      // unpaid balance on every live deal that has a price
      one<any>(`SELECT COALESCE(SUM(MAX(0, d.agreed_price - COALESCE((SELECT SUM(CASE WHEN p.reversal_of IS NOT NULL THEN -p.amount ELSE p.amount END * CASE WHEN p.kind = 'refund' THEN -1 ELSE 1 END)
                  FROM payments p WHERE p.deal_id = d.id AND p.kind IN ('buyer_payment','token','bayana','installment','refund')), 0))), 0) n
                FROM deals d WHERE d.stage NOT IN ('completed','cancelled') AND d.agreed_price IS NOT NULL`),
    ]);
    const byAvail = Object.fromEntries(avail.map((x: any) => [x.a, num(x.n)])) as Record<string, number>;
    const commissionEarned = num(recv.n), paidOutN = num(paidOut.n), exp = num(expenses.n);
    return {
      totalProperties: num(props.n), activeListings: num(listings.n), available: byAvail.available ?? 0, underNegotiation: byAvail.under_negotiation ?? 0,
      reserved: byAvail.reserved ?? 0, sold: byAvail.sold ?? 0, rented: byAvail.rented ?? 0, onHold: byAvail.on_hold ?? 0,
      activeDeals: num(activeDeals.n), completedDeals: num(completed.n), salesVolume: num(volume.n),
      commissionEarned, commissionPaidOut: paidOutN, pendingCommission: Math.max(0, num(pend.n)), outstandingPayments: num(outstanding.n),
      expenses: exp, netIncome: commissionEarned - paidOutN - exp,
    };
  },

  /** Completed deals + sales volume + commission received per month, oldest → newest, for the last `months` months. */
  async monthly(months = 6, nowMs = Date.now()) {
    const out: { label: string; key: string; from: number; to: number; deals: number; volume: number; commission: number; collections: number; expenses: number }[] = [];
    const d = new Date(nowMs);
    for (let i = months - 1; i >= 0; i--) {
      const from = new Date(d.getFullYear(), d.getMonth() - i, 1).getTime(), to = new Date(d.getFullYear(), d.getMonth() - i + 1, 1).getTime();
      const dt = new Date(from);
      const [deals, vol, com, col, exp] = await Promise.all([
        one<any>("SELECT COUNT(*) n FROM deals WHERE stage = 'completed' AND closed_at >= ? AND closed_at < ?", [from, to]),
        one<any>("SELECT COALESCE(SUM(agreed_price),0) n FROM deals WHERE stage = 'completed' AND transaction_type = 'sale' AND closed_at >= ? AND closed_at < ?", [from, to]),
        one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM payments WHERE kind = 'commission_received' AND paid_at >= ? AND paid_at < ?`, [from, to]),
        one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM payments WHERE kind IN ('buyer_payment','token','bayana','installment') AND paid_at >= ? AND paid_at < ?`, [from, to]),
        one<any>(`SELECT COALESCE(SUM(${SIGNED}),0) n FROM expenses WHERE spent_at >= ? AND spent_at < ?`, [from, to]),
      ]);
      out.push({ label: dt.toLocaleString('en-US', { month: 'short' }), key: `${dt.getFullYear()}-${dt.getMonth() + 1}`, from, to, deals: num(deals.n), volume: num(vol.n), commission: num(com.n), collections: num(col.n), expenses: num(exp.n) });
    }
    return out;
  },

  async dealFunnel() {
    const rows = await getDb().getAllAsync<any>('SELECT stage, COUNT(*) n FROM deals GROUP BY stage');
    const m = Object.fromEntries(rows.map((r: any) => [r.stage, num(r.n)])) as Record<string, number>;
    return DEAL_STAGES.map((s) => ({ stage: s as DealStage, count: m[s] ?? 0 }));
  },
  async inventoryByCategory() {
    return (await getDb().getAllAsync<any>("SELECT category k, COUNT(*) n FROM properties WHERE record_status = 'active' GROUP BY category ORDER BY n DESC")).map((r: any) => ({ key: r.k as string, count: num(r.n) }));
  },
  async inventoryBySociety() {
    return (await getDb().getAllAsync<any>("SELECT CASE WHEN society = '' THEN 'No society' ELSE society END k, COUNT(*) n FROM properties WHERE record_status = 'active' GROUP BY k ORDER BY n DESC LIMIT 8")).map((r: any) => ({ key: r.k as string, count: num(r.n) }));
  },
  async commissionByPerson(r: Range) {
    return (await getDb().getAllAsync<any>(
      `SELECT c.id, c.name, COALESCE(SUM(${SIGNED.replace(/amount/g, 'p.amount').replace(/reversal_of/g, 'p.reversal_of')}),0) n FROM payments p JOIN customers c ON c.id = p.person_id
       WHERE p.kind = 'commission_paid' AND p.paid_at >= ? AND p.paid_at < ? GROUP BY c.id ORDER BY n DESC`, [r.from, r.to])).map((x: any) => ({ id: x.id as number, name: x.name as string, paid: num(x.n) }));
  },
  async pendingPayments(limit = 8) {
    // open deals with a price and an unpaid balance, biggest first
    const deals = await getDb().getAllAsync<any>(`SELECT d.id, d.code, d.agreed_price, p.title, b.name buyer FROM deals d JOIN properties p ON p.id = d.property_id LEFT JOIN customers b ON b.id = d.buyer_id
      WHERE d.stage NOT IN ('completed','cancelled') AND d.agreed_price IS NOT NULL`);
    const out: { id: number; code: string; title: string; buyer: string; outstanding: number }[] = [];
    for (const d of deals) {
      const p = await one<any>(`SELECT COALESCE(SUM(CASE WHEN reversal_of IS NOT NULL THEN -amount ELSE amount END * CASE WHEN kind = 'refund' THEN -1 ELSE 1 END),0) n FROM payments WHERE deal_id = ? AND kind IN ('buyer_payment','token','bayana','installment','refund')`, [d.id]);
      const left = d.agreed_price - num(p.n);
      if (left > 0) out.push({ id: d.id, code: d.code, title: d.title, buyer: d.buyer ?? '', outstanding: left });
    }
    return out.sort((a, b) => b.outstanding - a.outstanding).slice(0, limit);
  },
  async recentProperties(limit = 6) {
    return getDb().getAllAsync<any>("SELECT id, code, title, city, society, availability, area_value, area_unit FROM properties WHERE record_status = 'active' ORDER BY created_at DESC, id DESC LIMIT ?", [limit]);
  },
  /** Active listings that expire within `days` days (or already expired but still marked active). */
  async expiringListings(days = 7, limit = 5) {
    return getDb().getAllAsync<any>(`SELECT l.id, l.property_id, l.expiry_date, p.title, p.code FROM listings l JOIN properties p ON p.id = l.property_id
      WHERE l.status = 'active' AND l.expiry_date != '' AND l.expiry_date <= date('now', ?) ORDER BY l.expiry_date LIMIT ?`, [`+${days} day`, limit]);
  },
  async recentDeals(limit = 5) {
    return getDb().getAllAsync<any>('SELECT d.id, d.code, d.stage, d.updated_at, p.title FROM deals d JOIN properties p ON p.id = d.property_id ORDER BY d.updated_at DESC, d.id DESC LIMIT ?', [limit]);
  },
};

// ---------------- exportable report tables ----------------
export type ReportKind = 'properties' | 'deals' | 'commission' | 'payments' | 'expenses' | 'contacts';
export const REPORT_LABEL: Record<ReportKind, string> = { properties: 'Property inventory', deals: 'Deals & sales', commission: 'Commission', payments: 'Payments & collections', expenses: 'Expenses', contacts: 'CRM: new contacts' };
export interface ReportFilter { society?: string; category?: string; dealerId?: number }
export interface ReportTable { kind: ReportKind; title: string; columns: string[]; rows: (string | number)[][]; totals?: { label: string; value: number }[] }

const ymd = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const sgn = (r: any) => (r.reversal_of ? -r.amount : r.amount);

export async function reportTable(kind: ReportKind, r: Range, f: ReportFilter = {}): Promise<ReportTable> {
  const db = getDb(); const title = REPORT_LABEL[kind];
  if (kind === 'properties') {
    const w: string[] = ["p.record_status = 'active'"]; const a: any[] = [];
    if (f.society) { w.push('p.society = ? COLLATE NOCASE'); a.push(f.society); } if (f.category) { w.push('p.category = ?'); a.push(f.category); }
    const rows = await db.getAllAsync<any>(`SELECT p.code, p.title, p.category, p.transaction_type, p.availability, p.city, p.society, p.area_sqft, (SELECT MIN(asking_price) FROM listings l WHERE l.property_id = p.id AND l.status = 'active') AS price,
      (SELECT COUNT(*) FROM listings l WHERE l.property_id = p.id AND l.status = 'active') AS listings FROM properties p WHERE ${w.join(' AND ')} ORDER BY p.created_at DESC`, a);
    return { kind, title, columns: ['Code', 'Title', 'Category', 'Transaction', 'Availability', 'City', 'Society', 'Area (sq ft)', 'Active listings', 'Lowest asking price'], rows: rows.map((x) => [x.code, x.title, x.category, x.transaction_type, x.availability, x.city, x.society, Math.round(x.area_sqft), x.listings, x.price ?? '']), totals: [{ label: 'Properties', value: rows.length }] };
  }
  if (kind === 'deals') {
    const w: string[] = ['d.created_at >= ? AND d.created_at < ?']; const a: any[] = [r.from, r.to];
    if (f.society) { w.push('p.society = ? COLLATE NOCASE'); a.push(f.society); } if (f.category) { w.push('p.category = ?'); a.push(f.category); }
    const rows = await db.getAllAsync<any>(`SELECT d.id, d.code, p.title, b.name buyer, s.name seller, d.stage, d.agreed_price, d.created_at, d.closed_at,
      COALESCE((SELECT SUM(CASE WHEN pm.reversal_of IS NOT NULL THEN -pm.amount ELSE pm.amount END * CASE WHEN pm.kind = 'refund' THEN -1 ELSE 1 END) FROM payments pm WHERE pm.deal_id = d.id AND pm.kind IN ('buyer_payment','token','bayana','installment','refund')),0) received
      FROM deals d JOIN properties p ON p.id = d.property_id LEFT JOIN customers b ON b.id = d.buyer_id LEFT JOIN customers s ON s.id = d.seller_id WHERE ${w.join(' AND ')} ORDER BY d.created_at DESC`, a);
    const vol = rows.filter((x) => x.stage === 'completed').reduce((n, x) => n + (x.agreed_price ?? 0), 0);
    return { kind, title, columns: ['Deal', 'Property', 'Buyer', 'Seller', 'Stage', 'Agreed price', 'Received', 'Outstanding', 'Opened', 'Closed'], rows: rows.map((x) => [x.code, x.title, x.buyer ?? '', x.seller ?? '', x.stage, x.agreed_price ?? '', x.received, x.stage === 'cancelled' || x.agreed_price == null ? '' : Math.max(0, x.agreed_price - x.received), ymd(x.created_at), ymd(x.closed_at)]),
      totals: [{ label: 'Deals', value: rows.length }, { label: 'Completed', value: rows.filter((x) => x.stage === 'completed').length }, { label: 'Cancelled', value: rows.filter((x) => x.stage === 'cancelled').length }, { label: 'Completed sales volume', value: vol }] };
  }
  if (kind === 'commission') {
    const a: any[] = [r.from, r.to]; let extra = '';
    if (f.dealerId != null) { extra = 'AND EXISTS (SELECT 1 FROM commission_shares s2 WHERE s2.agreement_id = a.id AND s2.person_id = ?)'; a.push(f.dealerId); }
    const rows = await db.getAllAsync<any>(`SELECT a.id, a.total_amount, a.finalized_at, d.code, d.stage,
      COALESCE((SELECT SUM(CASE WHEN p.reversal_of IS NOT NULL THEN -p.amount ELSE p.amount END) FROM payments p WHERE p.deal_id = d.id AND p.kind = 'commission_received'),0) received,
      COALESCE((SELECT SUM(CASE WHEN p.reversal_of IS NOT NULL THEN -p.amount ELSE p.amount END) FROM payments p WHERE p.deal_id = d.id AND p.kind = 'commission_paid'),0) paid,
      (SELECT GROUP_CONCAT(c.name || ' ' || s.amount, '; ') FROM commission_shares s JOIN customers c ON c.id = s.person_id WHERE s.agreement_id = a.id) shares
      FROM commission_agreements a JOIN deals d ON d.id = a.deal_id WHERE a.superseded_by IS NULL AND a.finalized_at >= ? AND a.finalized_at < ? ${extra} ORDER BY a.finalized_at DESC`, a);
    const sum = (k: string) => rows.reduce((n, x) => n + x[k], 0);
    return { kind, title, columns: ['Deal', 'Stage', 'Finalised', 'Total commission', 'Received', 'Pending from client', 'Paid to dealers', 'Shares'], rows: rows.map((x) => [x.code, x.stage, ymd(x.finalized_at), x.total_amount, x.received, Math.max(0, x.total_amount - x.received), x.paid, x.shares ?? '']),
      totals: [{ label: 'Total commission', value: sum('total_amount') }, { label: 'Received', value: sum('received') }, { label: 'Paid to dealers', value: sum('paid') }] };
  }
  if (kind === 'payments') {
    const rows = await db.getAllAsync<any>(`SELECT p.*, d.code deal_code, c.name person FROM payments p LEFT JOIN deals d ON d.id = p.deal_id LEFT JOIN customers c ON c.id = p.person_id WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC, p.id DESC`, [r.from, r.to]);
    const inKinds = ['buyer_payment', 'token', 'bayana', 'installment'];
    const collected = rows.filter((x) => inKinds.includes(x.kind)).reduce((n, x) => n + sgn(x), 0);
    return { kind, title, columns: ['Payment', 'Date', 'Deal', 'Person', 'Type', 'Amount', 'Method', 'Reference'], rows: rows.map((x) => [x.code, ymd(x.paid_at), x.deal_code ?? '', x.person ?? '', x.reversal_of ? `reversal of ${x.kind}` : x.kind, sgn(x), x.method, x.reference]), totals: [{ label: 'Collected from buyers (net)', value: collected }] };
  }
  if (kind === 'expenses') {
    const rows = await db.getAllAsync<any>('SELECT * FROM expenses WHERE spent_at >= ? AND spent_at < ? ORDER BY spent_at DESC, id DESC', [r.from, r.to]);
    return { kind, title, columns: ['Date', 'Category', 'Amount', 'Method', 'Description'], rows: rows.map((x) => [ymd(x.spent_at), x.reversal_of ? `${x.category} (reversal)` : x.category, sgn(x), x.method, x.description]), totals: [{ label: 'Net expenses', value: rows.reduce((n, x) => n + sgn(x), 0) }] };
  }
  const rows = await db.getAllAsync<any>(`SELECT c.name, c.phone, c.city, c.created_at, (SELECT GROUP_CONCAT(role, ', ') FROM person_roles pr WHERE pr.person_id = c.id) roles FROM customers c WHERE c.created_at >= ? AND c.created_at < ? ORDER BY c.created_at DESC`, [r.from, r.to]);
  return { kind, title, columns: ['Name', 'Phone', 'City', 'Roles', 'Added'], rows: rows.map((x) => [x.name, x.phone, x.city, x.roles ?? '', ymd(x.created_at)]), totals: [{ label: 'New contacts', value: rows.length }] };
}
