/**
 * ConnectionPill — three state snapshots (online, offline, unknown/probing),
 * tap handler, and label-colour + puck-position style assertions.
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

  it('pill body row has no padding/border/background — bare label + track', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const { getByTestId } = render(<ConnectionPill onPress={() => {}} />);
    const body = getByTestId('connection-pill-body');
    const style = body.props.style;
    const flat: Record<string, unknown> = Array.isArray(style)
      ? Object.assign({}, ...style)
      : style;
    expect(flat.flexDirection).toBe('row');
    expect(flat.alignItems).toBe('center');
    expect(flat.gap).toBe(6);
    expect(flat.padding).toBeUndefined();
    expect(flat.paddingHorizontal).toBeUndefined();
    expect(flat.paddingVertical).toBeUndefined();
    expect(flat.borderRadius).toBeUndefined();
    expect(flat.backgroundColor).toBeUndefined();
  });

  it('online: label coloured Colors.success, puck pinned right inside sage track', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    mockUseNetworkStatus.mockReturnValue('online');

    const { getByText, UNSAFE_getAllByType } = render(<ConnectionPill onPress={() => {}} />);
    const labelStyle = getByText('Online').props.style;
    const flatLabel = Array.isArray(labelStyle) ? Object.assign({}, ...labelStyle) : labelStyle;
    expect(flatLabel.color).toBe(Colors.success);

    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const track = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.successLight && f.width === 36 && f.height === 20;
    });
    expect(track).toBeTruthy();
    const puck = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === '#FFFFFF' && f.width === 14 && f.right === 2;
    });
    expect(puck).toBeTruthy();
  });

  it('offline: label coloured Colors.warning, puck pinned left inside amber track', () => {
    mockUseAppMode.mockReturnValue({ effective: 'offline', choice: 'force-offline', networkState: 'offline' });
    mockUseNetworkStatus.mockReturnValue('offline');

    const { getByText, UNSAFE_getAllByType } = render(<ConnectionPill onPress={() => {}} />);
    const labelStyle = getByText('Offline').props.style;
    const flatLabel = Array.isArray(labelStyle) ? Object.assign({}, ...labelStyle) : labelStyle;
    expect(flatLabel.color).toBe(Colors.warning);

    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const track = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.warningLight && f.width === 36 && f.height === 20;
    });
    expect(track).toBeTruthy();
    const puck = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === '#FFFFFF' && f.width === 14 && f.left === 2;
    });
    expect(puck).toBeTruthy();
  });

  it('probing: label coloured Colors.textTertiary, puck centred (left: 11) in muted track', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'unknown' });
    mockUseNetworkStatus.mockReturnValue('unknown');

    const { getByText, UNSAFE_getAllByType } = render(<ConnectionPill />);
    const labelStyle = getByText('Checking…').props.style;
    const flatLabel = Array.isArray(labelStyle) ? Object.assign({}, ...labelStyle) : labelStyle;
    expect(flatLabel.color).toBe(Colors.textTertiary);

    const { View } = require('react-native');
    const views = UNSAFE_getAllByType(View);
    const track = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === Colors.surface && f.width === 36 && f.height === 20;
    });
    expect(track).toBeTruthy();
    const puck = views.find((v: { props: { style?: unknown } }) => {
      const s = v.props.style;
      if (!s) return false;
      const f: Record<string, unknown> = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return f.backgroundColor === '#FFFFFF' && f.width === 14 && f.left === 11;
    });
    expect(puck).toBeTruthy();
  });
});
