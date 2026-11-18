import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData, useDebounced } from '../../lib/hooks';
import { Property, PropertyCategory, PropertyFilter, PropertyRepo, PROPERTY_CATEGORIES } from '../../db/propertyRepo';
import { AVAILABILITY, Availability } from '../../domain/availability';
import { parseMoney } from '../../lib/estate';
import { space, TAB_SPACE } from '../../lib/theme';
import { Button, Chip, EmptyState, Fab, Field, Header, IconButton, ListSkeleton, SearchBar, Segmented, T } from '../../ui/kit';
import { ActionMenu, Sheet } from '../../ui/Sheet';
import { AVAIL_META, CATEGORY_LABEL, MoneyField, PropertyCard } from '../../ui/estate';

type Sort = 'newest' | 'oldest' | 'area_desc' | 'price_asc' | 'price_desc';
const SORTS: { key: Sort; label: string }[] = [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'price_asc', label: 'Lowest price' }, { key: 'price_desc', label: 'Highest price' }, { key: 'area_desc', label: 'Largest area' }];
const PAGE = 30;

interface Filters { tx?: 'sale' | 'rent'; category?: PropertyCategory; availability?: Availability; city?: string; society?: string; phase?: string; block?: string; minPrice: string; maxPrice: string; minSqft: string; maxSqft: string; onlyFav: boolean }
const EMPTY: Filters = { minPrice: '', maxPrice: '', minSqft: '', maxSqft: '', onlyFav: false };

