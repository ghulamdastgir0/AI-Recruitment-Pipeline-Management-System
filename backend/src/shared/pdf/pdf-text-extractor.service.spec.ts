import { sanitizeExtractedText } from './pdf-text-extractor.service';

describe('sanitizeExtractedText', () => {
  it('strips NUL bytes (icon-glyph artifacts from resume-template PDFs)', () => {
    const withNul = 'AI Developer \x00\x00 92 - 312 - 6957039';

    const result = sanitizeExtractedText(withNul);

    expect(result).not.toContain('\x00');
    expect(result).toBe('AI Developer  92 - 312 - 6957039');
  });

  it('strips other C0 control characters but keeps tab/newline/carriage-return', () => {
    const text = 'Line one\tindented\nLine two\r\n\x01\x02bad';

    const result = sanitizeExtractedText(text);

    expect(result).toBe('Line one\tindented\nLine two\r\nbad');
  });

  it('leaves normal resume text untouched', () => {
    const text = 'React, JavaScript, Node.js — 3 years of experience.';

    expect(sanitizeExtractedText(text)).toBe(text);
  });
});
