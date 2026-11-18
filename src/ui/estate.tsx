// Shared real-estate UI: labels, status tones, property card, money field.
import React, { memo } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../ctx/ThemeContext';
import { Property, PropertyCategory } from '../db/propertyRepo';
import { Availability, ListingStatus } from '../domain/availability';
import { UNIT_LABEL, formatArea } from '../domain/units';
import { DealStage, STAGE_LABEL } from '../db/dealRepo';
import { fileUri } from '../lib/files';
import { moneyWords, parseMoney, rs } from '../lib/estate';
import { radius, space } from '../lib/theme';
import { Badge, Card, Field, IconName, Pressy, T, Tone } from './kit';

export const CATEGORY_LABEL: Record<PropertyCategory, string> = {
  residential_plot: 'Residential Plot', commercial_plot: 'Commercial Plot', house: 'House', apartment: 'Apartment', agricultural_land: 'Agricultural Land',
  shop: 'Shop', office: 'Office', commercial_building: 'Commercial Building', property_file: 'Property File', other: 'Other',
};
export const CATEGORY_ICON: Record<PropertyCategory, IconName> = {
  residential_plot: 'map-outline', commercial_plot: 'map-outline', house: 'home-outline', apartment: 'business-outline', agricultural_land: 'leaf-outline',
  shop: 'storefront-outline', office: 'briefcase-outline', commercial_building: 'business', property_file: 'document-text-outline', other: 'cube-outline',
};
export const HAS_ROOMS: PropertyCategory[] = ['house', 'apartment'];
export const HAS_FLOORS: PropertyCategory[] = ['house', 'apartment', 'commercial_building', 'shop', 'office'];

export const AVAIL_META: Record<Availability, { label: string; tone: Tone; icon: IconName }> = {
  available: { label: 'Available', tone: 'success', icon: 'checkmark-circle' }, under_negotiation: { label: 'Under negotiation', tone: 'warning', icon: 'chatbubbles' },
  reserved: { label: 'Reserved', tone: 'primary', icon: 'lock-closed' }, sold: { label: 'Sold', tone: 'neutral', icon: 'pricetag' },
  rented: { label: 'Rented', tone: 'neutral', icon: 'key' }, on_hold: { label: 'On hold', tone: 'secondary', icon: 'pause-circle' },
};
export const LISTING_META: Record<ListingStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, active: { label: 'Active', tone: 'success' }, paused: { label: 'Paused', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' }, closed: { label: 'Closed', tone: 'primary' },
};
export const STAGE_TONE: Record<DealStage, Tone> = {
  initial_interest: 'neutral', negotiation: 'warning', offer_submitted: 'warning', offer_accepted: 'primary', token_received: 'primary', bayana_agreement: 'accent',
  payment_in_progress: 'accent', completed: 'success', cancelled: 'danger',
};
export { STAGE_LABEL };

export const areaLabel = (p: Pick<Property, 'areaValue' | 'areaUnit'>) => formatArea(p.areaValue, p.areaUnit);
export const locationLine = (p: Pick<Property, 'plotNo' | 'block' | 'phase' | 'society' | 'area' | 'city'>) =>
  [p.plotNo && `Plot ${p.plotNo}`, p.block && `Block ${p.block}`, p.phase && `Ph ${p.phase}`, p.society, p.area, p.city].filter(Boolean).join(' · ') || 'Location not set';
export { UNIT_LABEL };

/** Marketplace-style property card. `photo` is the main-photo file name (one small image per card, never a full gallery). */
export const PropertyCard = memo(function PropertyCard({ p, photo, price, fav, onPress, onLongPress, onFav, grid }: {
  p: Property; photo?: string; price?: number | null; fav?: boolean; onPress: () => void; onLongPress?: () => void; onFav?: () => void; grid?: boolean;
}) {
  const { c } = useTheme();
  const a = AVAIL_META[p.availability];
  const img = photo ? <Image source={{ uri: fileUri(photo) }} style={{ width: '100%', height: grid ? 120 : 150 }} resizeMode="cover" accessibilityLabel={`${p.title} photo`} />
    : <View style={{ height: grid ? 120 : 150, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft }}><Ionicons name={CATEGORY_ICON[p.category]} size={40} color={c.onPrimarySoft} /></View>;
  return (
    <Card pad={0} onPress={onPress} onLongPress={onLongPress} style={{ overflow: 'hidden', flex: grid ? 1 : undefined }}>
      <View>
        {img}
        <View style={{ position: 'absolute', top: space.sm, left: space.sm }}><Badge label={a.label} tone={a.tone} icon={a.icon} /></View>
        {onFav ? <Pressy onPress={onFav} hitSlop={10} accessibilityLabel={fav ? 'Remove from favorites' : 'Add to favorites'} style={{ position: 'absolute', top: space.sm, right: space.sm, width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={fav ? 'heart' : 'heart-outline'} size={20} color={fav ? c.danger : c.textMuted} /></Pressy> : null}
      </View>
      <View style={{ padding: space.md, gap: 2 }}>
        <T v="heading" numberOfLines={1}>{price ? rs(price) : 'Price on request'}</T>
        {price ? <T v="caption" color={c.textMuted}>{moneyWords(price)}{p.transactionType === 'rent' ? ' / month' : ''}</T> : null}
        <T v="bodyStrong" numberOfLines={1} style={{ marginTop: 4 }}>{p.title}</T>
        <T v="caption" color={c.textMuted} numberOfLines={1}>{locationLine(p)}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 6 }}>
          <Badge label={CATEGORY_LABEL[p.category]} tone="primary" />
          <Badge label={areaLabel(p)} tone="neutral" icon="resize-outline" />
          <Badge label={p.transactionType === 'rent' ? 'For rent' : 'For sale'} tone="accent" />
        </View>
      </View>
    </Card>
  );
});

/** Rupee amount field: accepts "1.5 crore", "75 lakh", "2500000"; shows the parsed value under the box. Value is the raw text. */
export function MoneyField({ label, value, onChangeText, error, placeholder = 'e.g. 1.5 crore or 15000000', optional }: { label: string; value: string; onChangeText: (t: string) => void; error?: string; placeholder?: string; optional?: boolean }) {
  const { c } = useTheme();
  const n = parseMoney(value);
  return (
    <View>
      <Field label={label} value={value} onChangeText={onChangeText} placeholder={placeholder} icon="cash-outline" keyboardType="default" autoCapitalize="none" error={error ?? (value.trim() && n === null ? 'Enter an amount like 75 lakh or 1.5 crore' : undefined)} />
      {n !== null && n > 0 ? <T v="caption" color={c.textMuted} style={{ marginTop: -space.sm, marginBottom: space.md }}>{rs(n)} · {moneyWords(n)}{optional ? '' : ''}</T> : null}
    </View>
  );
}