export default function Explore() {
  const router = useRouter(); const { c } = useTheme(); const { toast, confirm, bump } = useApp();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [f, setF] = useState<Filters>(EMPTY); const [sort, setSort] = useState<Sort>('newest'); const [grid, setGrid] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false); const [sortMenu, setSortMenu] = useState(false); const [saveSheet, setSaveSheet] = useState(false); const [saveName, setSaveName] = useState('');
  const [items, setItems] = useState<Property[]>([]); const [photos, setPhotos] = useState<Record<number, string>>({}); const [prices, setPrices] = useState<Record<number, number>>({}); const [favs, setFavs] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(true); const [more, setMore] = useState(false); const [refreshing, setRefreshing] = useState(false); const done = useRef(false);

  const filter = useMemo((): PropertyFilter => ({ q: dq, transactionType: f.tx, category: f.category, availability: f.availability, city: f.city, society: f.society, phase: f.phase, block: f.block,
    minPrice: f.minPrice.trim() ? parseMoney(f.minPrice) ?? undefined : undefined, maxPrice: f.maxPrice.trim() ? parseMoney(f.maxPrice) ?? undefined : undefined,
    minSqft: f.minSqft.trim() ? Number(f.minSqft) || undefined : undefined, maxSqft: f.maxSqft.trim() ? Number(f.maxSqft) || undefined : undefined,
    sort: sort === 'price_asc' || sort === 'price_desc' ? 'newest' : sort }), [dq, f, sort]);

  const { data: meta, reload: reloadMeta } = useData(async () => ({ total: (await PropertyRepo.listProperties({ limit: 200 })).length, cities: await PropertyRepo.distinctValues('city'), societies: await PropertyRepo.distinctValues('society'), phases: await PropertyRepo.distinctValues('phase'), blocks: await PropertyRepo.distinctValues('block'), saved: await PropertyRepo.savedSearches(), recent: await PropertyRepo.recentlyViewed(6) }), []);

  const load = useCallback(async (reset: boolean) => {
    if (reset) { setBusy(true); done.current = false; }
    try {
      const offset = reset ? 0 : items.length;
      let rows = await PropertyRepo.listProperties({ ...filter, limit: PAGE, offset });
      const favList = new Set(await PropertyRepo.favorites()); setFavs(favList);
      if (f.onlyFav) rows = rows.filter((r) => favList.has(r.id));
      if (rows.length < PAGE && !f.onlyFav) done.current = true;
      const next = reset ? rows : [...items, ...rows];
      const ids = rows.map((r) => r.id);
      const [ph, pr] = await Promise.all([PropertyRepo.mainPhotos(ids), PropertyRepo.askingPrices(ids)]);
      setPhotos((p) => ({ ...(reset ? {} : p), ...ph })); setPrices((p) => ({ ...(reset ? {} : p), ...pr }));
      setItems(sort === 'price_asc' || sort === 'price_desc' ? [...next].sort((a, b) => ((prices[a.id] ?? pr[a.id] ?? 0) - (prices[b.id] ?? pr[b.id] ?? 0)) * (sort === 'price_asc' ? 1 : -1)) : next);
    } catch { toast('Could not load properties', 'error'); } finally { setBusy(false); setMore(false); }
  }, [filter, items, f.onlyFav, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const { version } = useApp();
  useEffect(() => { load(true); }, [filter, f.onlyFav, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = [f.tx, f.category, f.availability, f.city, f.society, f.phase, f.block, f.minPrice, f.maxPrice, f.minSqft, f.maxSqft].filter(Boolean).length + (f.onlyFav ? 1 : 0);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const fav = async (id: number) => { await PropertyRepo.toggleFavorite(id); setFavs(new Set(await PropertyRepo.favorites())); };
  const open = (id: number) => router.push({ pathname: '/property/[id]', params: { id: String(id) } });
  const saveSearch = async () => { try { await PropertyRepo.saveSearch(saveName, { q: dq, ...f, sort }); setSaveSheet(false); setSaveName(''); reloadMeta(); toast('Search saved', 'success'); } catch (e: any) { toast(e.message, 'error'); } };

  const ChipRow = ({ label, values, cur, onPick }: { label: string; values: string[]; cur?: string; onPick: (v: string | undefined) => void }) => values.length ? (
    <View style={{ marginBottom: space.lg }}><T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>{label}</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}><Chip label="Any" selected={!cur} onPress={() => onPick(undefined)} />{values.slice(0, 30).map((v) => <Chip key={v} label={v} selected={cur === v} onPress={() => onPick(cur === v ? undefined : v)} />)}</View></View>) : null;

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search title, society, plot no, code…" onFilter={() => setFilterSheet(true)} filterActive={active > 0} />
      <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyExtractor={(i) => i.k} data={[
        { k: 'all', label: 'All', on: !f.tx, fn: () => set('tx', undefined) }, { k: 'sale', label: 'For sale', on: f.tx === 'sale', fn: () => set('tx', 'sale') }, { k: 'rent', label: 'For rent', on: f.tx === 'rent', fn: () => set('tx', 'rent') },
        { k: 'av', label: 'Available', on: f.availability === 'available', fn: () => set('availability', f.availability === 'available' ? undefined : 'available') }, { k: 'fav', label: 'Favorites', on: f.onlyFav, fn: () => set('onlyFav', !f.onlyFav) },
      ]} renderItem={({ item }) => <Chip label={item.label} selected={item.on} onPress={item.fn} />} />
      {meta?.saved.length ? <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyExtractor={(i) => String(i.id)} data={meta.saved} renderItem={({ item }) => <Chip icon="bookmark" label={item.name} onPress={() => { const { q: sq, sort: ss, ...rest } = item.filters; setQ(sq ?? ''); setSort(ss ?? 'newest'); setF({ ...EMPTY, ...rest }); }} />} /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="caption" color={c.textMuted}>{busy ? 'Loading…' : `${items.length}${done.current ? '' : '+'} propert${items.length === 1 ? 'y' : 'ies'}`}</T><View style={{ flexDirection: 'row', gap: space.xs }}><IconButton icon="bookmark-outline" label="Save this search" onPress={() => setSaveSheet(true)} /><IconButton icon="swap-vertical" label="Sort" onPress={() => setSortMenu(true)} /><IconButton icon={grid ? 'list' : 'grid-outline'} label={grid ? 'List view' : 'Grid view'} onPress={() => setGrid(!grid)} /></View></View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Explore" subtitle="Your property inventory" right={<IconButton icon="add-circle-outline" tone="soft" label="Add property" onPress={() => router.push('/property/edit')} />} />
      <FlatList key={grid ? 'g' : 'l'} numColumns={grid ? 2 : 1} columnWrapperStyle={grid ? { gap: space.md } : undefined}
        data={busy ? [] : items} keyExtractor={(i) => String(i.id)} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_SPACE + 80 }} ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListHeaderComponent={header} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} removeClippedSubviews keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.6} onEndReached={() => { if (!busy && !more && !done.current && !f.onlyFav) { setMore(true); load(false); } }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surface} />}
        ListEmptyComponent={busy ? <ListSkeleton /> : (meta?.total ?? 0) === 0 && !active && !dq ? <EmptyState icon="home" title="No properties yet" message="Add plots, houses, shops and more. Each gets its own ID, owners, listings and history." action="Add first property" onAction={() => router.push('/property/edit')} />
          : <EmptyState icon="search" title="No matches" message="Try different words or clear the filters." action="Clear filters" onAction={() => { setQ(''); setF(EMPTY); }} />}
        renderItem={({ item }) => <PropertyCard p={item} grid={grid} photo={photos[item.id]} price={prices[item.id]} fav={favs.has(item.id)} onFav={() => fav(item.id)} onPress={() => open(item.id)} />} />
      <Fab label="Add property" icon="add" bottom={TAB_SPACE - 18} onPress={() => router.push('/property/edit')} />

      <Sheet visible={filterSheet} onClose={() => setFilterSheet(false)} title="Filters" tall footer={<View style={{ flexDirection: 'row', gap: space.md }}><Button variant="ghost" label="Reset" onPress={() => setF(EMPTY)} /><Button block label="Show results" onPress={() => setFilterSheet(false)} /></View>}>
        <View style={{ marginBottom: space.lg }}><T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>Category</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}><Chip label="Any" selected={!f.category} onPress={() => set('category', undefined)} />{PROPERTY_CATEGORIES.map((k) => <Chip key={k} label={CATEGORY_LABEL[k]} selected={f.category === k} onPress={() => set('category', f.category === k ? undefined : k)} />)}</View></View>
        <View style={{ marginBottom: space.lg }}><T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>Availability</T><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}><Chip label="Any" selected={!f.availability} onPress={() => set('availability', undefined)} />{AVAILABILITY.map((k) => <Chip key={k} label={AVAIL_META[k].label} selected={f.availability === k} onPress={() => set('availability', f.availability === k ? undefined : k)} />)}</View></View>
        <ChipRow label="City" values={meta?.cities ?? []} cur={f.city} onPick={(v) => set('city', v)} /><ChipRow label="Society" values={meta?.societies ?? []} cur={f.society} onPick={(v) => set('society', v)} />
        <ChipRow label="Phase" values={meta?.phases ?? []} cur={f.phase} onPick={(v) => set('phase', v)} /><ChipRow label="Block" values={meta?.blocks ?? []} cur={f.block} onPick={(v) => set('block', v)} />
        <T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>Price range (active listings)</T>
        <View style={{ flexDirection: 'row', gap: space.md }}><View style={{ flex: 1 }}><MoneyField label="Min" value={f.minPrice} onChangeText={(v) => set('minPrice', v)} placeholder="50 lakh" /></View><View style={{ flex: 1 }}><MoneyField label="Max" value={f.maxPrice} onChangeText={(v) => set('maxPrice', v)} placeholder="2 crore" /></View></View>
        <T v="overline" color={c.textMuted} style={{ marginBottom: space.sm }}>Area range (sq ft)</T>
        <View style={{ flexDirection: 'row', gap: space.md }}><Field style={{ flex: 1 }} label="Min" value={f.minSqft} onChangeText={(v) => set('minSqft', v)} keyboardType="decimal-pad" /><Field style={{ flex: 1 }} label="Max" value={f.maxSqft} onChangeText={(v) => set('maxSqft', v)} keyboardType="decimal-pad" /></View>
      </Sheet>
      <ActionMenu visible={sortMenu} onClose={() => setSortMenu(false)} title="Sort by" actions={SORTS.map((s) => ({ label: s.label + (sort === s.key ? '  ✓' : ''), icon: 'swap-vertical' as const, onPress: () => setSort(s.key) }))} />
      <Sheet visible={saveSheet} onClose={() => setSaveSheet(false)} title="Save this search" footer={<Button block icon="bookmark" label="Save" onPress={saveSearch} />}>
        <Field label="Name" value={saveName} onChangeText={setSaveName} placeholder="e.g. DHA 10 marla plots under 2 crore" />
        {meta?.saved.length ? <><T v="overline" color={c.textMuted} style={{ marginVertical: space.sm }}>Saved searches</T>{meta.saved.map((s) => <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><T v="body">{s.name}</T><Button size="sm" variant="ghost" icon="trash" label="Delete" onPress={async () => { await PropertyRepo.deleteSavedSearch(s.id); reloadMeta(); }} /></View>)}</> : null}
      </Sheet>
    </View>
  );
}
