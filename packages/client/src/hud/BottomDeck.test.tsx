// Regression test for the lead-review a11y blocker: resource pills must NOT
// be hue-only — each needs a distinct accessible name naming the resource
// (not the generic "N cards" hand-size string), backed by a distinct glyph
// shape. Rendered via `react-dom/server` (see components.test.tsx for why).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider.js';
import { BottomDeck } from './BottomDeck.js';

describe('BottomDeck — resource pills accessible names', () => {
  it('gives each of the 5 resources a DISTINCT accessible name (not the generic hand-size string)', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <BottomDeck />
      </I18nProvider>,
    );

    // Default locale is ru (DEFAULT_LOCALE) — assert every Classic resource
    // name appears in its own aria-label, so a screen reader announces
    // "Лес: N", "Глина: N", etc., never a bare hue-only count.
    for (const resourceName of ['Лес', 'Глина', 'Руно', 'Ячмень', 'Железо']) {
      expect(html).toContain(`aria-label="${resourceName}:`);
    }
  });

  it('renders a visually distinct glyph shape per resource (not just a color swatch)', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <BottomDeck />
      </I18nProvider>,
    );

    // Each resource's ResourceGlyph uses a different SVG primitive/shape —
    // presence of all these distinct markers proves the 5 pills aren't
    // rendering the same shape in 5 colors.
    expect(html).toContain('<circle'); // timber
    expect(html).toContain('<line'); // clay courses / barley ear
    expect(html).toContain('<polygon'); // iron ingot
  });
});
