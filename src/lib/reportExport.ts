// Pure report formatting (CSV + printable HTML). Sharing/printing lives in reportShare.ts.
import { CREDIT } from './brand';
import type { ReportTable } from '../db/reportRepo';

const csvEsc = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // neutralise spreadsheet formulas, keep real negative numbers
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function tableToCsv(t: ReportTable, rangeLabel: string): string {
  const lines = [csvEsc(`${t.title} (${rangeLabel})`), t.columns.map(csvEsc).join(',')];
  for (const r of t.rows) lines.push(r.map(csvEsc).join(','));
  if (t.totals?.length) { lines.push(''); for (const x of t.totals) lines.push([csvEsc(x.label), x.value].join(',')); }
  lines.push('', csvEsc(`Exported from EstateFlow - ${CREDIT}`));
  return lines.join('\r\n');
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : esc(v));
export function tableToHtml(t: ReportTable, rangeLabel: string, business: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 24px 24px 54px; } body { font-family: Roboto, Helvetica, Arial, sans-serif; color: #13202F; font-size: 10.5px; }
    h1 { margin: 0; font-size: 20px; } .top { display: flex; justify-content: space-between; border-bottom: 3px solid #12305A; padding-bottom: 10px; margin-bottom: 12px; } .muted { color: #46566B; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; background: #E4EBF5; color: #0E2748; padding: 6px 5px; } td { padding: 5px; border-bottom: 1px solid #E1E6EE; vertical-align: top; }
    .totals { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; } .box { background: #E4EBF5; border-radius: 6px; padding: 8px 10px; } .box b { display: block; font-size: 14px; }
    footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #46566B; border-top: 1px solid #E1E6EE; padding-top: 6px; }
  </style></head><body>
  <div class="top"><div><h1>${esc(t.title)}</h1><div class="muted">${esc(rangeLabel)}</div></div><div style="text-align:right"><b>${esc(business)}</b><div class="muted">EstateFlow report</div></div></div>
  ${t.totals?.length ? `<div class="totals">${t.totals.map((x) => `<div class="box"><b>${num(x.value)}</b>${esc(x.label)}</div>`).join('')}</div>` : ''}
  <table><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${num(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${t.columns.length}" class="muted">No records in this period.</td></tr>`}</table>
  <footer>${esc(CREDIT)}</footer></body></html>`;
}
