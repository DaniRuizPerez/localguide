import React from 'react';
import { render } from '@testing-library/react-native';
import ChatScreen from '../screens/ChatScreen';

// Minimal navigation mock — avoids full navigator setup in unit tests
const mockNavigation = {} as any;
const mockRoute = { key: 'Chat', name: 'Chat' } as any;

describe('ChatScreen', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(
      <ChatScreen navigation={mockNavigation} route={mockRoute} />
    );
    expect(getByText('Chat')).toBeTruthy();
    expect(getByText('Local guide conversations will appear here.')).toBeTruthy();
  });
});
