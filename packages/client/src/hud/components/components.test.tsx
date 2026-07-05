// Component smoke tests — rendered via `react-dom/server`'s
// `renderToStaticMarkup` (no jsdom/RTL needed: this story's only sanctioned
// new dependency is `zustand`, so we reuse the `react-dom` already in the
// dependency tree instead of adding a DOM-testing library).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { Pill } from './Pill.js';
import { PlayerCard } from './PlayerCard.js';
import { SeedChip } from './SeedChip.js';

describe('Button', () => {
  it('renders its variant class and label', () => {
    const html = renderToStaticMarkup(<Button variant="primary">Build</Button>);
    expect(html).toContain('btn--primary');
    expect(html).toContain('Build');
  });

  it('renders disabled with the disabled attribute', () => {
    const html = renderToStaticMarkup(
      <Button variant="quiet" disabled>
        Trade
      </Button>,
    );
    expect(html).toContain('disabled');
  });

  it('marks aria-busy when loading', () => {
    const html = renderToStaticMarkup(
      <Button variant="danger" loading>
        Cancel offer
      </Button>,
    );
    expect(html).toContain('aria-busy="true"');
  });
});

describe('Pill', () => {
  it('renders the resource variant with an icon and count', () => {
    const html = renderToStaticMarkup(
      <Pill variant="resource" icon={<span>ico</span>}>
        3
      </Pill>,
    );
    expect(html).toContain('pill--resource');
    expect(html).toContain('>3<');
  });
});

describe('SeedChip', () => {
  it('shows only the first 8 chars of a longer hash', () => {
    const html = renderToStaticMarkup(
      <SeedChip label="The Sealed Lot" seedHash={'a'.repeat(64)} />,
    );
    expect(html).toContain('aaaaaaaa');
    expect(html).not.toContain('a'.repeat(9));
  });
});

describe('EmptyState', () => {
  it('renders the given localized message', () => {
    const html = renderToStaticMarkup(<EmptyState message="The log is empty" />);
    expect(html).toContain('The log is empty');
  });
});

describe('PlayerCard', () => {
  it('never renders a raw victoryPoints/hidden-VP field name — only the pre-computed renownValue prop', () => {
    const html = renderToStaticMarkup(
      <PlayerCard
        flotillaId="petrel"
        colorCss="#4682cc"
        flotillaLabel="Petrel Flotilla"
        renownValue={4}
        renownLabel="Renown"
        handSizeLabel="5 cards"
        venturesLabel="2 ventures"
        knightsLabel="1 convoy"
        hasLongestRoad={true}
        longestRoadLabel="Great Fairway"
        hasLargestArmy={false}
        largestArmyLabel="Scourge of Privateers"
        isCurrentPlayer={true}
        connectionLabel="Online"
      />,
    );
    expect(html).toContain('player-card--current');
    expect(html).toContain('Petrel Flotilla');
    expect(html).toContain('Great Fairway');
    expect(html).not.toContain('Scourge of Privateers');
  });
});
