import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from './csv';

describe('RFC 4180 CSV', () => {
  it('quotes fields with commas, quotes, or line breaks and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "no"')).toBe('"say ""no"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField(null)).toBe('');
    expect(csvField(42)).toBe('42');
    expect(csvField(-5)).toBe('-5');
  });

  it('neutralizes text a spreadsheet would execute as a formula', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+19 Power')).toBe("'+19 Power");
    expect(csvField('-30% power')).toBe("'-30% power");
    expect(csvField('@cmd')).toBe("'@cmd");
  });

  it('joins rows with CRLF behind a UTF-8 BOM', () => {
    expect(toCsv(['a', 'b'], [[1, 'x→y']])).toBe('﻿a,b\r\n1,x→y\r\n');
  });
});
