// Pure helpers for the real-estate screens (no React Native imports, so they are unit-tested in Node).

/** "1.5 crore" / "75 lakh" / "2500000" / "25 lac" / "50k" / "1,20,00,000" → whole rupees, or null if it is not a valid amount. */
export function parseMoney(input: string): number | null {
  const s = input.toLowerCase().replace(/rs\.?|pkr|,|\s+/g, '');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(crore|cr|lakh|lac|lacs|k|m|million|arab)?$/.exec(s);
  if (!m) return null;
  const mult: Record<string, number> = { crore: 1e7, cr: 1e7, lakh: 1e5, lac: 1e5, lacs: 1e5, k: 1e3, m: 1e6, million: 1e6, arab: 1e9 };
  const v = Math.round(parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1));
  return Number.isSafeInteger(v) ? v : null;
}

/** 12500000 → "1.25 Crore", 750000 → "7.5 Lakh", 1.2e9 → "1.2 Arab". Display only. */
export function moneyWords(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  const f = (v: number, unit: string) => `${sign}${+v.toFixed(2)} ${unit}`;
  if (a >= 1e9) return f(a / 1e9, 'Arab');
  if (a >= 1e7) return f(a / 1e7, 'Crore');
  if (a >= 1e5) return f(a / 1e5, 'Lakh');
  if (a >= 1e3) return f(a / 1e3, 'Thousand');
  return `${sign}${a}`;
}

/** Pakistani digit grouping: 12345678 → "1,23,45,678". */
export function groupPk(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  const last3 = s.slice(-3), rest = s.slice(0, -3);
  const g = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (n < 0 ? '-' : '') + g;
}
export const rs = (n: number) => `Rs ${groupPk(n)}`;

export const todayYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));

/** Plain-text summary of a property for sharing through the Android share sheet (never includes owner phone / minimum price). */
export function shareText(p: { code: string; title: string; category: string; society: string; phase: string; block: string; plotNo: string; area: string; city: string; areaLabel: string; transactionType: string; bedrooms: number | null; bathrooms: number | null; description: string }, price: number | null, credit: string): string {
  const loc = [p.plotNo && `Plot ${p.plotNo}`, p.block && `Block ${p.block}`, p.phase && `Phase ${p.phase}`, p.society, p.area, p.city].filter(Boolean).join(', ');
  const lines = [`🏠 ${p.title}`, `For ${p.transactionType === 'rent' ? 'Rent' : 'Sale'}${price ? ` · ${rs(price)} (${moneyWords(price)})` : ''}`, `📐 ${p.areaLabel}`];
  if (p.bedrooms || p.bathrooms) lines.push(`🛏 ${p.bedrooms ?? 0} bed · 🛁 ${p.bathrooms ?? 0} bath`);
  if (loc) lines.push(`📍 ${loc}`);
  if (p.description.trim()) lines.push('', p.description.trim());
  lines.push('', `Ref: ${p.code}`, credit);
  return lines.join('\n');
}
