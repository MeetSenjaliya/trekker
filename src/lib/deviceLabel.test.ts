import { describe, expect, it } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it.each([
    // The two user-agents seen on auth.sessions in production.
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Chrome 151 · macOS',
    ],
    ['curl/8.7.1', 'curl/8.7.1'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari 17 · iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
      'Edge 150 · Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
      'Chrome 149 · Android',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox 130 · Linux'],
    ['node', 'node'],
    ['', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s → %s', (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected);
  });
});
