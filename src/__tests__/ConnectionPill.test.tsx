/**
 * ConnectionPill — three state snapshots (online, offline, unknown/probing),
 * tap handler, and soft-tactile style assertions.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Colors } from '../theme/colors';

// Control the hooks so we can drive each state deterministically.
jest.mock('../hooks/useAppMode', () => ({
  useAppMode: jest.fn(),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(),
}));

import { ConnectionPill } from '../components/ConnectionPill';
import { useAppMode } from '../hooks/useAppMode';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const mockUseAppMode = useAppMode as jest.Mock;
const mockUseNetworkStatus = useNetworkStatus as jest.Mock;

describe('ConnectionPill', () => {
  it('shows Online label when effective is online and network is online', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const { getByText } = render(<ConnectionPill onPress={() => {}} />);
    // t('mode.online') returns 'Online' (Title Case from i18n strings).
    expect(getByText('Online')).toBeTruthy();
  });

  it('shows Offline label when effective is offline', () => {
    mockUseAppMode.mockReturnValue({ effective: 'offline', choice: 'force-offline', networkState: 'offline' });
    mockUseNetworkStatus.mockReturnValue('offline');

    const { getByText } = render(<ConnectionPill onPress={() => {}} />);
    expect(getByText('Offline')).toBeTruthy();
  });

  it('shows Checking label when effective is online but network is unknown (probing)', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'unknown' });
    mockUseNetworkStatus.mockReturnValue('unknown');

    const { getByText } = render(<ConnectionPill onPress={() => {}} />);
    // t('mode.unknownProbing') returns 'Checking…'
    expect(getByText('Checking…')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const onPress = jest.fn();
    const { getByTestId } = render(<ConnectionPill onPress={onPress} />);
    fireEvent.press(getByTestId('connection-pill'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onPress is omitted (non-interactive pill)', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    // Should render without errors and display the label.
    const { getByText } = render(<ConnectionPill />);
    expect(getByText('Online')).toBeTruthy();
  });

  it('pill body has soft-tactile inset-shadow style: borderRadius 14, paddingHorizontal 11, paddingVertical 5', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const { getByTestId } = render(<ConnectionPill onPress={() => {}} />);
    const body = getByTestId('connection-pill-body');
    const style = body.props.style;
    // Flatten in case it's an array.
    const flat: Record<string, unknown> = Array.isArray(style)
      ? Object.assign({}, ...style)
      : style;
    expect(flat.borderRadius).toBe(14);
    expect(flat.paddingHorizontal).toBe(11);
    expect(flat.paddingVertical).toBe(5);
    // Inset shadow: elevation should be 0 (no Android outset shadow).
    expect(flat.elevation).toBe(0);
  });

  it('online dot uses Colors.success (#4ea374)', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const { UNSAFE_getAllByType } = render(<ConnectionPill onPress={() => {}} />);
    // The dot is a View with a backgroundColor style containing the dot color.
    // We find the View nodes and look for the one with backgroundColor === Colors.success.
    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const dotView = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.success;
    });
    expect(dotView).toBeTruthy();
  });

  it('offline dot uses Colors.warning (amber)', () => {
    mockUseAppMode.mockReturnValue({ effective: 'offline', choice: 'force-offline', networkState: 'offline' });
    mockUseNetworkStatus.mockReturnValue('offline');

    const { UNSAFE_getAllByType } = render(<ConnectionPill onPress={() => {}} />);
    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const dotView = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.warning;
    });
    expect(dotView).toBeTruthy();
  });

  it('probing dot uses Colors.textTertiary (grey)', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'unknown' });
    mockUseNetworkStatus.mockReturnValue('unknown');

    const { UNSAFE_getAllByType } = render(<ConnectionPill />);
    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const dotView = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.textTertiary;
    });
    expect(dotView).toBeTruthy();
  });
});
