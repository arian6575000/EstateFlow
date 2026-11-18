import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useTheme } from '../ctx/ThemeContext';
import { PropertyRepo } from '../db/propertyRepo';
import { useData, useDebounced } from '../lib/hooks';
import { space } from '../lib/theme';
import { Badge, Pressy, SearchBar, T } from './kit';
import { Sheet } from './Sheet';
import { AVAIL_META, areaLabel, locationLine } from './estate';

/** Searchable property chooser in a sheet. Sold/rented properties are shown but marked. */
export function PropertyPicker({ visible, onClose, onPick, title = 'Choose property' }: { visible: boolean; onClose: () => void; onPick: (id: number) => void; title?: string }) {
  const { c } = useTheme(); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data } = useData(async () => PropertyRepo.listProperties({ q: dq, limit: 40 }), [dq]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} tall>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search title, society, plot, code" />
      <FlatList scrollEnabled={false} data={data ?? []} keyExtractor={(i) => String(i.id)} style={{ marginTop: space.md }}
        ListEmptyComponent={<T v="body" color={c.textMuted} align="center" style={{ paddingVertical: space.xl }}>No properties found. Add one from Explore.</T>}
        renderItem={({ item }) => (
          <Pressy onPress={() => { onPick(item.id); onClose(); }} scale={0.99} accessibilityLabel={item.title} style={{ minHeight: 64, justifyContent: 'center', paddingVertical: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}><T v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{item.title}</T><Badge label={AVAIL_META[item.availability].label} tone={AVAIL_META[item.availability].tone} /></View>
            <T v="caption" color={c.textMuted} numberOfLines={1}>{item.code} · {areaLabel(item)} · {locationLine(item)}</T>
          </Pressy>
        )} />
    </Sheet>
  );
}
