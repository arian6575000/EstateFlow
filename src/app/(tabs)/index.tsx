import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '../../ctx/AppContext';
import { useTheme } from '../../ctx/ThemeContext';
import { useData } from '../../lib/hooks';
import { Repo } from '../../db/repo';
import { ReportRepo } from '../../db/reportRepo';
import { STAGE_LABEL } from '../../db/dealRepo';
import { Fmt } from '../../lib/format';
import { rs } from '../../lib/estate';
import { radius, space, TAB_SPACE } from '../../lib/theme';
import { AnimatedNumber, Badge, Card, Credit, EmptyState, FadeIn, Header, Hero, IconButton, IconName, Pressy, Row, Screen, SectionHeader, Skeleton, SwipeRow, T } from '../../ui/kit';
import { FollowUpCard } from '../../ui/parts';
import { AVAIL_META, STAGE_TONE } from '../../ui/estate';
import { PropertyPicker } from '../../ui/PropertyPicker';
import { RangeChips, RangeState, rangeOf } from '../../ui/RangeChips';
import { haptic } from '../../lib/haptics';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function Home() {
  const router = useRouter(); const { c } = useTheme(); const { settings, bump, toast } = useApp();
  const [range, setRange] = useState<RangeState>({ key: 'month' }); const [pick, setPick] = useState<null | 'listing' | 'deal'>(null); const [refreshing, setRefreshing] = useState(false);
  const r = rangeOf(range);
  const { data, loading, reload } = useData(async () => {
    const [k, followups, props, deals, pending, expiring, customers] = await Promise.all([ReportRepo.kpis(r), Repo.listFollowUps({ done: false }), ReportRepo.recentProperties(5), ReportRepo.recentDeals(5), ReportRepo.pendingPayments(4), ReportRepo.expiringListings(7, 4), Repo.customerMap()]);
    return { k, followups, props, deals, pending, expiring, customers };
  }, [r.from, r.to]);
  const refresh = async () => { setRefreshing(true); await reload(); setRefreshing(false); };
  const name = settings.ownerName.split(' ')[0]; const k = data?.k;
  const now = Date.now(); const overdue = data ? data.followups.filter((f) => f.dueAt < now).length : 0;

  const quick: { icon: IconName; label: string; go: () => void; color: string }[] = [
    { icon: 'business', label: 'Property', go: () => router.push('/property/edit'), color: c.primary },
    { icon: 'person-add', label: 'Contact', go: () => router.push('/customer/edit'), color: c.secondary },
    { icon: 'pricetag', label: 'Listing', go: () => setPick('listing'), color: c.accent },
    { icon: 'briefcase', label: 'Deal', go: () => setPick('deal'), color: c.success },
    { icon: 'wallet', label: 'Expense', go: () => router.push('/finance'), color: c.warning },
    { icon: 'alarm', label: 'Follow-up', go: () => router.push('/followup/edit'), color: c.danger },
  ];
  const nothing = !!k && k.totalProperties === 0 && !data!.deals.length;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={`${greeting()}${name ? ',' : ''}${name ? '\n' + name : ''}`} subtitle={settings.businessName} right={<IconButton icon="settings-outline" tone="soft" label="Settings" onPress={() => router.push('/settings')} />} />
      <Screen contentStyle={{ paddingBottom: TAB_SPACE + 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surface} />}>
        <RangeChips value={range} onChange={setRange} />
        {loading || !k ? <View style={{ gap: space.lg, marginTop: space.lg }}><Skeleton h={170} r={radius.xl} /><Skeleton h={96} r={radius.lg} /></View> : (<>
          <FadeIn>
            <Hero style={{ marginTop: space.lg }}>
              <T v="overline" color="rgba(255,255,255,0.78)">Net income</T>
              <AnimatedNumber value={k.netIncome} format={rs} v="display" color="#FFFFFF" />
              <T v="label" color="rgba(255,255,255,0.85)" style={{ marginTop: 2 }}>Commission {rs(k.commissionEarned)} · Expenses {rs(k.expenses)}</T>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
                <HeroStat label="Deals closed" value={String(k.completedDeals)} /><HeroStat label="Sales volume" value={Fmt.compact(k.salesVolume)} /><HeroStat label="Open deals" value={String(k.activeDeals)} />
              </View>
            </Hero>
          </FadeIn>

          <FadeIn index={1}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.lg, marginTop: space.xl }}>
              {quick.map((q) => (
                <Pressy key={q.label} onPress={q.go} haptics="light" accessibilityLabel={q.label} style={{ width: '30%', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: q.color + '1F', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={q.icon} size={26} color={q.color} /></View>
                  <T v="caption" color={c.textMuted}>{q.label}</T>
                </Pressy>
              ))}
            </View>
          </FadeIn>

          {nothing ? <EmptyState icon="business-outline" title="Start with your first property" message="Add a property, then create a listing and open deals as buyers show interest." action="Add property" onAction={() => router.push('/property/edit')} /> : (<>
            <FadeIn index={2}>
              <SectionHeader title="Inventory" action="Explore" onAction={() => router.push('/explore')} />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Tile label="Properties" value={k.totalProperties} onPress={() => router.push('/explore')} />
                <Tile label="Active listings" value={k.activeListings} onPress={() => router.push('/explore')} />
                <Tile label="Available" value={k.available} tone={c.success} onPress={() => router.push('/explore')} />
              </View>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
                <Tile label="In negotiation" value={k.underNegotiation} tone={c.warning} onPress={() => router.push('/deals')} />
                <Tile label="Reserved" value={k.reserved} tone={c.secondary} onPress={() => router.push('/deals')} />
                <Tile label="Sold / rented" value={k.sold + k.rented} onPress={() => router.push('/insights')} />
              </View>
            </FadeIn>

            {k.outstandingPayments > 0 || data!.pending.length ? (
              <FadeIn index={3}>
                <SectionHeader title="Pending payments" action="Finance" onAction={() => router.push('/finance')} />
                <Card pad={0}>
                  <Row icon="alert-circle" iconColor={c.warning} title="Total outstanding from buyers" right={<T v="bodyStrong">{rs(k.outstandingPayments)}</T>} />
                  {data!.pending.map((p, i) => <Row key={p.id} icon="briefcase" title={`${p.code} · ${p.title}`} subtitle={p.buyer || 'No buyer'} right={<T v="bodyStrong">{rs(p.outstanding)}</T>} onPress={() => router.push({ pathname: '/deal/[id]', params: { id: String(p.id) } })} last={i === data!.pending.length - 1} />)}
                </Card>
              </FadeIn>
            ) : null}

            {data!.expiring.length ? (
              <FadeIn index={4}>
                <SectionHeader title="Listings expiring soon" />
                <Card pad={0}>{data!.expiring.map((l, i) => <Row key={l.id} icon="timer" iconColor={c.warning} title={l.title} subtitle={`${l.code} · expires ${l.expiry_date}`} onPress={() => router.push({ pathname: '/property/[id]', params: { id: String(l.property_id) } })} last={i === data!.expiring.length - 1} />)}</Card>
              </FadeIn>
            ) : null}
          </>)}

          {data!.followups.length ? (
            <FadeIn index={5}>
              <SectionHeader title={overdue ? `Up next · ${overdue} overdue` : 'Up next'} action="All" onAction={() => router.push('/followups')} />
              <View style={{ gap: space.sm }}>
                {data!.followups.slice(0, 3).map((f) => (
                  <SwipeRow key={f.id} onRight={async () => { await Repo.completeFollowUp(f.id); bump(); toast('Follow-up done', 'success'); }} onLeft={async () => { await Repo.snoozeFollowUp(f.id, f.dueAt + 86400000); bump(); toast('Snoozed for a day', 'success'); }}>
                    <FollowUpCard f={f} customerName={f.customerId ? data!.customers[f.customerId]?.name : undefined} onPress={() => router.push({ pathname: '/followup/edit', params: { id: String(f.id) } })} onToggle={async () => { await Repo.completeFollowUp(f.id); haptic.success(); bump(); }} />
                  </SwipeRow>
                ))}
              </View>
            </FadeIn>
          ) : null}

          {data!.props.length ? (
            <FadeIn index={6}>
              <SectionHeader title="Recent properties" />
              <Card pad={0}>{data!.props.map((p, i) => <Row key={p.id} icon="home" title={p.title} subtitle={[p.code, p.society || p.city].filter(Boolean).join(' · ')} right={<Badge label={AVAIL_META[p.availability as keyof typeof AVAIL_META]?.label ?? p.availability} tone={AVAIL_META[p.availability as keyof typeof AVAIL_META]?.tone ?? 'neutral'} />} onPress={() => router.push({ pathname: '/property/[id]', params: { id: String(p.id) } })} last={i === data!.props.length - 1} />)}</Card>
            </FadeIn>
          ) : null}
          {data!.deals.length ? (
            <FadeIn index={7}>
              <SectionHeader title="Recent deals" action="All deals" onAction={() => router.push('/deals')} />
              <Card pad={0}>{data!.deals.map((d, i) => <Row key={d.id} icon="briefcase" title={d.title} subtitle={`${d.code} · ${Fmt.date(d.updated_at, true)}`} right={<Badge label={STAGE_LABEL[d.stage as keyof typeof STAGE_LABEL]} tone={STAGE_TONE[d.stage as keyof typeof STAGE_TONE]} />} onPress={() => router.push({ pathname: '/deal/[id]', params: { id: String(d.id) } })} last={i === data!.deals.length - 1} />)}</Card>
            </FadeIn>
          ) : null}

          <SectionHeader title="CRM tools" />
          <Card pad={0}>
            <Row icon="funnel" iconColor={c.secondary} title="Lead pipeline" subtitle="Inherited CRM leads board" onPress={() => router.push('/pipeline')} />
            <Row icon="alarm" iconColor={c.warning} title="Follow-ups" subtitle={overdue ? `${overdue} overdue` : 'Reminders and calls'} onPress={() => router.push('/followups')} />
            <Row icon="stats-chart" iconColor={c.accent} title="CRM analytics" onPress={() => router.push('/analytics')} />
            <Row icon="apps" iconColor={c.primary} title="More" subtitle="Groups, import/export, backup, settings" onPress={() => router.push('/more')} last />
          </Card>
        </>)}
        <Credit style={{ marginTop: space.xxl }} />
      </Screen>
      <PropertyPicker visible={pick !== null} onClose={() => setPick(null)} title={pick === 'deal' ? 'Which property is the deal for?' : 'Which property is the listing for?'}
        onPick={(id) => { const kind = pick; setPick(null); router.push({ pathname: kind === 'deal' ? '/deal/new' : '/listing/edit', params: { propertyId: String(id) } }); }} />
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (<View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 }}><T v="bodyStrong" color="#FFFFFF" numberOfLines={1}>{value}</T><T v="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>{label}</T></View>);
}
function Tile({ label, value, tone, onPress }: { label: string; value: number; tone?: string; onPress: () => void }) {
  return (<Card onPress={onPress} pad="md" style={{ flex: 1, gap: 4 }}><AnimatedNumber value={value} v="title" color={tone} /><T v="caption" numberOfLines={1} style={{ opacity: 0.75 }}>{label}</T></Card>);
}
