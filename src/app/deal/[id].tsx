import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData } from '../../lib/hooks';
import { DEAL_STAGES, DealRepo, DealStage, Payment } from '../../db/dealRepo';
import { PaymentKind, PaymentMethod, PAYMENT_METHODS, buildInstallments } from '../../domain/finance';
import { CommissionTerms, percentToBps } from '../../domain/commission';
import { DomainError } from '../../domain/errors';
import { Fmt } from '../../lib/format';
import { isYmd, moneyWords, parseMoney, rs, todayYmd } from '../../lib/estate';
import { radius, space } from '../../lib/theme';
import { Badge, Button, Card, Chip, EmptyState, Field, Header, IconButton, ListSkeleton, Progress, Row, Screen, Segmented, T } from '../../ui/kit';
import { ActionMenu, Sheet } from '../../ui/Sheet';
import { CustomerPicker } from '../../ui/CustomerPicker';
import { AVAIL_META, MoneyField, STAGE_LABEL, STAGE_TONE } from '../../ui/estate';
import { PropertyRepo } from '../../db/propertyRepo';

type Tab = 'progress' | 'payments' | 'schedule' | 'commission';
const KIND_LABEL: Record<PaymentKind, string> = { buyer_payment: 'Payment', token: 'Token', bayana: 'Bayana', installment: 'Installment', seller_payment: 'Paid to seller', refund: 'Refund', commission_received: 'Commission received', commission_paid: 'Commission paid out' };
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' };
const IN_KINDS: PaymentKind[] = ['token', 'bayana', 'installment', 'buyer_payment'];

