import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';
import { SITE_NAME, factLine, truncate } from '@/lib/site';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${SITE_NAME} trek`;

/**
 * Inter carries ₹ and ·, which the renderer's built-in font draws as tofu.
 * The files are colocated and addressed through `import.meta.url` so the bundler
 * emits them alongside this route — a `process.cwd()` read would miss them in the
 * standalone output — and read from disk, since `fetch` cannot open a file: URL.
 */
function loadFonts() {
  return Promise.all([
    readFile(new URL('./Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('./Inter-Bold.ttf', import.meta.url)),
  ]);
}

/**
 * Only the fields the card draws, and deliberately through the cookie-less
 * client: a link scraper is anonymous, so the request's auth view is never
 * worth the extra work.
 */
async function getTrekCard(id: string) {
  const { data, error } = await supabase
    .from('treks')
    .select('title, location, difficulty, estimated_cost')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching trek for OG image:', error.message);
    return null;
  }
  return data;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [trek, [regularData, boldData]] = await Promise.all([getTrekCard(id), loadFonts()]);

  // Two lines at this size hold roughly 60 characters; cutting here rather than
  // clamping keeps the card from ever pushing the fact line off the canvas.
  const title = trek?.title ? truncate(trek.title, 60) : 'Explore Together';
  const facts = trek ? factLine(trek) : 'Find and join treks across India';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          fontFamily: 'Inter',
          color: '#ffffff',
          backgroundColor: '#0f172a',
          backgroundImage:
            'radial-gradient(circle at 80% 8%, #3b82f6 0%, rgba(59,130,246,0) 55%), linear-gradient(135deg, #0f172a 25%, #1e3a8a 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div
              style={{
                display: 'flex',
                width: 72,
                height: 72,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
              </svg>
            </div>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
              {SITE_NAME}
            </div>
          </div>

          {trek?.difficulty ? (
            <div
              style={{
                display: 'flex',
                padding: '12px 28px',
                borderRadius: 999,
                fontSize: 24,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.9)',
                backgroundColor: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            >
              {trek.difficulty}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 66, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2 }}>
            {title}
          </div>
          {facts ? (
            <div style={{ display: 'flex', marginTop: 28, fontSize: 30, color: 'rgba(255,255,255,0.72)' }}>
              {facts}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24, color: 'rgba(255,255,255,0.55)' }}>
          <div style={{ display: 'flex', width: 56, height: 4, borderRadius: 2, backgroundColor: '#60a5fa' }} />
          <div style={{ display: 'flex' }}>Find your next trek on Trek Buddies</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Inter', data: regularData, weight: 400, style: 'normal' },
        { name: 'Inter', data: boldData, weight: 700, style: 'normal' },
      ],
    }
  );
}
