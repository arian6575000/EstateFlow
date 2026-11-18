import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData } from '../../lib/hooks';
import { Repo } from '../../db/repo';
import { ReportKind, ReportRepo, REPORT_LABEL, reportTable } from '../../db/reportRepo';
import { STAGE_LABEL } from '../../db/dealRepo';
import { shareReportCsv, shareReportPdf } from '../../lib/reportShare';
import { rs } from '../../lib/estate';
import { space } from '../../lib/theme';
import { Button, Card, Header, Row, Screen, SectionHeader, T } from '../../ui/kit';
import { Sheet } from '../../ui/Sheet';
import { BarChart, DonutChart, HBars } from '../../ui/charts';
import { AVAIL_META, CATEGORY_LABEL } from '../../ui/estate';
import { RangeChips, RangeState, rangeOf } from '../../ui/RangeChips';

const short = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)} Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)} L` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const KINDS = Object.keys(REPORT_LABEL) as ReportKind[];

export default function Insights() {
  const router = useRouter(); const { c } = useTheme(); const { toast } = useApp();
  const [range, setRange] = useState<RangeState>({ key: 'month' }); const [exportOpen, setExportOpen] = useState(false); const [busy, setBusy] = useState('');
  const r = rangeOf(range);
  const rangeLabel = `${new Date(r.from).toISOString().slice(0, 10)} to ${new Date(r.to - 1).toISOString().slice(0, 10)}`;
  const { data } = useData(async () => {
    const [k, monthly, funnel, byCat, bySoc, byPerson] = await Promise.all([ReportRepo.kpis(r), ReportRepo.monthly(6), ReportRepo.dealFunnel(), ReportRepo.inventoryByCategory(), ReportRepo.inventoryBySociety(), ReportRepo.commissionByPerson(r)]);
    return { k, monthly, funnel, byCat, bySoc, byPerson };
  }, [r.from, r.to]);

  const run = async (kind: ReportKind, fmt: 'csv' | 'pdf') => {
    setBusy(kind + fmt);
    try {
      const t = await reportTable(kind, r);
      if (!t.rows.length) { toast(`No ${REPORT_LABEL[kind].toLowerCase()} records in this period`, 'error'); return; }
      if (fmt === 'csv') await shareReportCsv(t, rangeLabel); else await shareReportPdf(t, rangeLabel, (await Repo.getSettings()).businessName || 'EstateFlow');
    } catch (e: any) { toast(e?.message || 'Export failed', 'error'); } finally { setBusy(''); }
  };

  const k = data?.k; const palette = [c.primary, c.secondary, c.accent, c.success, c.warning, c.danger, c.textMuted];
  const tile = (label: string, value: string, sub?: string) => (<Card style={{ flexBasis: '47%', flexGrow: 1 }}><T v="caption" color={c.textMuted}>{label}</T><T v="title">{value}</T>{sub ? <T v="caption" color={c.textMuted}>{sub}</T> : null}</Card>);
  const availSegs = k ? (['available', 'under_negotiation', 'reserved', 'on_hold', 'sold', 'rented'] as const).map((a, i) => ({ key: a, label: AVAIL_META[a].label, value: ({ available: k.available, under_negotiation: k.underNegotiation, reserved: k.reserved, on_hold: k.onHold, sold: k.sold, rented: k.rented })[a], color: palette[i] })).filter((s) => s.value > 0) : [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Insights" subtitle="Sales, inventory and income" right={<Button size="sm" icon="download" label="Export" onPress={() => setExportOpen(true)} />} />
      <Screen contentStyle={{ paddingBottom: space.xxl }}>
        <RangeChips value={range} onChange={setRange} />
        {k ? (<>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.lg }}>
            {tile('Deals completed', String(k.completedDeals), `${k.activeDeals} open now`)}
            {tile('Sales volume', rs(k.salesVolume))}
            {tile('Commission received', rs(k.commissionEarned), `${rs(k.pendingCommission)} pending`)}
            {tile('Net income', rs(k.netIncome), `Expenses ${rs(k.expenses)}`)}
          </View>
          <Button variant="soft" block icon="wallet" label="Open finance" onPress={() => router.push('/finance')} style={{ marginTop: space.md }} />

          <SectionHeader title="Last 6 months: sales volume" />
          <Card><BarChart data={data!.monthly.map((m) => ({ label: m.label, value: m.volume }))} format={short} summary="Completed sale volume per month" /></Card>
          <SectionHeader title="Last 6 months: commission received" />
          <Card><BarChart data={data!.monthly.map((m) => ({ label: m.label, value: m.commission }))} format={short} color={c.success} summary="Commission received per month" /></Card>
          <SectionHeader title="Last 6 months: buyer collections" />
          <Card><BarChart data={data!.monthly.map((m) => ({ label: m.label, value: m.collections }))} format={short} color={c.secondary} summary="Money collected from buyers per month" /></Card>

          <SectionHeader title="Inventory by availability" />
          <Card>{availSegs.length ? <DonutChart segments={availSegs} centerValue={String(k.totalProperties)} centerLabel="properties" /> : <T color={c.textMuted}>No properties yet. Add a property to see inventory charts.</T>}
            {availSegs.length ? <View style={{ marginTop: space.md }}>{availSegs.map((s) => <Row key={s.key} title={s.label} right={<T v="bodyStrong">{s.value}</T>} last />)}</View> : null}</Card>
          {data!.byCat.length ? (<><SectionHeader title="Inventory by category" /><Card><HBars rows={data!.byCat.map((x, i) => ({ key: x.key, label: (CATEGORY_LABEL as any)[x.key] ?? x.key, value: x.count, color: palette[i % palette.length] }))} /></Card></>) : null}
          {data!.bySoc.length ? (<><SectionHeader title="Top societies" /><Card><HBars rows={data!.bySoc.map((x, i) => ({ key: x.key, label: x.key, value: x.count, color: palette[i % palette.length] }))} /></Card></>) : null}

          <SectionHeader title="Deal funnel (all deals)" />
          <Card><HBars rows={data!.funnel.map((f, i) => ({ key: f.stage, label: STAGE_LABEL[f.stage], value: f.count, color: palette[i % palette.length] }))} /></Card>

          {data!.byPerson.length ? (<><SectionHeader title="Commission paid to dealers" /><Card pad={0}>{data!.byPerson.map((p, i) => <Row key={p.id} icon="person" title={p.name} right={<T v="bodyStrong">{rs(p.paid)}</T>} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: String(p.id) } })} last={i === data!.byPerson.length - 1} />)}</Card></>) : null}
        </>) : null}
      </Screen>
      <Sheet visible={exportOpen} onClose={() => setExportOpen(false)} title="Export report" tall>
        <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>Period: {rangeLabel}. Every file carries the RetailX Solution credit.</T>
        {KINDS.map((kd) => (
          <Card key={kd} style={{ marginBottom: space.md, gap: space.sm }}>
            <T v="bodyStrong">{REPORT_LABEL[kd]}</T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button size="sm" variant="soft" icon="document-text" label="CSV" loading={busy === kd + 'csv'} disabled={!!busy} onPress={() => run(kd, 'csv')} />
              <Button size="sm" variant="soft" icon="print" label="PDF" loading={busy === kd + 'pdf'} disabled={!!busy} onPress={() => run(kd, 'pdf')} />
            </View>
          </Card>
        ))}
      </Sheet>
    </View>
  );
}
