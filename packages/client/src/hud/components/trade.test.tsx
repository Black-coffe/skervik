// Trade component render smokes — `renderToStaticMarkup` (no jsdom), same
// approach as `components.test.tsx`. Interaction logic lives in pure,
// separately-tested helpers (`hud/trade.ts`); these assert structure + states.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n/index.js';
import { OfferBuilder } from './OfferBuilder.js';
import { OfferCard } from './OfferCard.js';

const EMPTY = { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0 };
const HAND = { ...EMPTY, fleece: 3, timber: 2 };

function render(node: ReactElement): string {
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
}

describe('OfferBuilder', () => {
  it('renders a docked builder with both columns and a seal button (not a modal)', () => {
    const html = render(
      <OfferBuilder mode="propose" hand={HAND} onSeal={() => undefined} />,
    );
    expect(html).toContain('offer-builder');
    expect(html).not.toContain('role="dialog"');
    // Both columns of steppers, each resource once per column.
    expect(html.match(/offer-builder__col-title/g)).toHaveLength(2);
    expect(html).toContain('btn--primary');
  });

  it('disables the give "+" for a resource the hand does not hold', () => {
    // iron: 0 in HAND — its give stepper "+" must be disabled (clamp to hand).
    const html = render(
      <OfferBuilder mode="propose" hand={EMPTY} onSeal={() => undefined} />,
    );
    // Every give "+" is disabled with an all-zero hand; the primary seal is too.
    expect(html).toContain('disabled');
    expect(html).toContain('btn--primary');
  });
});

describe('OfferCard', () => {
  it('renders an incoming offer as a docked card (never a blocking modal)', () => {
    const html = render(
      <OfferCard
        variant="incoming"
        proposerFlotillaId="orca"
        proposerColorCss="#eeeeee"
        proposerLabel="Orca"
        theyGive={{ ...EMPTY, fleece: 3 }}
        theyGet={{ ...EMPTY, iron: 1 }}
        isCounter={false}
        canAccept={true}
        canCounter={true}
        pending={false}
        onAccept={() => undefined}
        onDecline={() => undefined}
        onCounter={() => undefined}
      />,
    );
    expect(html).toContain('offer-card');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('btn--primary'); // Accept
    expect(html).toContain('btn--quiet'); // Decline
    expect(html).toContain('offer-card__counter'); // Counter
  });

  it('disables Accept when I cannot afford, and Counter at depth>=1', () => {
    const html = render(
      <OfferCard
        variant="incoming"
        proposerFlotillaId="orca"
        proposerColorCss="#eeeeee"
        proposerLabel="Orca"
        theyGive={{ ...EMPTY, fleece: 3 }}
        theyGet={{ ...EMPTY, iron: 1 }}
        isCounter={true}
        canAccept={false}
        canCounter={false}
        pending={false}
        onAccept={() => undefined}
        onDecline={() => undefined}
        onCounter={() => undefined}
      />,
    );
    // Both the primary (Accept) and the counter button carry `disabled`.
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders an outgoing offer with the pending-seal state', () => {
    const html = render(
      <OfferCard
        variant="outgoing"
        give={{ ...EMPTY, fleece: 2 }}
        get={{ ...EMPTY, iron: 1 }}
        pending={true}
        onWithdraw={() => undefined}
      />,
    );
    expect(html).toContain('offer-card__seal'); // the pending wax pulse
    expect(html).toContain('btn--danger'); // Withdraw
  });

  it('renders a compact history row', () => {
    const html = render(
      <OfferCard
        variant="history"
        kind="accepted"
        actorLabel="You"
        statusLabel="Sealed"
        give={{ ...EMPTY, fleece: 2 }}
        get={{ ...EMPTY, iron: 1 }}
      />,
    );
    expect(html).toContain('offer-card--history');
    expect(html).toContain('offer-card__status--accepted');
    expect(html).toContain('Sealed');
  });
});