export default function DealWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>(); const did = Number(id);
  const router = useRouter(); const { c } = useTheme(); const { toast, confirm, bump } = useApp();
  const [tab, setTab] = useState<Tab>('progress'); const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | 'pay' | 'refund' | 'seller' | 'terms' | 'cancel' | 'schedule' | 'commission' | 'received' | { payout: number }>(null);
  const { data, loading, reload } = useData(async () => {
    const d = await DealRepo.getDeal(did); if (!d) return null;
    const [bal, hist, pays, sched, com, prop] = await Promise.all([DealRepo.balance(did), DealRepo.stageHistory(did), DealRepo.listPayments({ dealId: did }), DealRepo.schedule(did, todayYmd()), DealRepo.commissionStatus(did), PropertyRepo.getProperty(d.propertyId)]);
    return { d, bal, hist, pays, sched, com, prop: prop! };
  }, [did]);
  if (loading) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 80 }}><ListSkeleton rows={4} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}><EmptyState icon="swap-horizontal" title="Deal not found" message="It may have been removed." action="Go back" onAction={() => router.back()} /></View>;
  const { d, bal, com } = data; const open = d.stage !== 'completed' && d.stage !== 'cancelled';
  const nextStage = open ? DEAL_STAGES[DEAL_STAGES.indexOf(d.stage) + 1] : null;
  const done = () => { setSheet(null); bump(); reload(); };
  const guard = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok, 'success'); done(); } catch (e: any) { toast(e instanceof DomainError ? e.message : 'Something went wrong', 'error'); } };
  const advance = async () => {
    if (!nextStage || nextStage === 'cancelled') return;
    if (nextStage === 'completed' && bal.outstanding > 0) {
      if (!(await confirm(`${rs(bal.outstanding)} is still outstanding. Complete the deal with an open balance?`, { title: 'Open balance', okLabel: 'Complete anyway', danger: true }))) return;
      return guard(async () => { const r = await DealRepo.advanceStage(did, 'completed', { allowOutstanding: true }); if (r.warnings[0]) toast(r.warnings[0]); }, 'Deal completed');
    }
    if (nextStage === 'completed' && !(await confirm(`Complete this deal? ${data.prop.title} will be marked as ${d.transactionType === 'rent' ? 'rented' : 'sold'}.`, { title: 'Complete deal', okLabel: 'Complete' }))) return;
    guard(async () => { const r = await DealRepo.advanceStage(did, nextStage); if (r.warnings[0]) toast(r.warnings[0]); }, `Moved to ${STAGE_LABEL[nextStage]}`);
  };
  const reserved = data.prop.availability === 'reserved' && data.prop.reservedByDealId === did;
  const reserve = async () => { if (await confirm(`Reserve ${data.prop.title} for this deal? No other deal can reserve or complete it until you release it.`, { title: 'Reserve property', okLabel: 'Reserve' })) guard(() => DealRepo.reserveProperty(did, true), 'Property reserved'); };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={d.code} subtitle={d.propertyTitle} back large={false} right={<IconButton icon="ellipsis-horizontal" label="More" tone="soft" onPress={() => setMenu(true)} />} />
      <Screen contentStyle={{ paddingBottom: space.xxl }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Badge label={STAGE_LABEL[d.stage]} tone={STAGE_TONE[d.stage]} /><Badge label={AVAIL_META[data.prop.availability].label} tone={AVAIL_META[data.prop.availability].tone} /></View>
          <T v="overline" color={c.textMuted} style={{ marginTop: space.md }}>{d.transactionType === 'rent' ? 'Rent / month' : 'Agreed price'}</T>
          <T v="display">{d.agreedPrice ? rs(d.agreedPrice) : 'Not agreed yet'}</T>{d.agreedPrice ? <T v="body" color={c.textMuted}>{moneyWords(d.agreedPrice)}</T> : null}
          {d.agreedPrice ? (<View style={{ marginTop: space.md, gap: 6 }}><Progress value={Math.min(1, bal.heldFromBuyer / d.agreedPrice)} tone={bal.outstanding === 0 ? 'success' : 'primary'} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="caption" color={c.textMuted}>Received {rs(bal.heldFromBuyer)}</T><T v="caption" color={bal.outstanding ? c.warning : c.success}>{bal.outstanding ? `Outstanding ${rs(bal.outstanding)}` : bal.overpaid ? `Overpaid ${rs(bal.overpaid)}` : 'Fully paid'}</T></View></View>) : null}
          <View style={{ marginTop: space.md, gap: 2 }}><T v="body">{d.transactionType === 'rent' ? 'Tenant' : 'Buyer'}: <T v="bodyStrong">{d.buyerName || '—'}</T></T><T v="body">{d.transactionType === 'rent' ? 'Landlord' : 'Seller'}: <T v="bodyStrong">{d.sellerName || '—'}</T></T></View>
        </Card>
        {open ? (<View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' }}>
          {nextStage && nextStage !== 'cancelled' ? <Button icon="arrow-forward" label={`Move to ${STAGE_LABEL[nextStage]}`} onPress={advance} /> : null}
          {reserved ? <Button variant="soft" icon="lock-open" label="Release reservation" onPress={() => guard(() => DealRepo.releaseReservation(did), 'Reservation released')} /> : <Button variant="soft" icon="lock-closed" label="Reserve property" onPress={reserve} />}
        </View>) : null}
        {d.stage === 'cancelled' ? <Card style={{ marginTop: space.md }}><T v="label" color={c.danger}>Cancelled</T><T v="body">{d.cancelReason}</T><T v="caption" color={c.textMuted}>All payments and history stay on record. Refund money from the Payments tab if needed.</T></Card> : null}

        <View style={{ marginVertical: space.lg }}><Segmented<Tab> value={tab} onChange={setTab} options={[{ key: 'progress', label: 'Progress' }, { key: 'payments', label: 'Payments' }, { key: 'schedule', label: 'Schedule' }, { key: 'commission', label: 'Commission' }]} /></View>

        {tab === 'progress' ? (<>
          <Card pad={0}>{DEAL_STAGES.filter((s) => s !== 'cancelled').map((s, i, arr) => {
            const h = data.hist.find((x) => x.to_stage === s); const cur = d.stage === s;
            return <Row key={s} leading={<Ionicons name={h ? 'checkmark-circle' : cur ? 'ellipse' : 'ellipse-outline'} size={26} color={h ? c.success : c.textFaint} />} title={STAGE_LABEL[s]} subtitle={h ? `${Fmt.dateTime(h.at)}${h.note ? ' · ' + h.note : ''}` : undefined} last={i === arr.length - 1} />;
          })}</Card>
          {data.hist.find((h) => h.to_stage === 'cancelled') ? <Card pad={0} style={{ marginTop: space.md }}><Row icon="close-circle" iconColor={c.danger} title="Cancelled" subtitle={`${Fmt.dateTime(data.hist.find((h) => h.to_stage === 'cancelled')!.at)} · ${d.cancelReason}`} last /></Card> : null}
          {d.paymentTerms ? <Card style={{ marginTop: space.md }}><T v="label" color={c.textMuted}>Payment terms</T><T v="body">{d.paymentTerms}</T></Card> : null}
          {d.notes ? <Card style={{ marginTop: space.md }}><T v="label" color={c.textMuted}>Notes</T><T v="body">{d.notes}</T></Card> : null}
        </>) : null}

        {tab === 'payments' ? (<>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginBottom: space.md }}>
            <Button icon="add" label="Record payment" onPress={() => setSheet('pay')} disabled={d.stage === 'cancelled'} />
            <Button variant="soft" icon="arrow-undo" label="Refund" onPress={() => setSheet('refund')} disabled={bal.heldFromBuyer <= 0} />
            <Button variant="soft" icon="arrow-forward-circle" label="Pay seller" onPress={() => setSheet('seller')} disabled={!d.sellerId} />
          </View>
          <Card style={{ marginBottom: space.md }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><View><T v="caption" color={c.textMuted}>Collected</T><T v="bodyStrong">{rs(bal.collected)}</T></View><View><T v="caption" color={c.textMuted}>Refunded</T><T v="bodyStrong">{rs(bal.refunded)}</T></View><View><T v="caption" color={c.textMuted}>Paid to seller</T><T v="bodyStrong">{rs(bal.paidToSeller)}</T></View></View>
            <T v="caption" color={c.textMuted} style={{ marginTop: 8 }}>Customer money is held separately and is never counted as your income.</T></Card>
          {data.pays.length ? <Card pad={0}>{data.pays.map((p, i) => <PayRow key={p.id} p={p} last={i === data.pays.length - 1} onReverse={async () => { if (await confirm(`Reverse ${p.code} (${rs(p.amount)})? A reversal entry is added; the original stays on record.`, { title: 'Reverse payment', okLabel: 'Reverse', danger: true })) guard(() => DealRepo.reversePayment(p.id, 'Reversed by user'), 'Payment reversed'); }} />)}</Card>
            : <EmptyState icon="cash-outline" title="No payments yet" message="Record token, bayana and installments as money comes in." />}
        </>) : null}

        {tab === 'schedule' ? (<>
          {data.sched.length ? <Card pad={0}>{data.sched.map((s, i) => <Row key={s.seq} leading={<Ionicons name={s.state === 'paid' ? 'checkmark-circle' : s.state === 'overdue' ? 'alert-circle' : 'time-outline'} size={26} color={s.state === 'paid' ? c.success : s.state === 'overdue' ? c.danger : c.textFaint} />} title={`#${s.seq} · ${rs(s.amount)}`} subtitle={`Due ${Fmt.date(s.dueDate, true)}${s.applied ? ` · paid ${rs(s.applied)}` : ''}`} right={<Badge label={s.state === 'upcoming' ? 'Upcoming' : s.state[0].toUpperCase() + s.state.slice(1)} tone={s.state === 'paid' ? 'success' : s.state === 'overdue' ? 'danger' : s.state === 'partial' ? 'warning' : 'neutral'} />} last={i === data.sched.length - 1} />)}</Card>
            : <EmptyState icon="calendar-outline" title="No installment schedule" message="Split the price into equal monthly installments, or leave it open." />}
          <T v="caption" color={c.textMuted} style={{ marginVertical: space.md }}>Payments are applied to the oldest installment first.</T>
          {open ? <Button icon="calendar" label={data.sched.length ? 'Replace schedule' : 'Create schedule'} onPress={() => setSheet('schedule')} disabled={!d.agreedPrice} /> : null}
          {!d.agreedPrice ? <T v="caption" color={c.textMuted} style={{ marginTop: 6 }}>Set the agreed price first.</T> : null}
        </>) : null}

        {tab === 'commission' ? (<>
          {com ? (<>
            <Card><T v="overline" color={c.textMuted}>Finalised commission</T><T v="display">{rs(com.total)}</T><T v="caption" color={c.textMuted}>Frozen on {Fmt.date(com.finalizedAt)} against a price of {rs(com.snapshot.agreedPrice)}. Later changes never alter it.</T>
              <View style={{ marginTop: space.md, gap: 6 }}><Progress value={com.total ? Math.min(1, com.received / com.total) : 0} tone="success" /><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="caption" color={c.textMuted}>Received from client {rs(com.received)}</T><T v="caption" color={com.pendingFromClient ? c.warning : c.success}>{com.pendingFromClient ? `Pending ${rs(com.pendingFromClient)}` : 'Fully received'}</T></View></View></Card>
            <View style={{ marginTop: space.md }}><Button icon="download" label="Record commission received" onPress={() => setSheet('received')} disabled={com.pendingFromClient === 0} /></View>
            <T v="overline" color={c.textMuted} style={{ marginTop: space.xl, marginBottom: space.sm }}>Participants</T>
            <Card pad={0}>{com.lines.map((l, i) => <Row key={l.shareId} icon="person" title={l.name} subtitle={`${l.role.replace(/_/g, ' ')} · share ${rs(l.payable)} · paid ${rs(l.paid)}`} right={<View style={{ alignItems: 'flex-end', gap: 4 }}><T v="bodyStrong" color={l.remaining ? c.warning : c.success}>{l.remaining ? rs(l.remaining) : 'Settled'}</T>{l.remaining ? <Button size="sm" variant="soft" label="Pay" onPress={() => setSheet({ payout: l.shareId })} /> : null}</View>} last={i === com.lines.length - 1} />)}</Card>
            {!data.pays.some((p) => p.kind === 'commission_paid') && d.stage !== 'cancelled' ? <View style={{ marginTop: space.md }}><Button variant="ghost" icon="create" label="Re-finalise agreement" onPress={() => setSheet('commission')} /></View> : null}
          </>) : (<>
            <EmptyState icon="calculator-outline" title="No commission agreement" message="Set the commission terms and how it is shared between dealers. The result is frozen as a snapshot." />
            {d.stage !== 'cancelled' ? <Button icon="calculator" label="Finalise commission" onPress={() => setSheet('commission')} disabled={!d.agreedPrice} /> : null}
            {!d.agreedPrice ? <T v="caption" color={c.textMuted} style={{ marginTop: 6 }}>Set the agreed price first.</T> : null}
          </>)}
        </>) : null}
      </Screen>

      <ActionMenu visible={menu} onClose={() => setMenu(false)} title={d.code} actions={[
        { label: 'Open property', icon: 'home', onPress: () => router.push({ pathname: '/property/[id]', params: { id: String(d.propertyId) } }) },
        ...(open ? [{ label: 'Edit price & terms', icon: 'create' as const, onPress: () => setSheet('terms') }, { label: 'Cancel deal', icon: 'close-circle' as const, danger: true, onPress: () => setSheet('cancel') }] : []),
      ]} />
      <PaySheet visible={sheet === 'pay' || sheet === 'refund' || sheet === 'seller'} mode={sheet === 'refund' ? 'refund' : sheet === 'seller' ? 'seller' : 'in'} maxRefund={bal.heldFromBuyer} onClose={() => setSheet(null)} onSave={(kind, amount, method, ref) => guard(() => DealRepo.addPayment({ dealId: did, kind: kind as any, amount, method, reference: ref }), 'Payment recorded')} />
      <TermsSheet visible={sheet === 'terms'} onClose={() => setSheet(null)} deal={d} onSave={(v) => guard(() => DealRepo.updateTerms(did, v), 'Deal updated')} />
      <CancelSheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} paid={bal.heldFromBuyer} onSave={(r) => guard(() => DealRepo.cancelDeal(did, r), 'Deal cancelled')} />
      <ScheduleSheet visible={sheet === 'schedule'} onClose={() => setSheet(null)} total={d.agreedPrice ?? 0} onSave={(s) => guard(() => DealRepo.setSchedule(did, s), 'Schedule saved')} />
      <CommissionSheet visible={sheet === 'commission'} onClose={() => setSheet(null)} price={d.agreedPrice ?? 0} onSave={(sides, parts) => guard(() => DealRepo.finalizeCommission(did, sides, parts), 'Commission finalised')} />
      <AmountSheet visible={sheet === 'received'} title="Commission received from client" max={com?.pendingFromClient ?? 0} onClose={() => setSheet(null)} onSave={(a, m, r) => guard(() => DealRepo.recordCommissionReceived(did, a, { method: m, reference: r }), 'Commission recorded')} />
      <AmountSheet visible={typeof sheet === 'object' && sheet !== null} title="Pay commission share" max={typeof sheet === 'object' && sheet ? com?.lines.find((l) => l.shareId === sheet.payout)?.remaining ?? 0 : 0} onClose={() => setSheet(null)} onSave={(a, m, r) => guard(() => DealRepo.payCommissionShare((sheet as any).payout, a, { method: m, reference: r }), 'Payout recorded')} />
    </View>
  );
}

