/**
 * Wordmark smoke tests.
 *
 * Asserts that the component renders the "AI Offline Tour Guide" label and the
 * Canyon brand-mark image glyph.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Wordmark } from '../components/Wordmark';

describe('Wordmark', () => {
  it('renders the "AI Offline Tour Guide" wordmark text', () => {
    const { getByText } = render(<Wordmark />);
    expect(getByText('AI Offline Tour Guide')).toBeTruthy();
  });

  it('renders the Canyon brand-mark image', () => {
    const { getByTestId } = render(<Wordmark />);
    expect(getByTestId('wordmark-glyph')).toBeTruthy();
  });

  it('scales the glyph with the size prop', () => {
    const { getByTestId } = render(<Wordmark size={40} />);
    const glyph = getByTestId('wordmark-glyph');
    const flat = Array.isArray(glyph.props.style)
      ? Object.assign({}, ...glyph.props.style.filter(Boolean))
      : glyph.props.style;
    expect(flat.width).toBeCloseTo(36); // 40 * 0.9
    expect(flat.height).toBeCloseTo(36);
  });

  it('accepts a style prop without throwing', () => {
    const { getByText } = render(<Wordmark style={{ opacity: 0.5 }} />);
    expect(getByText('AI Offline Tour Guide')).toBeTruthy();
  });

  it('iconOnly hides text and sets accessibilityLabel on container', () => {
    const { queryByText, root } = render(<Wordmark iconOnly />);
    expect(queryByText('AI Offline Tour Guide')).toBeNull();
    expect(root.props.accessibilityLabel).toBe('AI Offline Tour Guide');
  });
});
