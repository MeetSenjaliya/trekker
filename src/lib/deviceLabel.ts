// A short human label for a User-Agent string, for the /admin/logins table.
// Order matters in both lists: Edge and Chrome both contain "Safari", iPhone
// and iPad both contain "Mac OS X".
const browsers: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\bOPR\/(\d+)/, 'Opera'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bChrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+).*\bSafari\//, 'Safari'],
];

const platforms: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return 'Unknown device';

  const browser = browsers.find(([re]) => re.test(ua));
  const platform = platforms.find(([re]) => re.test(ua));
  if (!browser && !platform) return ua.split(' ')[0];

  const name = browser ? `${browser[1]} ${ua.match(browser[0])![1]}` : 'Browser';
  return platform ? `${name} · ${platform[1]}` : name;
}
