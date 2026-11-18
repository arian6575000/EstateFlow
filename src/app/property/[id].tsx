import React, { useState } from 'react';
import { Image, ScrollView, Share, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData } from '../../lib/hooks';
import { PropertyRepo } from '../../db/propertyRepo';
import { DealRepo } from '../../db/dealRepo';
import { Repo } from '../../db/repo';
import { AvailabilityAction, LISTING_STATUSES, ListingStatus, canMoveListing } from '../../domain/availability';
import { DomainError } from '../../domain/errors';
import { VERIFICATION, Verification } from '../../domain/ownership';
import { deleteFiles, fileUri, pickPhotos } from '../../lib/files';
import { Fmt } from '../../lib/format';
import { moneyWords, rs, shareText, todayYmd } from '../../lib/estate';
import { CREDIT } from '../../lib/brand';
import { radius, space } from '../../lib/theme';
import { Badge, Button, Card, EmptyState, Field, Header, IconButton, ListSkeleton, Pressy, Row, Screen, Segmented, T } from '../../ui/kit';
import { ActionMenu, OptionSheet, Sheet } from '../../ui/Sheet';
import { CustomerPicker } from '../../ui/CustomerPicker';
import { AVAIL_META, CATEGORY_LABEL, LISTING_META, STAGE_LABEL, STAGE_TONE, areaLabel, locationLine } from '../../ui/estate';
import { UNIT_LABEL, convertArea } from '../../domain/units';

type Tab = 'overview' | 'ownership' | 'listings' | 'deals';
const VERIF_LABEL: Record<Verification, string> = { unverified: 'Not verified', documents_seen: 'Documents seen', dealer_verified: 'Dealer verified' };

