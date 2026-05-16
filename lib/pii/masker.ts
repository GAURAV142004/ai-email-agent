import { PII_PATTERNS } from './patterns';

export interface MaskResult {
  masked: string;
  detectedTypes: string[];
  itemsRemoved: number;
  wasMasked: boolean;
}

export function maskPII(raw: string): MaskResult {
  let text = raw;
  const types = new Set<string>();
  let count = 0;

  for (const { type, pattern, replacement } of PII_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      types.add(type);
      count += matches.length;
      text = text.replace(pattern, replacement);
    }
  }

  return {
    masked: text,
    detectedTypes: [...types],
    itemsRemoved: count,
    wasMasked: count > 0,
  };
}
