import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData } from '../../lib/hooks';
import { PropertyRepo } from '../../db/propertyRepo';
import { DealRepo } from '../../db/dealRepo';
import { DomainError } from '../../domain/errors';
import { parseMoney, rs } from '../../lib/estate';
import { space } from '../../lib/theme';
import { Badge, Button, Card, Chip, Field, Header, Screen, T } from '../../ui/kit';
import { CustomerPicker } from '../../ui/CustomerPicker';
import { AVAIL_META, MoneyField, areaLabel, locationLine } from '../../ui/estate';
import { LISTING_META } from '../../ui/estate';

export default function NewDeal() {
  const { propertyId } = useLocalSearchParams<{ propertyId?: string }>();
  const router = useRouter(); const { c } = useTheme(); const insets = useSafeAreaInsets(); const { toast, bump, confirm } = useApp();
  const [buyer, setBuyer] = useState<number | null>(null); const [seller, setSeller] = useState<number | null>(null); const [listingId, setListingId] = useState<number | null>(null);
  const [price, setPrice] = useState(''); const [terms, setTerms] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<Record<string, string>>({});
  const pid = Number(propertyId);
  const { data } = useData(async () => { const p = await PropertyRepo.getProperty(pid); if (!p) return null; const [own, listings] = await Promise.all([PropertyRepo.getOwnership(pid), PropertyRepo.listingsForProperty(pid)]); return { p, own, listings: listings.filter((l) => l.status === 'active' || l.status === 'paused') }; }, [pid]);
  useEffect(() => { if (data && seller == null && data.own.current.length === 1) setSeller(data.own.current[0].personId); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg }}><Header title="New deal" back large={false} modal /></View>;
  const { p } = data; const closed = p.availability === 'sold' || p.availability === 'rented';

  const save = async () => {
    const e: Record<string, string> = {}; const amt = price.trim() ? parseMoney(price) : null;
    if (buyer == null) e.buyer = 'Choose the buyer'; if (price.trim() && (amt === null || amt <= 0)) e.price = 'Enter a valid price';
    if (Object.keys(e).length) { setErr(e); toast(e.buyer ?? e.price, 'error'); return; }
    if (p.availability === 'reserved' && !(await confirm('This property is reserved for another deal. You can still open a deal, but it will not change the reservation.', { title: 'Property is reserved', okLabel: 'Open deal' }))) return;
    setBusy(true);
    try {
      const id = await DealRepo.createDeal({ propertyId: pid, buyerId: buyer!, sellerId: seller, listingId, agreedPrice: amt, paymentTerms: terms });
      bump(); toast('Deal opened', 'success'); router.replace({ pathname: '/deal/[id]', params: { id: String(id) } });
    } catch (x: any) { toast(x instanceof DomainError ? x.message : 'Could not open the deal', 'error'); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="New deal" back large={false} modal />
      <Screen bottomInset={false} contentStyle={{ paddingBottom: space.xl }} stickyFooter={<View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}><Button block icon="checkmark" label="Open deal" onPress={save} loading={busy} disabled={closed} /></View>}>
        <Card style={{ marginBottom: space.lg }}><T v="overline" color={c.textMuted}>{p.code}</T><T v="heading">{p.title}</T><T v="caption" color={c.textMuted}>{locationLine(p)} · {areaLabel(p)}</T><View style={{ marginTop: 8, flexDirection: 'row' }}><Badge label={AVAIL_META[p.availability].label} tone={AVAIL_META[p.availability].tone} /></View></Card>
        {closed ? <Card style={{ marginBottom: space.lg }}><T v="body" color={c.danger}>This property is already {p.availability}. Reopen it from the property screen before starting a new deal.</T></Card> : null}
        <CustomerPicker label={p.transactionType === 'rent' ? 'Tenant *' : 'Buyer *'} value={buyer} onChange={(i) => { setBuyer(i); setErr({}); }} optional={false} />
        {err.buyer ? <T v="caption" color={c.danger} style={{ marginTop: -space.md, marginBottom: space.md }}>{err.buyer}</T> : null}
        <CustomerPicker label={p.transactionType === 'rent' ? 'Landlord' : 'Seller'} value={seller} onChange={setSeller} />
        {data.listings.length ? (<><T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Related listing</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
          <Chip label="None" selected={listingId == null} onPress={() => setListingId(null)} />
          {data.listings.map((l) => <Chip key={l.id} label={`${l.code} · ${rs(l.askingPrice)}`} selected={listingId === l.id} onPress={() => { setListingId(l.id); if (!price) setPrice(String(l.askingPrice)); }} />)}</View></>) : null}
        <MoneyField label="Agreed / offered price" value={price} onChangeText={(v) => { setPrice(v); setErr({}); }} error={err.price} placeholder="Can be set later" />
        <Field label="Payment terms" value={terms} onChangeText={setTerms} placeholder="e.g. 20% bayana, rest in 4 installments" multiline />
      </Screen>
    </View>
  );
}
