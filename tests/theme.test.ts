import assert from 'node:assert/strict';
import { CONTRAST_PAIRS, contrast, dark, light, resolveScheme, avatarColor, palettes } from '../src/lib/theme';

// Brand spec
assert.equal(light.bg, '#F6F8FB'); assert.equal(light.surface, '#FFFFFF'); assert.equal(light.text, '#0F1A2B');
assert.equal(dark.bg, '#0A1424'); assert.equal(dark.surface, '#111D31'); assert.equal(dark.text, '#F2F6FC');

// Both palettes define the same tokens
assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());

// WCAG AA for every text pair in both themes
for (const [name, p] of Object.entries(palettes)) {
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const r = contrast(p[fg], p[bg]);
    assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (need 4.5)`);
  }
}

// System mode follows the OS
assert.equal(resolveScheme('system', 'dark'), 'dark');
assert.equal(resolveScheme('system', null), 'light');
assert.equal(resolveScheme('light', 'dark'), 'light');
assert.equal(avatarColor('Ali'), avatarColor('Ali'));
console.log('theme tests passed');
