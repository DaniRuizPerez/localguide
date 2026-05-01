/**
 * ConnectionPill — three state snapshots (online, offline, unknown/probing)
 * plus a tap handler test.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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
});
