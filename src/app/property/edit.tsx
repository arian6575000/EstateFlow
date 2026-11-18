import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { PROPERTY_CATEGORIES, PropertyCategory, PropertyInput, PropertyRepo } from '../../db/propertyRepo';
import { DomainError } from '../../domain/errors';
import { AREA_UNITS, AreaUnit, MARLA_BASES, MARLA_SQFT, MarlaBasis, UNIT_LABEL } from '../../domain/units';
import { space } from '../../lib/theme';
import { Button, Card, Chip, Field, Header, Screen, Segmented, T } from '../../ui/kit';
import { OptionSheet } from '../../ui/Sheet';
import { CATEGORY_LABEL, HAS_FLOORS, HAS_ROOMS } from '../../ui/estate';

const UTILITIES = ['Electricity', 'Gas', 'Water', 'Sewerage', 'Internet'];
const AMENITIES = ['Boundary wall', 'Park nearby', 'Mosque nearby', 'School nearby', 'Security', 'Main road', 'Corner', 'Gated community'];
const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Azad Kashmir', 'Gilgit-Baltistan'];
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
const toggle = (a: string[], v: string) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

export default function PropertyEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = id ? Number(id) : null;
  const router = useRouter(); const { c } = useTheme(); const insets = useSafeAreaInsets();
  const { toast, bump, confirm } = useApp();
  const [f, setF] = useState({ title: '', province: '', city: '', area: '', society: '', phase: '', block: '', street: '', plotNo: '', address: '', areaValue: '', front: '', depth: '', coveredArea: '', floors: '', bedrooms: '', bathrooms: '', constructionStatus: '', condition: '', facing: '', parking: '', description: '', notes: '', latitude: '', longitude: '' });
  const [category, setCategory] = useState<PropertyCategory>('residential_plot');
  const [tx, setTx] = useState<'sale' | 'rent'>('sale');
  const [unit, setUnit] = useState<AreaUnit>('marla');
  const [basis, setBasis] = useState<MarlaBasis>('revenue');
  const [utilities, setUtilities] = useState<string[]>([]); const [amenities, setAmenities] = useState<string[]>([]);
  const [catSheet, setCatSheet] = useState(false); const [provSheet, setProvSheet] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setErr({}); };

  useEffect(() => {
    if (!editing) return;
    (async () => {
      const p = await PropertyRepo.getProperty(editing); if (!p) return;
      const s = (n: number | null) => (n == null ? '' : String(n));
      setF({ title: p.title, province: p.province, city: p.city, area: p.area, society: p.society, phase: p.phase, block: p.block, street: p.street, plotNo: p.plotNo, address: p.address, areaValue: String(p.areaValue), front: s(p.front), depth: s(p.depth), coveredArea: s(p.coveredArea), floors: s(p.floors), bedrooms: s(p.bedrooms), bathrooms: s(p.bathrooms), constructionStatus: p.constructionStatus, condition: p.condition, facing: p.facing, parking: p.parking, description: p.description, notes: p.notes, latitude: s(p.latitude), longitude: s(p.longitude) });
      setCategory(p.category); setTx(p.transactionType); setUnit(p.areaUnit); setBasis(p.marlaBasis); setUtilities(p.utilities); setAmenities(p.amenities);
    })();
  }, [editing]);

  const input = (): PropertyInput => ({
    title: f.title, category, transactionType: tx, province: f.province, city: f.city, area: f.area, society: f.society, phase: f.phase, block: f.block, street: f.street, plotNo: f.plotNo, address: f.address,
    latitude: num(f.latitude), longitude: num(f.longitude), areaValue: Number(f.areaValue.replace(/,/g, '')), areaUnit: unit, marlaBasis: basis,
    front: num(f.front), depth: num(f.depth), coveredArea: num(f.coveredArea), floors: num(f.floors), bedrooms: num(f.bedrooms), bathrooms: num(f.bathrooms),
    constructionStatus: f.constructionStatus, condition: f.condition, facing: f.facing, utilities, parking: f.parking, amenities, description: f.description, notes: f.notes,
  });

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Give the property a title';
    const av = Number(f.areaValue.replace(/,/g, ''));
    if (!f.areaValue.trim() || !Number.isFinite(av) || av <= 0) e.areaValue = 'Enter the area (a number above zero)';
    if (Object.keys(e).length) { setErr(e); return; }
    setBusy(true);
    try {
      const inp = input();
      const dups = await PropertyRepo.findPossibleDuplicates(inp, editing ?? undefined);
      if (dups.length && !(await confirm(`${dups.length} property record(s) already exist with the same society, phase, block and plot number (${dups.map((d) => d.code).join(', ')}). Other dealers may keep their own record of the same property, so you can still save. Save anyway?`, { title: 'Possible duplicate', okLabel: 'Save anyway' }))) return;
      let pid = editing;
      if (editing) await PropertyRepo.updateProperty(editing, inp); else pid = await PropertyRepo.createProperty(inp);
      bump(); toast(editing ? 'Property updated' : 'Property added', 'success');
      if (editing) router.back(); else router.replace({ pathname: '/property/[id]', params: { id: String(pid) } });
    } catch (x: any) {
      if (x instanceof DomainError) toast(x.message, 'error'); else toast('Could not save the property', 'error');
    } finally { setBusy(false); }
  };

  const Row2 = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', gap: space.md }}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={editing ? 'Edit property' : 'New property'} back large={false} modal />
      <Screen bottomInset={false} contentStyle={{ paddingBottom: space.xl }} stickyFooter={<View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}><Button block icon="checkmark" label={editing ? 'Save changes' : 'Add property'} onPress={save} loading={busy} /></View>}>
        <T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>Identity</T>
        <Field label="Title *" value={f.title} onChangeText={set('title')} placeholder="e.g. 10 Marla Corner Plot, DHA Phase 6" error={err.title} autoCapitalize="words" />
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Category *</T>
        <View style={{ marginBottom: space.lg }}><Chip icon="grid" label={CATEGORY_LABEL[category]} selected onPress={() => setCatSheet(true)} /></View>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Transaction</T>
        <View style={{ marginBottom: space.lg }}><Segmented<'sale' | 'rent'> value={tx} onChange={setTx} options={[{ key: 'sale', label: 'For sale' }, { key: 'rent', label: 'For rent' }]} /></View>

        <T v="overline" color={c.textMuted} style={{ marginTop: space.md, marginBottom: space.sm }}>Location</T>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Province</T>
        <View style={{ marginBottom: space.lg }}><Chip icon="location" label={f.province || 'Choose province'} selected={!!f.province} onPress={() => setProvSheet(true)} /></View>
        <Row2><Field style={{ flex: 1 }} label="City" value={f.city} onChangeText={set('city')} placeholder="Lahore" autoCapitalize="words" /><Field style={{ flex: 1 }} label="Area / town" value={f.area} onChangeText={set('area')} placeholder="Cantt" autoCapitalize="words" /></Row2>
        <Field label="Society / housing scheme" value={f.society} onChangeText={set('society')} placeholder="DHA, Bahria Town, Gulberg…" autoCapitalize="words" />
        <Row2><Field style={{ flex: 1 }} label="Phase" value={f.phase} onChangeText={set('phase')} placeholder="6" /><Field style={{ flex: 1 }} label="Block" value={f.block} onChangeText={set('block')} placeholder="K" autoCapitalize="characters" /><Field style={{ flex: 1 }} label="Plot no." value={f.plotNo} onChangeText={set('plotNo')} placeholder="123" /></Row2>
        <Field label="Street" value={f.street} onChangeText={set('street')} placeholder="Street 4" />
        <Field label="Complete address" value={f.address} onChangeText={set('address')} placeholder="Full postal address" multiline />
        <Row2><Field style={{ flex: 1 }} label="Latitude" value={f.latitude} onChangeText={set('latitude')} placeholder="31.4504" keyboardType="numeric" /><Field style={{ flex: 1 }} label="Longitude" value={f.longitude} onChangeText={set('longitude')} placeholder="74.3587" keyboardType="numeric" /></Row2>

        <T v="overline" color={c.textMuted} style={{ marginTop: space.md, marginBottom: space.sm }}>Size</T>
        <Field label="Area *" value={f.areaValue} onChangeText={set('areaValue')} placeholder="10" keyboardType="decimal-pad" error={err.areaValue} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>{AREA_UNITS.map((u) => <Chip key={u} label={UNIT_LABEL[u]} selected={unit === u} onPress={() => setUnit(u)} />)}</View>
        {unit === 'marla' || unit === 'kanal' ? (
          <Card style={{ marginBottom: space.lg }}>
            <T v="label" style={{ marginBottom: 4 }}>Marla size</T>
            <T v="caption" color={c.textMuted} style={{ marginBottom: space.sm }}>A marla is not the same everywhere. Pick the basis this property uses so square-foot conversion is correct.</T>
            <Segmented<MarlaBasis> value={basis} onChange={setBasis} options={MARLA_BASES.map((b) => ({ key: b, label: `${b === 'revenue' ? 'Revenue' : 'Society'} · ${MARLA_SQFT[b]} sq ft` }))} />
          </Card>
        ) : null}
        <Row2><Field style={{ flex: 1 }} label="Front (ft)" value={f.front} onChangeText={set('front')} keyboardType="decimal-pad" /><Field style={{ flex: 1 }} label="Depth (ft)" value={f.depth} onChangeText={set('depth')} keyboardType="decimal-pad" />{HAS_FLOORS.includes(category) ? <Field style={{ flex: 1 }} label="Covered (sq ft)" value={f.coveredArea} onChangeText={set('coveredArea')} keyboardType="decimal-pad" /> : null}</Row2>
        {HAS_FLOORS.includes(category) ? <Row2><Field style={{ flex: 1 }} label="Floors" value={f.floors} onChangeText={set('floors')} keyboardType="number-pad" />{HAS_ROOMS.includes(category) ? <><Field style={{ flex: 1 }} label="Bedrooms" value={f.bedrooms} onChangeText={set('bedrooms')} keyboardType="number-pad" /><Field style={{ flex: 1 }} label="Bathrooms" value={f.bathrooms} onChangeText={set('bathrooms')} keyboardType="number-pad" /></> : null}</Row2> : null}

        <T v="overline" color={c.textMuted} style={{ marginTop: space.md, marginBottom: space.sm }}>Details</T>
        <Row2><Field style={{ flex: 1 }} label="Construction" value={f.constructionStatus} onChangeText={set('constructionStatus')} placeholder="Grey structure" /><Field style={{ flex: 1 }} label="Condition" value={f.condition} onChangeText={set('condition')} placeholder="Excellent" /></Row2>
        <Row2><Field style={{ flex: 1 }} label="Facing" value={f.facing} onChangeText={set('facing')} placeholder="West open" /><Field style={{ flex: 1 }} label="Parking" value={f.parking} onChangeText={set('parking')} placeholder="2 cars" /></Row2>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Utilities</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>{UTILITIES.map((u) => <Chip key={u} label={u} selected={utilities.includes(u)} onPress={() => setUtilities(toggle(utilities, u))} />)}</View>
        <T v="label" color={c.textMuted} style={{ marginBottom: 8 }}>Amenities</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>{AMENITIES.map((u) => <Chip key={u} label={u} selected={amenities.includes(u)} onPress={() => setAmenities(toggle(amenities, u))} />)}</View>
        <Field label="Description" value={f.description} onChangeText={set('description')} placeholder="Shown when you share the property" multiline />
        <Field label="Private notes" value={f.notes} onChangeText={set('notes')} placeholder="Only you see this" multiline />
      </Screen>
      <OptionSheet visible={catSheet} onClose={() => setCatSheet(false)} title="Property category" value={category} options={PROPERTY_CATEGORIES.map((k) => ({ key: k, label: CATEGORY_LABEL[k] }))} onPick={setCategory} />
      <OptionSheet visible={provSheet} onClose={() => setProvSheet(false)} title="Province" value={f.province} options={PROVINCES.map((k) => ({ key: k, label: k }))} onPick={(k) => setF((p) => ({ ...p, province: k }))} />
    </View>
  );
}
