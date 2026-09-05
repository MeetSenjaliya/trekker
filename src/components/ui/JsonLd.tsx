import { headers } from 'next/headers';

/**
 * Renders a schema.org payload as an inline ld+json script.
 *
 * Server-only: the payload is built from `siteUrl`, which is not exposed to the
 * browser. The `<` escape is not cosmetic — trek and company descriptions are
 * user-supplied, and a literal `</script>` inside one would close this tag early
 * and let the rest of the string run as markup.
 *
 * The nonce is not optional dressing: script-src covers every <script> element,
 * type and all, so without it the enforced policy blocks this one and the page
 * ships no structured data.
 */
export default async function JsonLd({ data }: { data: object }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
