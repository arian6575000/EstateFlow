import assert from 'node:assert/strict';
import { groupPk, isYmd, moneyWords, parseMoney, rs, shareText } from '../src/lib/estate';

assert.equal(parseMoney('1.5 crore'), 15_000_000); assert.equal(parseMoney('75 Lakh'), 7_500_000); assert.equal(parseMoney('25 lac'), 2_500_000);
assert.equal(parseMoney('Rs 1,20,00,000'), 12_000_000); assert.equal(parseMoney('50k'), 50_000); assert.equal(parseMoney('2500000'), 2_500_000); assert.equal(parseMoney('1.2 arab'), 1_200_000_000);
for (const bad of ['', 'abc', '-5', '1..2', '5 crore lakh', '1e5']) assert.equal(parseMoney(bad), null, bad);
assert.equal(moneyWords(12_500_000), '1.25 Crore'); assert.equal(moneyWords(750_000), '7.5 Lakh'); assert.equal(moneyWords(1_200_000_000), '1.2 Arab'); assert.equal(moneyWords(500), '500');
assert.equal(groupPk(12345678), '1,23,45,678'); assert.equal(groupPk(999), '999'); assert.equal(groupPk(100000), '1,00,000'); assert.equal(rs(-2500000), 'Rs -25,00,000');
assert.ok(isYmd('2026-11-17')); assert.ok(!isYmd('2026-13-45')); assert.ok(!isYmd('17-11-2026'));
const t = shareText({ code: 'PR-000001', title: '10 Marla Plot', category: 'residential_plot', society: 'DHA', phase: '6', block: 'K', plotNo: '123', area: '', city: 'Lahore', areaLabel: '10 Marla', transactionType: 'sale', bedrooms: null, bathrooms: null, description: '' }, 15_000_000, 'RetailX Solution · 03286575000');
assert.ok(t.includes('Plot 123, Block K, Phase 6, DHA, Lahore') && t.includes('1.5 Crore') && t.includes('PR-000001') && !/min/i.test(t));
console.log('format tests passed');
