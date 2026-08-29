import { buildEmail } from './email-templates';

describe('buildEmail — HTML escaping of interpolated values', () => {
  it('escapes an HTML/script payload in candidateName', () => {
    const { html } = buildEmail('APPLICATION_RECEIVED', {
      candidateName: '<img src=x onerror=alert(1)>',
      jobTitle: 'Backend Engineer',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes an anchor-tag payload in offerDetails', () => {
    const { html } = buildEmail('OFFER_LETTER', {
      candidateName: 'Jane',
      jobTitle: 'Backend Engineer',
      offerDetails: '<a href="https://evil.example">reset your password</a>',
    });

    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
  });

  it('escapes markup in jobTitle', () => {
    const { html } = buildEmail('SELECTION', {
      candidateName: 'Jane',
      jobTitle: 'Engineer <script>evil()</script>',
    });

    expect(html).not.toContain('<script>evil()');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
  });

  it('leaves ordinary names and titles untouched', () => {
    const { subject, html } = buildEmail('APPLICATION_RECEIVED', {
      candidateName: "Jane O'Brien",
      jobTitle: 'Backend Engineer',
    });

    expect(html).toContain('Backend Engineer');
    expect(html).toContain('Jane O&#39;Brien');
    // Subjects are plain-text headers — not entity-escaped.
    expect(subject).toBe(
      "We've received your application for Backend Engineer",
    );
  });

  it('does not double-escape an ampersand already present as text', () => {
    const { html } = buildEmail('SELECTION', {
      candidateName: 'A & B',
      jobTitle: 'R&D Engineer',
    });

    expect(html).toContain('A &amp; B');
    expect(html).toContain('R&amp;D Engineer');
    expect(html).not.toContain('&amp;amp;');
  });
});
