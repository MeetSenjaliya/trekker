/**
 * Renders a schema.org payload as an inline ld+json script.
 *
 * Server-only: the payload is built from `siteUrl`, which is not exposed to the
 * browser. The `<` escape is not cosmetic — trek and company descriptions are
 * user-supplied, and a literal `</script>` inside one would close this tag early
 * and let the rest of the string run as markup.
 */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
