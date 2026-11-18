import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { PropertyRepo } from '../../db/propertyRepo';
import { DomainError } from '../../domain/errors';
import { isYmd, parseMoney, todayYmd } from '../../lib/estate';
import { space } from '../../lib/theme';
import { Button, Chip, Field, Header, Screen, Segmented, T } from '../../ui/kit';
import { CustomerPicker } from '../../ui/CustomerPicker';
import { MoneyField } from '../../ui/estate';

const SOURCES = [{ key: 'own', label: 'My listing' }, { key: 'dealer', label: 'Other dealer' }, { key: 'owner', label: 'Owner direct' }];

export default function ListingEdit() {
  const { propertyId, id } = useLocalSearchParams<{ propertyId?: string; id?: string }>();
  const editing = id ? Number(id) : null; const router = useRouter(); const { c } = useTheme(); const insets = useSafeAreaInsets(); const { toast, bump } = useApp();
  const [pid, setPid] = useState(propertyId ? Number(propertyId) : 0);
  const [f, setF] = useState({ price: '', min: '', ctype: 'none' as 'none' | 'percent' | 'fixed', cval: '', terms: '', start: todayYmd(), expiry: '', marketing: '', description: '' });
  const [source, setSource] = useState('own'); const [dealer, setDealer] = useState<number | null>(null); const [owner, setOwner] = useState<number | null>(null);
  const [start, setStart] = useState<'draft' | 'active'>('active'); const [err, setErr] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: any) => { setF((p) => ({ ...p, [k]: v })); setErr({}); };
  useEffect(() => { if (!editing) return; (async () => { const l = await PropertyRepo.getListing(editing); if (!l) return; setPid(l.propertyId); setSource(l.source); setDealer(l.dealerId); setOwner(l.ownerId);
    setF({ price: String(l.askingPrice), min: l.minPrice == null ? '' : String(l.minPrice), ctype: l.commissionType, cval: l.commissionValue ? String(l.commissionValue) : '', terms: l.commissionTerms, start: l.startDate, expiry: l.expiryDate, marketing: l.marketingPermissions, description: l.description }); })(); }, [editing]);

  const save = async () => {
    const e: Record<string, string> = {}; const price = parseMoney(f.price), min = f.min.trim() ? parseMoney(f.min) : null;
    if (price === null || price <= 0) e.price = 'Enter the asking price';
    if (f.min.trim() && min === null) e.min = 'Enter a valid amount';
    if (f.start && !isYmd(f.start)) e.start = 'Use YYYY-MM-DD'; if (f.expiry && !isYmd(f.expiry)) e.expiry = 'Use YYYY-MM-DD';
    if (f.ctype !== 'none' && !(Number(f.cval) > 0)) e.cval = 'Enter the commission value';
    if (Object.keys(e).length) { setErr(e); return; }
    setBusy(true);
    try {
      const cv = f.ctype === 'fixed' ? (parseMoney(f.cval) ?? 0) : Number(f.cval) || 0;
      const base = { askingPrice: price!, minPrice: min, dealerId: dealer, ownerId: owner, source, commissionType: f.ctype, commissionValue: f.ctype === 'none' ? 0 : cv, commissionTerms: f.terms, startDate: f.start, expiryDate: f.expiry, marketingPermissions: f.marketing, description: f.description };
      if (editing) await PropertyRepo.updateListing(editing, base); else await PropertyRepo.createListing({ propertyId: pid, status: start, ...base });
      bump(); toast(editing ? 'Listing updated' : 'Listing created', 'success'); router.back();
    } catch (x: any) { toast(x instanceof DomainError ? x.message : 'Could not save the listing', 'error'); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={editing ? 'Edit listing' : 'New listing'} back large={false} modal />
      <Screen bottomInset={false} contentStyle={{ paddingBottom: space.xl }} stickyFooter={<View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}><Button block icon="checkmark" label={editing ? 'Save changes' : 'Create listing'} onPress={save} loading={busy} /></View>}>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Listing source</T>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginBottom: space.lg }}>{SOURCES.map((s) => <Chip key={s.key} label={s.label} selected={source === s.key} onPress={() => setSource(s.key)} />)}</View>
        <CustomerPicker label="Responsible dealer" value={dealer} onChange={setDealer} />
        <CustomerPicker label="Owner (seller)" value={owner} onChange={setOwner} />
        <MoneyField label="Asking price *" value={f.price} onChangeText={set('price')} error={err.price} />
        <MoneyField label="Minimum acceptable price (private)" value={f.min} onChangeText={set('min')} error={err.min} placeholder="Never shown when sharing" />
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Commission terms</T>
        <View style={{ marginBottom: space.md }}><Segmented<'none' | 'percent' | 'fixed'> value={f.ctype} onChange={set('ctype')} options={[{ key: 'none', label: 'None' }, { key: 'percent', label: 'Percent' }, { key: 'fixed', label: 'Fixed' }]} /></View>
        {f.ctype !== 'none' ? <Field label={f.ctype === 'percent' ? 'Commission %' : 'Commission amount'} value={f.cval} onChangeText={set('cval')} keyboardType="decimal-pad" error={err.cval} placeholder={f.ctype === 'percent' ? '2' : '50000'} /> : null}
        <Field label="Commission notes" value={f.terms} onChangeText={set('terms')} placeholder="e.g. 1% from each side" />
        <View style={{ flexDirection: 'row', gap: space.md }}><Field style={{ flex: 1 }} label="Start date" value={f.start} onChangeText={set('start')} placeholder="YYYY-MM-DD" error={err.start} /><Field style={{ flex: 1 }} label="Expiry date" value={f.expiry} onChangeText={set('expiry')} placeholder="YYYY-MM-DD" error={err.expiry} /></View>
        <Field label="Marketing permissions" value={f.marketing} onChangeText={set('marketing')} placeholder="e.g. WhatsApp groups allowed, no signboard" />
        <Field label="Listing description" value={f.description} onChangeText={set('description')} multiline />
        {!editing ? (<><T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Start as</T><Segmented<'draft' | 'active'> value={start} onChange={setStart} options={[{ key: 'active', label: 'Active' }, { key: 'draft', label: 'Draft' }]} /></>) : null}
      </Screen>
    </View>
  );
}
