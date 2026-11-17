import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Polyline, Rect, Stop } from 'react-native-svg';

/** EstateFlow monogram: white roof-and-flow mark with a teal node, on the brand gradient (matches the launcher icon). */
export function Logo({ size = 72, plain = false }: { size?: number; plain?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="EstateFlow logo" accessible>
      <Defs>
        <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#0B2A4A" /><Stop offset="1" stopColor="#0F766E" /></LinearGradient>
      </Defs>
      {plain ? null : <Rect width="100" height="100" rx="28" fill="url(#lg)" />}
      <Polyline points="26,52 50,29 74,52" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M32 66 C41 58 47 74 56 66 S68 62 70 66" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" />
      <Circle cx="74" cy="52" r="6.5" fill="#2DD4BF" stroke="#0B2A4A" strokeWidth="1.8" />
    </Svg>
  );
}
