/**
 * SourceBadge — every Source variant renders without crashing and shows
 * the expected label glyph.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { SourceBadge, type Source } from '../components/SourceBadge';

const cases: Array<{ source: Source; expectedLabel: RegExp }> = [
  { source: 'wikipedia', expectedLabel: /Wikipedia/ },
  { source: 'maps', expectedLabel: /Maps/ },
  { source: 'geonames', expectedLabel: /GeoNames/ },
  { source: 'ai-online', expectedLabel: /AI/ },
  { source: 'ai-offline', expectedLabel: /Offline AI/ },
];

describe('SourceBadge', () => {
  it.each(cases)('renders the $source variant', ({ source, expectedLabel }) => {
    const { queryByText } = render(<SourceBadge source={source} />);
    expect(queryByText(expectedLabel)).toBeTruthy();
  });
});