function PayRow({ p, last, onReverse }: { p: Payment; last: boolean; onReverse: () => void }) {
  const { c } = useTheme(); const isRev = p.reversalOf != null; const out = p.kind === 'refund' || p.kind === 'seller_payment' || p.kind === 'commission_paid';
  return <Row icon={isRev ? 'arrow-undo' : out ? 'arrow-up-circle' : 'arrow-down-circle'} iconColor={isRev ? c.warning : out ? c.danger : c.success} title={`${isRev ? 'Reversal · ' : ''}${KIND_LABEL[p.kind]} · ${rs(p.amount)}`} subtitle={`${p.code} · ${Fmt.date(p.paidAt, true)} · ${METHOD_LABEL[p.method]}${p.reference ? ' · ' + p.reference : ''}${p.reversed ? ' · reversed' : ''}`}
    right={!isRev && !p.reversed ? <Button size="sm" variant="ghost" label="Reverse" onPress={onReverse} /> : undefined} last={last} />;
}

function MethodChips({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>{PAYMENT_METHODS.map((m) => <Chip key={m} label={METHOD_LABEL[m]} selected={value === m} onPress={() => onChange(m)} />)}</View>;
}

function PaySheet({ visible, mode, maxRefund, onClose, onSave }: { visible: boolean; mode: 'in' | 'refund' | 'seller'; maxRefund: number; onClose: () => void; onSave: (k: PaymentKind, a: number, m: PaymentMethod, ref: string) => void }) {
  const { c } = useTheme(); const [kind, setKind] = useState<PaymentKind>('installment'); const [amt, setAmt] = useState(''); const [m, setM] = useState<PaymentMethod>('cash'); const [ref, setRef] = useState('');
  React.useEffect(() => { if (visible) { setAmt(''); setRef(''); setKind(mode === 'in' ? 'installment' : mode === 'refund' ? 'refund' : 'seller_payment'); } }, [visible, mode]);
  const a = parseMoney(amt);
  return (
    <Sheet visible={visible} onClose={onClose} title={mode === 'refund' ? 'Refund to buyer' : mode === 'seller' ? 'Pay seller (pass-through)' : 'Record payment'} tall footer={<Button block icon="checkmark" label="Save" disabled={!a || a <= 0} onPress={() => a && onSave(kind, a, m, ref)} />}>
      {mode === 'in' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>{IN_KINDS.map((k) => <Chip key={k} label={KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />)}</View> : null}
      {mode === 'refund' ? <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>You can refund up to {rs(maxRefund)}, the amount currently held for this deal.</T> : null}
      <MoneyField label="Amount" value={amt} onChangeText={setAmt} />
      <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Method</T><MethodChips value={m} onChange={setM} />
      <Field label="Reference / cheque no." value={ref} onChangeText={setRef} placeholder="Optional" />
    </Sheet>
  );
}

function AmountSheet({ visible, title, max, onClose, onSave }: { visible: boolean; title: string; max: number; onClose: () => void; onSave: (a: number, m: PaymentMethod, ref: string) => void }) {
  const [amt, setAmt] = useState(''); const [m, setM] = useState<PaymentMethod>('cash'); const [ref, setRef] = useState(''); const { c } = useTheme();
  React.useEffect(() => { if (visible) { setAmt(max ? String(max) : ''); setRef(''); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = parseMoney(amt);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} footer={<Button block icon="checkmark" label="Save" disabled={!a || a <= 0 || a > max} onPress={() => a && onSave(a, m, ref)} />}>
      <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>Up to {rs(max)} remaining.</T>
      <MoneyField label="Amount" value={amt} onChangeText={setAmt} /><T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Method</T><MethodChips value={m} onChange={setM} /><Field label="Reference" value={ref} onChangeText={setRef} placeholder="Optional" />
    </Sheet>
  );
}

function TermsSheet({ visible, onClose, deal, onSave }: { visible: boolean; onClose: () => void; deal: { agreedPrice: number | null; paymentTerms: string; notes: string }; onSave: (v: { agreedPrice: number | null; paymentTerms: string; notes: string }) => void }) {
  const [price, setPrice] = useState(''); const [terms, setTerms] = useState(''); const [notes, setNotes] = useState('');
  React.useEffect(() => { if (visible) { setPrice(deal.agreedPrice ? String(deal.agreedPrice) : ''); setTerms(deal.paymentTerms); setNotes(deal.notes); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = price.trim() ? parseMoney(price) : null;
  return (
    <Sheet visible={visible} onClose={onClose} title="Price & terms" tall footer={<Button block icon="checkmark" label="Save" disabled={price.trim() !== '' && (p === null || p <= 0)} onPress={() => onSave({ agreedPrice: p, paymentTerms: terms, notes })} />}>
      <MoneyField label="Agreed price" value={price} onChangeText={setPrice} /><Field label="Payment terms" value={terms} onChangeText={setTerms} multiline /><Field label="Notes" value={notes} onChangeText={setNotes} multiline />
    </Sheet>
  );
}

function CancelSheet({ visible, onClose, paid, onSave }: { visible: boolean; onClose: () => void; paid: number; onSave: (reason: string) => void }) {
  const { c } = useTheme(); const [r, setR] = useState(''); React.useEffect(() => { if (visible) setR(''); }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Cancel deal" footer={<Button block variant="danger" icon="close-circle" label="Cancel this deal" disabled={!r.trim()} onPress={() => onSave(r)} />}>
      <T v="body" color={c.textMuted} style={{ marginBottom: space.md }}>History, payments and the commission snapshot stay on record.{paid > 0 ? ` ${rs(paid)} is held for this deal; refund it from the Payments tab.` : ''} The property goes back to available unless another deal is open.</T>
      <Field label="Reason *" value={r} onChangeText={setR} placeholder="e.g. Buyer could not arrange funds" multiline />
    </Sheet>
  );
}

function ScheduleSheet({ visible, onClose, total, onSave }: { visible: boolean; onClose: () => void; total: number; onSave: (s: { seq: number; dueDate: string; amount: number }[]) => void }) {
  const { c } = useTheme(); const { toast } = useApp(); const [n, setN] = useState('6'); const [first, setFirst] = useState(todayYmd()); const [every, setEvery] = useState('1');
  React.useEffect(() => { if (visible) { setFirst(todayYmd()); } }, [visible]);
  const go = () => { try { if (!isYmd(first)) throw new Error('First due date must be YYYY-MM-DD'); onSave(buildInstallments(total, Number(n), first, Number(every) || 1)); } catch (e: any) { toast(e.message, 'error'); } };
  return (
    <Sheet visible={visible} onClose={onClose} title="Installment schedule" footer={<Button block icon="checkmark" label="Create schedule" onPress={go} />}>
      <T v="body" color={c.textMuted} style={{ marginBottom: space.md }}>Splits {rs(total)} into equal installments. Any rounding remainder goes to the last one.</T>
      <View style={{ flexDirection: 'row', gap: space.md }}><Field style={{ flex: 1 }} label="Installments" value={n} onChangeText={setN} keyboardType="number-pad" /><Field style={{ flex: 1 }} label="Every (months)" value={every} onChangeText={setEvery} keyboardType="number-pad" /></View>
      <Field label="First due date" value={first} onChangeText={setFirst} placeholder="YYYY-MM-DD" />
    </Sheet>
  );
}

type Side = { type: 'none' | 'percent' | 'fixed'; value: string };
function CommissionSheet({ visible, onClose, price, onSave }: { visible: boolean; onClose: () => void; price: number; onSave: (sides: { buyer?: CommissionTerms; seller?: CommissionTerms }, parts: { personId: number; role: string; shareBps?: number; fixedAmount?: number }[]) => void }) {
  const { c } = useTheme(); const { toast } = useApp();
  const [seller, setSeller] = useState<Side>({ type: 'percent', value: '1' }); const [buyer, setBuyer] = useState<Side>({ type: 'percent', value: '1' });
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent'); const [rows, setRows] = useState<{ id: number | null; role: string; v: string }[]>([{ id: null, role: 'listing_dealer', v: '100' }]);
  React.useEffect(() => { if (visible) { setRows([{ id: null, role: 'listing_dealer', v: '100' }]); setMode('percent'); } }, [visible]);
  const term = (s: Side): CommissionTerms | undefined => (s.type === 'none' ? undefined : s.type === 'percent' ? { type: 'percent', bps: percentToBps(Number(s.value) || 0) } : { type: 'fixed', amount: parseMoney(s.value) ?? 0 });
  const total = (['seller', 'buyer'] as const).reduce((a, k) => { const s = k === 'seller' ? seller : buyer; return a + (s.type === 'percent' ? Math.floor((price * percentToBps(Number(s.value) || 0) + 5000) / 10000) : s.type === 'fixed' ? parseMoney(s.value) ?? 0 : 0); }, 0);
  const go = () => {
    if (rows.some((r) => r.id == null)) { toast('Choose a person for every participant', 'error'); return; }
    onSave({ seller: term(seller), buyer: term(buyer) }, rows.map((r) => ({ personId: r.id!, role: r.role, ...(mode === 'percent' ? { shareBps: percentToBps(Number(r.v) || 0) } : { fixedAmount: parseMoney(r.v) ?? 0 }) })));
  };
  const SideEditor = ({ label, s, set }: { label: string; s: Side; set: (v: Side) => void }) => (
    <View style={{ marginBottom: space.md }}><T v="label" color={c.textMuted} style={{ marginBottom: 6 }}>{label}</T><Segmented<'none' | 'percent' | 'fixed'> value={s.type} onChange={(t) => set({ ...s, type: t })} options={[{ key: 'none', label: 'None' }, { key: 'percent', label: 'Percent' }, { key: 'fixed', label: 'Fixed' }]} />
      {s.type !== 'none' ? <Field style={{ marginTop: space.sm }} label={s.type === 'percent' ? '% of agreed price' : 'Amount'} value={s.value} onChangeText={(v) => set({ ...s, value: v })} keyboardType="default" /> : null}</View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Finalise commission" tall footer={<Button block icon="lock-closed" label={`Freeze ${rs(total)}`} onPress={go} disabled={total <= 0} />}>
      <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>Based on the agreed price {rs(price)}. Once finalised the figures are frozen.</T>
      <SideEditor label="Seller-side commission" s={seller} set={setSeller} /><SideEditor label="Buyer-side commission" s={buyer} set={setBuyer} />
      <T v="label" color={c.textMuted} style={{ marginVertical: 6 }}>Who shares it (use a contact for your own office too)</T>
      <View style={{ marginBottom: space.md }}><Segmented<'percent' | 'fixed'> value={mode} onChange={(m) => { setMode(m); setRows((r) => r.map((x) => ({ ...x, v: m === 'percent' ? '0' : '' }))); }} options={[{ key: 'percent', label: 'By percent' }, { key: 'fixed', label: 'By amount' }]} /></View>
      {rows.map((r, i) => (
        <View key={i} style={{ marginBottom: space.md }}><CustomerPicker label={`Participant ${i + 1}`} value={r.id} onChange={(id) => setRows((x) => x.map((y, k) => (k === i ? { ...y, id } : y)))} optional={false} />
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginBottom: space.sm }}>{(['listing_dealer', 'buyer_dealer', 'own_office', 'other'] as const).map((role) => <Chip key={role} label={role.replace(/_/g, ' ')} selected={r.role === role} onPress={() => setRows((x) => x.map((y, k) => (k === i ? { ...y, role } : y)))} />)}</View>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}><Field style={{ flex: 1 }} label={mode === 'percent' ? 'Share %' : 'Amount'} value={r.v} onChangeText={(v) => setRows((x) => x.map((y, k) => (k === i ? { ...y, v } : y)))} /> {rows.length > 1 ? <Button variant="ghost" icon="trash" label="Remove" onPress={() => setRows((x) => x.filter((_, k) => k !== i))} /> : null}</View></View>
      ))}
      <Button variant="soft" icon="add" label="Add participant" onPress={() => setRows((r) => [...r, { id: null, role: 'buyer_dealer', v: mode === 'percent' ? '0' : '' }])} />
    </Sheet>
  );
}