export default function PropertyDetails() {
  const { id } = useLocalSearchParams<{ id: string }>(); const pid = Number(id);
  const router = useRouter(); const { c } = useTheme(); const { toast, confirm, bump } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [menu, setMenu] = useState(false); const [availMenu, setAvailMenu] = useState(false);
  const [ownEdit, setOwnEdit] = useState(false); const [listMenu, setListMenu] = useState<number | null>(null); const [verif, setVerif] = useState<number | null>(null);
  const [histFor, setHistFor] = useState<number | null>(null);

  const { data, loading, reload } = useData(async () => {
    const p = await PropertyRepo.getProperty(pid); if (!p) return null;
    PropertyRepo.markViewed(pid).catch(() => {});
    const [photos, own, listings, deals, availHist, price, favs] = await Promise.all([PropertyRepo.listPhotos(pid), PropertyRepo.getOwnership(pid), PropertyRepo.listingsForProperty(pid), DealRepo.listDeals({ propertyId: pid }), PropertyRepo.availabilityHistory(pid), PropertyRepo.currentAskingPrice(pid), PropertyRepo.favorites()]);
    return { p, photos, own, listings, deals, availHist, price, fav: favs.includes(pid) };
  }, [pid]);

  if (loading) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 80 }}><ListSkeleton rows={4} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}><EmptyState icon="home" title="Property not found" message="It may have been archived or removed." action="Go back" onAction={() => router.back()} /></View>;
  const { p } = data; const a = AVAIL_META[p.availability];

  const run = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); bump(); if (ok) toast(ok, 'success'); await reload(); } catch (e: any) { toast(e instanceof DomainError ? e.message : 'Something went wrong', 'error'); } };
  const avail = async (action: AvailabilityAction, label: string, needsConfirm?: string) => {
    if (needsConfirm && !(await confirm(needsConfirm, { title: label, okLabel: label }))) return;
    const r = await PropertyRepo.applyAvailability(pid, action, label);
    if (!r.ok) { toast(r.message, 'error'); return; }
    bump(); toast(r.warnings[0] ?? `${label} done`, r.warnings.length ? 'default' : 'success'); reload();
  };
  const addPhotos = async (src: 'gallery' | 'camera') => { try { for (const f of await pickPhotos(src)) await PropertyRepo.addPhoto(pid, f.file); bump(); reload(); } catch (e: any) { toast(String(e?.message || 'Could not add photos'), 'error'); } };
  const share = () => {
    const text = shareText({ code: p.code, title: p.title, category: p.category, society: p.society, phase: p.phase, block: p.block, plotNo: p.plotNo, area: p.area, city: p.city, areaLabel: areaLabel(p), transactionType: p.transactionType, bedrooms: p.bedrooms, bathrooms: p.bathrooms, description: p.description }, data.price, CREDIT);
    Share.share({ message: text, title: p.title }).catch(() => toast('Could not open sharing', 'error'));
  };
  const sqftLine = p.areaUnit === 'sqft' ? null : `${Math.round(p.areaSqft).toLocaleString('en-US')} sq ft`;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={p.code} subtitle={CATEGORY_LABEL[p.category]} back large={false} right={<><IconButton icon={data.fav ? 'heart' : 'heart-outline'} label="Favorite" tone="soft" onPress={async () => { await PropertyRepo.toggleFavorite(pid); reload(); }} /><IconButton icon="share-social-outline" label="Share" tone="soft" onPress={share} /><IconButton icon="ellipsis-horizontal" label="More" tone="soft" onPress={() => setMenu(true)} /></>} />
      <Screen contentStyle={{ paddingBottom: space.xxl }}>
        {data.photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.md }} contentContainerStyle={{ gap: space.sm }}>
            {data.photos.map((ph) => (
              <Pressy key={ph.id} onPress={() => setHistFor(-ph.id)} accessibilityLabel={`Photo${ph.isMain ? ' (main)' : ''}`}><Image source={{ uri: fileUri(ph.file) }} style={{ width: 280, height: 190, borderRadius: radius.lg }} resizeMode="cover" />
                {ph.isMain ? <View style={{ position: 'absolute', top: 8, left: 8 }}><Badge label="Main" tone="primary" /></View> : null}</Pressy>
            ))}
          </ScrollView>
        ) : (
          <Pressy onPress={() => addPhotos('gallery')} accessibilityLabel="Add photos" style={{ height: 130, borderRadius: radius.lg, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.md, gap: 4 }}><Ionicons name="images-outline" size={30} color={c.onPrimarySoft} /><T v="label" color={c.onPrimarySoft}>Add property photos</T></Pressy>
        )}
        <T v="title">{p.title}</T>
        <T v="body" color={c.textMuted} style={{ marginTop: 2 }}>{locationLine(p)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' }}>
          <Pressy onPress={() => setAvailMenu(true)} accessibilityLabel={`Availability: ${a.label}. Tap to change`}><Badge label={a.label} tone={a.tone} icon={a.icon} /></Pressy>
          <Badge label={p.transactionType === 'rent' ? 'For rent' : 'For sale'} tone="accent" /><Badge label={areaLabel(p)} tone="neutral" icon="resize-outline" />
        </View>
        <Card style={{ marginTop: space.lg }}>
          <T v="overline" color={c.textMuted}>{data.price ? 'Lowest active asking price' : 'Asking price'}</T>
          <T v="display" style={{ marginTop: 2 }}>{data.price ? rs(data.price) : 'Not listed'}</T>
          {data.price ? <T v="body" color={c.textMuted}>{moneyWords(data.price)}{p.transactionType === 'rent' ? ' / month' : ''}</T> : <T v="body" color={c.textMuted}>Create a listing to set a price.</T>}
        </Card>
        <View style={{ marginVertical: space.lg }}><Segmented<Tab> value={tab} onChange={setTab} options={[{ key: 'overview', label: 'Overview' }, { key: 'ownership', label: 'Owners' }, { key: 'listings', label: `Listings${data.listings.length ? ` ${data.listings.length}` : ''}` }, { key: 'deals', label: `Deals${data.deals.length ? ` ${data.deals.length}` : ''}` }]} /></View>

        {tab === 'overview' ? (<>
          <Card pad={0}>
            {([['Area', areaLabel(p) + (sqftLine ? ` (${sqftLine})` : '')], ['Front × Depth', p.front || p.depth ? `${p.front ?? '—'} × ${p.depth ?? '—'} ft` : ''], ['Covered area', p.coveredArea ? `${p.coveredArea} sq ft` : ''], ['Floors', p.floors != null ? String(p.floors) : ''], ['Bedrooms', p.bedrooms != null ? String(p.bedrooms) : ''], ['Bathrooms', p.bathrooms != null ? String(p.bathrooms) : ''], ['Construction', p.constructionStatus], ['Condition', p.condition], ['Facing', p.facing], ['Parking', p.parking], ['Utilities', p.utilities.join(', ')], ['Amenities', p.amenities.join(', ')], ['Province', p.province], ['Registered', p.registeredAt ? Fmt.date(p.registeredAt) : '']] as [string, string][]).filter(([, v]) => v).map(([k, v], i, arr) => <Row key={k} title={k} right={<T v="body" color={c.textMuted} align="right" style={{ maxWidth: 200 }}>{v}</T>} last={i === arr.length - 1} />)}
          </Card>
          {p.description ? <Card style={{ marginTop: space.md }}><T v="label" color={c.textMuted}>Description</T><T v="body" style={{ marginTop: 4 }}>{p.description}</T></Card> : null}
          {p.notes ? <Card style={{ marginTop: space.md }}><T v="label" color={c.textMuted}>Private notes</T><T v="body" style={{ marginTop: 4 }}>{p.notes}</T></Card> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}><Button variant="soft" icon="camera" label="Camera" onPress={() => addPhotos('camera')} /><Button variant="soft" icon="images" label="Add photos" onPress={() => addPhotos('gallery')} /></View>
          <T v="overline" color={c.textMuted} style={{ marginTop: space.xl, marginBottom: space.sm }}>Availability history</T>
          <Card pad={0}>{data.availHist.length ? [...data.availHist].reverse().slice(0, 8).map((h, i, arr) => <Row key={i} icon="swap-horizontal" title={`${AVAIL_META[h.from_state as keyof typeof AVAIL_META]?.label ?? h.from_state} → ${AVAIL_META[h.to_state as keyof typeof AVAIL_META]?.label ?? h.to_state}`} subtitle={`${Fmt.dateTime(h.at)}${h.reason ? ' · ' + h.reason : ''}`} last={i === arr.length - 1} />) : <Row icon="time-outline" title="No changes yet" subtitle="Availability changes are recorded here and cannot be edited." last />}</Card>
        </>) : null}

        {tab === 'ownership' ? (<>
          <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>Ownership and verification are entered by you. EstateFlow does not certify legal title.</T>
          {data.own.current.length ? <Card pad={0}>{data.own.current.map((o, i) => <Row key={o.id} icon="person" title={o.personName} subtitle={`${o.percentage}% · since ${Fmt.date(o.startDate, true)} · ${VERIF_LABEL[o.verification as Verification]}`} onPress={() => setVerif(o.id)} chevron last={i === data.own.current.length - 1} />)}</Card>
            : <EmptyState icon="people" title="No owner recorded" message="Add the owner(s) so you can create listings and deals correctly." />}
          <View style={{ marginTop: space.md }}><Button icon="swap-horizontal" label={data.own.current.length ? 'Change ownership' : 'Add owners'} onPress={() => setOwnEdit(true)} /></View>
          {data.own.history.length ? (<><T v="overline" color={c.textMuted} style={{ marginTop: space.xl, marginBottom: space.sm }}>Previous owners</T><Card pad={0}>{data.own.history.map((o, i) => <Row key={o.id} icon="time" title={o.personName} subtitle={`${o.percentage}% · ${Fmt.date(o.startDate, true)} → ${Fmt.date(o.endDate!, true)}`} last={i === data.own.history.length - 1} />)}</Card></>) : null}
        </>) : null}

        {tab === 'listings' ? (<>
          {data.listings.length ? data.listings.map((l) => (
            <Card key={l.id} onPress={() => setListMenu(l.id)} style={{ marginBottom: space.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="bodyStrong">{l.code}</T><Badge label={LISTING_META[l.status].label} tone={LISTING_META[l.status].tone} /></View>
              <T v="title" style={{ marginTop: 4 }}>{rs(l.askingPrice)}</T>
              <T v="caption" color={c.textMuted}>{moneyWords(l.askingPrice)}{l.minPrice != null ? ` · minimum ${rs(l.minPrice)} (private)` : ''}{l.expiryDate ? ` · expires ${Fmt.date(l.expiryDate, true)}` : ''}</T>
            </Card>
          )) : <EmptyState icon="pricetags" title="No listings" message="A property can have several listings (your own, or a dealer’s) at different prices and terms." />}
          <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>A listing’s status is separate from availability: an Active listing can stay up while the property is under negotiation.</T>
          <Button icon="add" label="New listing" onPress={() => router.push({ pathname: '/listing/edit', params: { propertyId: String(pid) } })} />
        </>) : null}

        {tab === 'deals' ? (<>
          {data.deals.length ? <Card pad={0}>{data.deals.map((d, i) => <Row key={d.id} icon="swap-horizontal" title={`${d.code} · ${d.buyerName || 'No buyer'}`} subtitle={d.agreedPrice ? rs(d.agreedPrice) : 'Price not agreed'} right={<Badge label={STAGE_LABEL[d.stage]} tone={STAGE_TONE[d.stage]} />} onPress={() => router.push({ pathname: '/deal/[id]', params: { id: String(d.id) } })} last={i === data.deals.length - 1} />)}</Card>
            : <EmptyState icon="swap-horizontal" title="No deals yet" message="Open a deal when a buyer is ready to negotiate." />}
          <View style={{ marginTop: space.md }}><Button icon="add" label="New deal" onPress={() => router.push({ pathname: '/deal/new', params: { propertyId: String(pid) } })} /></View>
        </>) : null}
      </Screen>

      <ActionMenu visible={menu} onClose={() => setMenu(false)} title={p.title} actions={[
        { label: 'Edit property', icon: 'create', onPress: () => router.push({ pathname: '/property/edit', params: { id: String(pid) } }) },
        { label: 'New listing', icon: 'pricetag', onPress: () => router.push({ pathname: '/listing/edit', params: { propertyId: String(pid) } }) },
        { label: 'New deal', icon: 'swap-horizontal', onPress: () => router.push({ pathname: '/deal/new', params: { propertyId: String(pid) } }) },
        { label: 'Archive property', icon: 'archive', danger: true, onPress: async () => { if (await confirm('Archive this property? It is hidden from lists but all history is kept.', { title: 'Archive', danger: true, okLabel: 'Archive' })) { await PropertyRepo.archiveProperty(pid); bump(); router.back(); } } },
      ]} />
      <ActionMenu visible={availMenu} onClose={() => setAvailMenu(false)} title="Availability" subtitle={`Now: ${a.label}. Buyer interest never changes this by itself.`} actions={[
        ...(p.availability === 'available' ? [{ label: 'Put on hold', icon: 'pause-circle' as const, onPress: () => avail({ type: 'hold' }, 'Put on hold') }] : []),
        ...(p.availability === 'on_hold' ? [{ label: 'Release hold', icon: 'play-circle' as const, onPress: () => avail({ type: 'release' }, 'Release hold') }] : []),
        ...(p.availability === 'sold' || p.availability === 'rented' ? [{ label: 'Reopen property', icon: 'refresh-circle' as const, danger: true, onPress: () => avail({ type: 'reopen', confirmed: true }, 'Reopen property', 'This property is marked as completed. Reopening keeps the original deal and payments on record but makes it available again.') }] : []),
        ...(p.availability === 'reserved' ? [{ label: 'Reserved by a deal — open the deal to release', icon: 'lock-closed' as const, onPress: () => setTab('deals') }] : []),
        ...(p.availability === 'under_negotiation' ? [{ label: 'See open deals', icon: 'swap-horizontal' as const, onPress: () => setTab('deals') }] : []),
      ]} />
      <ActionMenu visible={listMenu != null} onClose={() => setListMenu(null)} title="Listing" actions={listMenu == null ? [] : (() => {
        const l = data.listings.find((x) => x.id === listMenu)!; if (!l) return [];
        return [
          ...LISTING_STATUSES.filter((s) => canMoveListing(l.status, s)).map((s) => ({ label: `Mark ${LISTING_META[s].label.toLowerCase()}`, icon: 'swap-vertical' as const, onPress: () => run(() => PropertyRepo.changeListingStatus(l.id, s as ListingStatus, 'Changed manually'), `Listing ${LISTING_META[s].label.toLowerCase()}`) })),
          { label: 'Status history', icon: 'time' as const, onPress: () => setHistFor(l.id) },
        ];
      })()} />
      <OptionSheet visible={verif != null} onClose={() => setVerif(null)} title="Verification status (your own record)" options={VERIFICATION.map((v) => ({ key: v, label: VERIF_LABEL[v] }))} onPick={(v) => run(() => PropertyRepo.setOwnerVerification(verif!, v), 'Verification updated')} />
      <OwnerSheet visible={ownEdit} onClose={() => setOwnEdit(false)} propertyId={pid} current={data.own.current.map((o) => ({ personId: o.personId, pct: String(o.percentage) }))} onDone={() => { setOwnEdit(false); bump(); reload(); }} />
      <HistorySheet id={histFor} onClose={() => setHistFor(null)} photos={data.photos} onMain={(phId) => run(() => PropertyRepo.setMainPhoto(pid, phId), 'Main photo set')} onRemove={async (phId) => { if (await confirm('Remove this photo?', { title: 'Remove photo', danger: true, okLabel: 'Remove' })) run(async () => deleteFiles([await PropertyRepo.removePhoto(phId)])); }} />
    </View>
  );
}

function HistorySheet({ id, onClose, photos, onMain, onRemove }: { id: number | null; onClose: () => void; photos: { id: number; file: string; isMain: boolean }[]; onMain: (id: number) => void; onRemove: (id: number) => void }) {
  const { c } = useTheme();
  const { data } = useData(async () => (id != null && id > 0 ? PropertyRepo.listingHistory(id) : []), [id]);
  const photo = id != null && id < 0 ? photos.find((p) => p.id === -id) : null;
  return (
    <Sheet visible={id != null} onClose={onClose} title={photo ? 'Photo' : 'Listing status history'}>
      {photo ? (<>
        <Image source={{ uri: fileUri(photo.file) }} style={{ width: '100%', height: 260, borderRadius: radius.md }} resizeMode="contain" />
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>{!photo.isMain ? <Button variant="soft" icon="star" label="Make main" onPress={() => { onMain(photo.id); onClose(); }} /> : null}<Button variant="danger" icon="trash" label="Remove" onPress={() => { onClose(); onRemove(photo.id); }} /></View>
      </>) : (data ?? []).map((h, i) => <Row key={i} icon="time" title={`${h.from_status ?? 'new'} → ${h.to_status}`} subtitle={`${Fmt.dateTime(h.at)}${h.note ? ' · ' + h.note : ''}`} last={i === (data?.length ?? 0) - 1} />)}
    </Sheet>
  );
}

function OwnerSheet({ visible, onClose, propertyId, current, onDone }: { visible: boolean; onClose: () => void; propertyId: number; current: { personId: number; pct: string }[]; onDone: () => void }) {
  const { c } = useTheme(); const { toast } = useApp();
  const [rows, setRows] = useState<{ personId: number | null; pct: string }[]>([]); const [date, setDate] = useState(todayYmd());
  React.useEffect(() => { if (visible) { setRows(current.length ? current : [{ personId: null, pct: '100' }]); setDate(todayYmd()); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, patch: Partial<{ personId: number | null; pct: string }>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const equal = () => setRows((r) => r.map((x, i) => ({ ...x, pct: String(+(100 / r.length).toFixed(3)) })));
  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const save = async () => {
    try {
      if (rows.some((r) => r.personId == null)) throw new DomainError('owner', 'Choose a person for every owner row');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('date', 'Effective date must be YYYY-MM-DD');
      await PropertyRepo.setOwnership(propertyId, rows.map((r) => ({ personId: r.personId!, percentage: Number(r.pct) })), date);
      toast('Ownership saved', 'success'); onDone();
    } catch (e: any) { toast(e instanceof DomainError || e?.message ? e.message : 'Could not save ownership', 'error'); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Owners" tall footer={<Button block icon="checkmark" label="Save ownership" onPress={save} />}>
      <T v="caption" color={c.textMuted} style={{ marginBottom: space.md }}>Shares must add up to 100%. Changing owners end-dates the old record; it is never deleted.</T>
      {rows.map((r, i) => (
        <View key={i} style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: space.md }}>
          <CustomerPicker label={`Owner ${i + 1}`} value={r.personId} onChange={(id) => set(i, { personId: id })} optional={false} />
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-end' }}><Field style={{ flex: 1 }} label="Share %" value={r.pct} onChangeText={(v) => set(i, { pct: v })} keyboardType="decimal-pad" />{rows.length > 1 ? <Button variant="ghost" icon="trash" label="Remove" onPress={() => setRows((x) => x.filter((_, k) => k !== i))} /> : null}</View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}><Button variant="soft" icon="add" label="Add owner" onPress={() => setRows((r) => [...r, { personId: null, pct: '0' }])} /><Button variant="ghost" label="Split equally" onPress={equal} /></View>
      <T v="label" color={Math.abs(total - 100) < 0.001 ? c.success : c.danger}>Total: {+total.toFixed(3)}%</T>
      <Field label="Effective date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={{ marginTop: space.md }} />
    </Sheet>
  );
}
