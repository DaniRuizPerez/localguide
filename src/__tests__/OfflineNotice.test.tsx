/**
 * OfflineNotice — renders only when effective mode is 'offline'.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../hooks/useAppMode', () => ({
  useAppMode: jest.fn(),
}));

import { OfflineNotice } from '../components/OfflineNotice';
import { useAppMode } from '../hooks/useAppMode';

const mockUseAppMode = useAppMode as jest.Mock;

describe('OfflineNotice', () => {
  it('renders the warning strip when effective is offline', () => {
    mockUseAppMode.mockReturnValue({ effective: 'offline', choice: 'auto', networkState: 'offline' });
    const { queryByText } = render(<OfflineNotice />);
    expect(queryByText(/Offline/i)).toBeTruthy();
  });

  it('renders nothing when effective is online', () => {
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'auto', networkState: 'online' });
    const { queryByText } = render(<OfflineNotice />);
    expect(queryByText(/Offline/i)).toBeNull();
  });

  it('renders nothing when forced online even if network is offline', () => {
    // The hook resolves effective='online' for 'force-online' choice — we
    // just render based on effective, so the strip stays hidden.
    mockUseAppMode.mockReturnValue({ effective: 'online', choice: 'force-online', networkState: 'offline' });
    const { queryByText } = render(<OfflineNotice />);
    expect(queryByText(/Offline/i)).toBeNull();
  });
});
