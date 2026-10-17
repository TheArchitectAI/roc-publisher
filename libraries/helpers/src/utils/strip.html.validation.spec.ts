import { stripHtmlValidation } from './strip.html.validation';

describe('stripHtmlValidation', () => {
  it('does not double-unescape an encoded entity in type none', () => {
    expect(stripHtmlValidation('none', '&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('still decodes &lt; in type none', () => {
    expect(stripHtmlValidation('none', '&lt;')).toBe('<');
  });

  it('still decodes &amp; in type none', () => {
    expect(stripHtmlValidation('none', 'a &amp; b')).toBe('a & b');
  });

  it('does not double-unescape an encoded entity in type markdown', () => {
    expect(stripHtmlValidation('markdown', '<p>&amp;lt;b&amp;gt;</p>')).toBe(
      '&lt;b&gt;\n'
    );
  });

  it('does not double-unescape an encoded entity with the none flag', () => {
    expect(
      stripHtmlValidation('normal', '<p>&amp;lt;b&amp;gt;</p>', false, true)
    ).toBe('&lt;b&gt;');
  });

  it('still decodes &lt; and &amp; in type markdown', () => {
    expect(stripHtmlValidation('markdown', '<p>&lt; &amp; b</p>')).toBe(
      '< & b\n'
    );
  });
});
