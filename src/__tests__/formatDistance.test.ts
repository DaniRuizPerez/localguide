import { formatDistance, formatRadius } from '../utils/formatDistance';

describe('formatDistance — km mode', () => {
  it('returns meters when < 1000 m', () => {
    expect(formatDistance(0, 'km')).toBe('0 m');
    expect(formatDistance(500, 'km')).toBe('500 m');
    expect(formatDistance(999, 'km')).toBe('999 m');
  });

  it('returns 1 decimal km when 1000 m ≤ distance < 10 km', () => {
    expect(formatDistance(1000, 'km')).toBe('1.0 km');
    expect(formatDistance(1500, 'km')).toBe('1.5 km');
    expect(formatDistance(9999, 'km')).toBe('10.0 km'); // rounds up to 10.0
  });

  it('returns rounded km when ≥ 10 km', () => {
    expect(formatDistance(10000, 'km')).toBe('10 km');
    expect(formatDistance(12400, 'km')).toBe('12 km');
    expect(formatDistance(20000, 'km')).toBe('20 km');
  });
});

describe('formatDistance — miles mode', () => {
  it('returns feet when < 0.1 mi (≈ 161 m)', () => {
    expect(formatDistance(10, 'miles')).toBe('33 ft');
    expect(formatDistance(100, 'miles')).toBe('328 ft');
  });

  it('returns 1 decimal mi when 0.1 mi ≤ distance < 10 mi', () => {
    expect(formatDistance(1609, 'miles')).toBe('1.0 mi');
    expect(formatDistance(4828, 'miles')).toBe('3.0 mi'); // 3 miles
    expect(formatDistance(16000, 'miles')).toBe('9.9 mi');
  });

  it('returns rounded miles when ≥ 10 mi', () => {
    // 10 mi = 16093.44 m; use 16100 to be safely above the 10-mi threshold
    expect(formatDistance(16100, 'miles')).toBe('10 mi');
    expect(formatDistance(32187, 'miles')).toBe('20 mi');
  });
});

describe('formatRadius', () => {
  it('formats km radii without decimals', () => {
    expect(formatRadius(2000, 'km')).toBe('2 km');
    expect(formatRadius(5000, 'km')).toBe('5 km');
    expect(formatRadius(10000, 'km')).toBe('10 km');
    expect(formatRadius(20000, 'km')).toBe('20 km');
  });

  it('formats miles radii without decimals', () => {
    expect(formatRadius(3219, 'miles')).toBe('2 mi');
    expect(formatRadius(8047, 'miles')).toBe('5 mi');
    expect(formatRadius(16093, 'miles')).toBe('10 mi');
    expect(formatRadius(32187, 'miles')).toBe('20 mi');
  });
});
