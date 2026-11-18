import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../ctx/AppContext';
import { Range, RangeKey, rangeFor } from '../db/reportRepo';
import { isYmd, todayYmd } from '../lib/estate';
import { space } from '../lib/theme';
import { Button, Chip, Field } from './kit';
import { Sheet } from './Sheet';

export interface RangeState { key: RangeKey; custom?: Range }
export const rangeOf = (s: RangeState): Range => { try { return rangeFor(s.key, Date.now(), s.custom); } catch { return rangeFor('month'); } };
const LABEL: Record<RangeKey, string> = { today: 'Today', week: 'This week', month: 'This month', year: 'This year', custom: 'Custom' };
const ymdToMs = (s: string) => new Date(s + 'T00:00:00').getTime();

/** Today / This week / This month / This year / Custom range (From–To, inclusive). */
export function RangeChips({ value, onChange }: { value: RangeState; onChange: (v: RangeState) => void }) {
  const { toast } = useApp(); const [open, setOpen] = useState(false); const [from, setFrom] = useState(todayYmd()); const [to, setTo] = useState(todayYmd());
  const apply = () => {
    if (!isYmd(from) || !isYmd(to)) { toast('Use dates like 2026-11-01', 'error'); return; }
    if (to < from) { toast('The end date is before the start date', 'error'); return; }
    onChange({ key: 'custom', custom: { from: ymdToMs(from), to: ymdToMs(to) + 86400000 } }); setOpen(false);
  };
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{(['today', 'week', 'month', 'year', 'custom'] as RangeKey[]).map((k) => <Chip key={k} label={LABEL[k]} selected={value.key === k} icon={k === 'custom' ? 'calendar' : undefined} onPress={() => (k === 'custom' ? setOpen(true) : onChange({ key: k }))} />)}</View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Custom range" footer={<Button block label="Apply" icon="checkmark" onPress={apply} />}>
        <Field label="From" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" /><Field label="To (inclusive)" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
      </Sheet>
    </View>
  );
}
