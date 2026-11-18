import React, { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../ctx/ThemeContext';
import { useData, useDebounced } from '../../lib/hooks';
import { DEAL_STAGES, DealRepo, DealStage } from '../../db/dealRepo';
import { rs } from '../../lib/estate';
import { Fmt } from '../../lib/format';
import { space, TAB_SPACE } from '../../lib/theme';
import { Badge, Card, Chip, EmptyState, Fab, Header, IconButton, ListSkeleton, SearchBar, T } from '../../ui/kit';
import { PropertyPicker } from '../../ui/PropertyPicker';
import { STAGE_LABEL, STAGE_TONE } from '../../ui/estate';

type F = 'open' | 'all' | DealStage;
export default function Deals() {
  const router = useRouter(); const { c } = useTheme();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [f, setF] = useState<F>('open'); const [pick, setPick] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const { data, loading, reload } = useData(async () => {
    const [list, bals] = await Promise.all([DealRepo.listDeals({ stage: f === 'all' ? undefined : f, q: dq, limit: 200 }), Promise.resolve(null)]);
    const rows = await Promise.all(list.map(async (d) => ({ d, outstanding: d.agreedPrice && d.stage !== 'cancelled' ? (await DealRepo.balance(d.id)).outstanding : 0 })));
    return { rows, bals };
  }, [f, dq]);
  const newDeal = () => setPick(true);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Deals" subtitle="Negotiations, payments and commission" right={<IconButton icon="add-circle-outline" tone="soft" label="New deal" onPress={newDeal} />} />
      <FlatList data={loading ? [] : data?.rows ?? []} keyExtractor={(r) => String(r.d.id)} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_SPACE + 80 }} ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surface} />}
        ListHeaderComponent={<View style={{ gap: space.md, paddingBottom: space.md }}><SearchBar value={q} onChangeText={setQ} placeholder="Search deal, property, buyer…" />
          <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} keyExtractor={(i) => i.k} data={[{ k: 'open', l: 'Open' }, { k: 'all', l: 'All' }, ...DEAL_STAGES.map((s) => ({ k: s, l: STAGE_LABEL[s] }))]} renderItem={({ item }) => <Chip label={item.l} selected={f === item.k} onPress={() => setF(item.k as F)} />} /></View>}
        ListEmptyComponent={loading ? <ListSkeleton /> : <EmptyState icon="swap-horizontal" title={f === 'open' && !dq ? 'No open deals' : 'No deals found'} message="Open a deal from a property when a buyer is ready to negotiate. Each deal tracks stages, payments and commission." action="Start a deal" onAction={newDeal} />}
        renderItem={({ item: { d, outstanding } }) => (
          <Card onPress={() => router.push({ pathname: '/deal/[id]', params: { id: String(d.id) } })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="bodyStrong">{d.code}</T><Badge label={STAGE_LABEL[d.stage]} tone={STAGE_TONE[d.stage]} /></View>
            <T v="body" numberOfLines={1} style={{ marginTop: 4 }}>{d.propertyTitle}</T>
            <T v="caption" color={c.textMuted} numberOfLines={1}>{d.buyerName || 'No buyer'}{d.sellerName ? ` ⇄ ${d.sellerName}` : ''} · updated {Fmt.date(d.updatedAt, true)}</T>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}><T v="heading">{d.agreedPrice ? rs(d.agreedPrice) : 'Price not agreed'}</T>{outstanding > 0 ? <T v="caption" color={c.warning}>Due {rs(outstanding)}</T> : d.agreedPrice && d.stage !== 'cancelled' ? <T v="caption" color={c.success}>Paid in full</T> : null}</View>
          </Card>)} />
      <Fab label="New deal" icon="add" bottom={TAB_SPACE - 18} onPress={newDeal} />
      <PropertyPicker visible={pick} onClose={() => setPick(false)} title="Which property is the deal for?" onPick={(id) => router.push({ pathname: '/deal/new', params: { propertyId: String(id) } })} />
    </View>
  );
}
