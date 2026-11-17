// Pakistani land measurement. Marla and Kanal are NOT universal, so the basis is always explicit:
//   'revenue' : 1 Marla = 272.25 sq ft (30.25 sq yd), 1 Kanal = 20 Marla = 5,445 sq ft, 8 Kanal = 1 Acre (government / revenue records)
//   'society' : 1 Marla = 225 sq ft, 1 Kanal = 20 Marla = 4,500 sq ft (common in Lahore housing schemes)
// Square yard (9 sq ft) and Acre (43,560 sq ft) are fixed. Every property stores value + unit + basis and a normalised sq-ft figure.
import { assertDomain } from './errors';

export const AREA_UNITS = ['marla', 'kanal', 'sqft', 'sqyd', 'acre'] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];
export const MARLA_BASES = ['revenue', 'society'] as const;
export type MarlaBasis = (typeof MARLA_BASES)[number];
export const MARLA_SQFT: Record<MarlaBasis, number> = { revenue: 272.25, society: 225 };

export const UNIT_LABEL: Record<AreaUnit, string> = { marla: 'Marla', kanal: 'Kanal', sqft: 'Sq Ft', sqyd: 'Sq Yd', acre: 'Acre' };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function sqftPerUnit(unit: AreaUnit, basis: MarlaBasis = 'revenue'): number {
  assertDomain(AREA_UNITS.includes(unit), 'unit', `Unknown area unit: ${unit}`);
  assertDomain(MARLA_BASES.includes(basis), 'basis', `Unknown marla basis: ${basis}`);
  switch (unit) {
    case 'marla': return MARLA_SQFT[basis];
    case 'kanal': return MARLA_SQFT[basis] * 20;
    case 'sqft': return 1;
    case 'sqyd': return 9;
    case 'acre': return 43560;
  }
}

export function toSqft(value: number, unit: AreaUnit, basis: MarlaBasis = 'revenue'): number {
  assertDomain(Number.isFinite(value) && value > 0, 'area', 'Area must be a positive number');
  return round4(value * sqftPerUnit(unit, basis));
}

export function fromSqft(sqft: number, unit: AreaUnit, basis: MarlaBasis = 'revenue'): number {
  assertDomain(Number.isFinite(sqft) && sqft > 0, 'area', 'Area must be a positive number');
  return round4(sqft / sqftPerUnit(unit, basis));
}

/** Convert between any two units; the basis only matters when Marla or Kanal is involved. */
export function convertArea(value: number, from: AreaUnit, to: AreaUnit, basis: MarlaBasis = 'revenue'): number {
  return fromSqft(toSqft(value, from, basis), to, basis);
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

/** "1 Kanal 5 Marla" for Marla/Kanal values, otherwise "10 Marla" / "2,400 Sq Ft". */
export function formatArea(value: number, unit: AreaUnit): string {
  if (unit === 'marla' || unit === 'kanal') {
    const marla = unit === 'kanal' ? value * 20 : value;
    const k = Math.floor(round4(marla) / 20), m = round4(marla - k * 20);
    if (k > 0 && m > 0) return `${k} Kanal ${trim(m)} Marla`;
    if (k > 0) return `${k} Kanal`;
    return `${trim(m)} Marla`;
  }
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${UNIT_LABEL[unit]}`;
}
