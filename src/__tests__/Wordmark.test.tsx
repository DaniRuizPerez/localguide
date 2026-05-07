/**
 * Wordmark smoke tests.
 *
 * Asserts that the component renders the "AI Offline Tour Guide" label and that
 * the canyon topo-ring glyph (inline SVG) is present in the tree.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Wordmark } from '../components/Wordmark';

describe('Wordmark', () => {
  it('renders the "AI Offline Tour Guide" wordmark text', () => {
    const { getByText } = render(<Wordmark />);
    expect(getByText('AI Offline Tour Guide')).toBeTruthy();
  });

  it('renders the SVG canyon glyph (svg-root present)', () => {
    const { getByTestId } = render(<Wordmark />);
    expect(getByTestId('svg-root')).toBeTruthy();
  });

  it('renders 4 SVG circles (3 topo rings + center dot)', () => {
    const { getAllByTestId } = render(<Wordmark />);
    const circles = getAllByTestId('svg-circle');
    expect(circles).toHaveLength(4);
  });

  it('renders 2 SVG lines (N and S ticks)', () => {
    const { getAllByTestId } = render(<Wordmark />);
    const lines = getAllByTestId('svg-line');
    expect(lines).toHaveLength(2);
  });

  it('accepts a custom size prop without throwing', () => {
    const { getByText } = render(<Wordmark size={24} />);
    expect(getByText('AI Offline Tour Guide')).toBeTruthy();
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
