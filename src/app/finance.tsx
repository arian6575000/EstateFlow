import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../ctx/AppContext';
import { useTheme } from '../ctx/ThemeContext';
import { useData } from '../lib/hooks';
import { DealRepo, EXPENSE_CATEGORIES, ExpenseCategory } from '../db/dealRepo';
import { ReportRepo } from '../db/reportRepo';
import { PAYMENT_METHODS, PaymentMethod } from '../domain/finance';
import { DomainError } from '../domain/errors';
import { Fmt } from '../lib/format';
import { parseMoney, rs } from '../lib/estate';
import { space } from '../lib/theme';
import { Button, Card, Chip, EmptyState, Field, Header, Row, Screen, Segmented, T } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { MoneyField } from '../ui/estate';
import { RangeChips, RangeState, rangeOf } from '../ui/RangeChips';

const LABEL: Record<string, string> = { office: 'Office', marketing: 'Marketing', travel: 'Travel', other: 'Other', cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque' };
const KIND: Record<string, string> = { buyer_payment: 'Payment', token: 'Token', bayana: 'Bayana', installment: 'Installment', seller_payment: 'Paid to seller', refund: 'Refund', commission_received: 'Commission received', commission_paid: 'Commission paid out' };

export default function Finance() {
  const router = useRouter(); const { c } = useTheme(); const { toast, confirm, bump } = useApp();
  const [range, setRange] = useState<RangeState>({ key: 'month' }); const [tab, setTab] = useState<'expenses' | 'payments'>('expenses'); const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState<ExpenseCategory>('office'); const [amt, setAmt] = useState(''); const [desc, setDesc] = useState(''); const [method, setMethod] = useState<PaymentMethod>('cash');
  const r = rangeOf(range);
  const { data, reload } = useData(async () => {
    const [k, expenses, pays, byPerson] = await Promise.all([ReportRepo.kpis(r), DealRepo.listExpenses({ sinceMs: r.from, untilMs: r.to }), DealRepo.listPayments({ sinceMs: r.from, limit: 300 }), ReportRepo.commissionByPerson(r)]);
    return { k, expenses, pays: pays.filter((p) => p.paidAt < r.to), byPerson };
  }, [r.from, r.to]);
  const save = async () => {
    const a = parseMoney(amt);
    try { if (a === null) throw new DomainError('amount', 'Enter a valid amount'); await DealRepo.addExpense({ category: cat, amount: a, description: desc, method }); setSheet(false); setAmt(''); setDesc(''); bump(); reload(); toast('Expense added', 'success'); }
    catch (e: any) { toast(e instanceof DomainError ? e.message : 'Could not save the expense', 'error'); }
  };
  const k = data?.k;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Finance" subtitle="Income, expenses and money movement" back large={false} right={<Button size="sm" icon="add" label="Expense" onPress={() => setSheet(true)} />} />
      <Screen contentStyle={{ paddingBottom: space.xxl }}>
        <RangeChips value={range} onChange={setRange} />
        {k ? (<>
          <Card style={{ marginTop: space.lg }}>
            <T v="overline" color={c.textMuted}>Net business income</T><T v="display" color={k.netIncome < 0 ? c.danger : c.text}>{rs(k.netIncome)}</T>
            <T v="caption" color={c.textMuted}>Commission received {rs(k.commissionEarned)} − paid to other dealers {rs(k.commissionPaidOut)} − expenses {rs(k.expenses)}. Customer money is not included.</T>
          </Card>
          <Card pad={0} style={{ marginTop: space.md }}>
            <Row icon="download" iconColor={c.success} title="Commission received" right={<T v="bodyStrong">{rs(k.commissionEarned)}</T>} />
            <Row icon="people" iconColor={c.warning} title="Commission paid to dealers" right={<T v="bodyStrong">{rs(k.commissionPaidOut)}</T>} />
            <Row icon="time" iconColor={c.secondary} title="Commission still pending from clients" right={<T v="bodyStrong">{rs(k.pendingCommission)}</T>} />
            <Row icon="wallet" iconColor={c.danger} title="Expenses" right={<T v="bodyStrong">{rs(k.expenses)}</T>} />
            <Row icon="alert-circle" iconColor={c.warning} title="Outstanding from buyers (all open deals)" right={<T v="bodyStrong">{rs(k.outstandingPayments)}</T>} last />
          </Card>
          {data!.byPerson.length ? (<><T v="overline" color={c.textMuted} style={{ marginTop: space.xl, marginBottom: space.sm }}>Commission paid out by dealer</T><Card pad={0}>{data!.byPerson.map((p, i) => <Row key={p.id} icon="person" title={p.name} right={<T v="bodyStrong">{rs(p.paid)}</T>} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: String(p.id) } })} last={i === data!.byPerson.length - 1} />)}</Card></>) : null}
        </>) : null}
        <View style={{ marginVertical: space.lg }}><Segmented<'expenses' | 'payments'> value={tab} onChange={setTab} options={[{ key: 'expenses', label: 'Expenses' }, { key: 'payments', label: 'Payments' }]} /></View>
        {tab === 'expenses' ? (data?.expenses.length ? <Card pad={0}>{data.expenses.map((e, i) => (
          <Row key={e.id} icon={e.reversalOf ? 'arrow-undo' : 'wallet-outline'} iconColor={e.reversalOf ? c.warning : c.danger} title={`${e.reversalOf ? 'Reversal · ' : ''}${LABEL[e.category]} · ${rs(e.amount)}`} subtitle={`${Fmt.date(e.spentAt, true)} · ${LABEL[e.method]}${e.description ? ' · ' + e.description : ''}${e.reversed ? ' · reversed' : ''}`}
            right={!e.reversalOf && !e.reversed ? <Button size="sm" variant="ghost" label="Reverse" onPress={async () => { if (await confirm(`Reverse this ${rs(e.amount)} expense? A reversal entry is added; the original stays.`, { title: 'Reverse expense', okLabel: 'Reverse', danger: true })) { try { await DealRepo.reverseExpense(e.id); bump(); reload(); } catch (x: any) { toast(x.message, 'error'); } } }} /> : undefined} last={i === data.expenses.length - 1} />))}</Card>
          : <EmptyState icon="wallet-outline" title="No expenses in this period" message="Record office, marketing and travel costs to see your true net income." action="Add expense" onAction={() => setSheet(true)} />) : null}
        {tab === 'payments' ? (data?.pays.length ? <Card pad={0}>{data.pays.map((p, i) => <Row key={p.id} icon={p.reversalOf ? 'arrow-undo' : ['refund', 'seller_payment', 'commission_paid'].includes(p.kind) ? 'arrow-up-circle' : 'arrow-down-circle'} title={`${p.reversalOf ? 'Reversal · ' : ''}${KIND[p.kind]} · ${rs(p.amount)}`} subtitle={`${p.code} · ${Fmt.date(p.paidAt, true)}${p.personName ? ' · ' + p.personName : ''}`} onPress={p.dealId ? () => router.push({ pathname: '/deal/[id]', params: { id: String(p.dealId) } }) : undefined} chevron={!!p.dealId} last={i === data.pays.length - 1} />)}</Card>
          : <EmptyState icon="cash-outline" title="No payments in this period" message="Payments are recorded inside each deal." />) : null}
      </Screen>
      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Add expense" tall footer={<Button block icon="checkmark" label="Save expense" onPress={save} />}>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Category</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>{EXPENSE_CATEGORIES.map((x) => <Chip key={x} label={LABEL[x]} selected={cat === x} onPress={() => setCat(x)} />)}</View>
        <MoneyField label="Amount" value={amt} onChangeText={setAmt} /><Field label="Description" value={desc} onChangeText={setDesc} placeholder="e.g. Banner printing" />
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Method</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{PAYMENT_METHODS.map((x) => <Chip key={x} label={LABEL[x] ?? 'Other'} selected={method === x} onPress={() => setMethod(x)} />)}</View>
      </Sheet>
    </View>
  );
}
