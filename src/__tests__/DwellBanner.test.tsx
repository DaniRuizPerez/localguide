import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DwellBanner } from '../components/DwellBanner';
import type { Poi } from '../services/PoiService';

const poi: Poi = {
  pageId: 7,
  title: 'Stanford Quad',
  latitude: 37.4275,
  longitude: -122.1697,
  distanceMeters: 20,
  source: 'wikipedia',
};

describe('DwellBanner', () => {
  it('renders the POI title + eyebrow copy', () => {
    const { getByText } = render(
      <DwellBanner poi={poi} onAccept={() => {}} onDismiss={() => {}} />
    );
    expect(getByText(/Stanford Quad/)).toBeTruthy();
    expect(getByText(/YOU'VE BEEN HERE/)).toBeTruthy();
  });

  it('calls onAccept when the accept button is pressed', () => {
    const onAccept = jest.fn();
    const { getByLabelText } = render(
      <DwellBanner poi={poi} onAccept={onAccept} onDismiss={() => {}} />
    );
    fireEvent.press(getByLabelText('Tell me'));
    expect(onAccept).toHaveBeenCalled();
  });

  it('calls onDismiss when the dismiss button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByLabelText } = render(
      <DwellBanner poi={poi} onAccept={() => {}} onDismiss={onDismiss} />
    );
    fireEvent.press(getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
