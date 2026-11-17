/**
 * One place that decides whether a URL is safe to put in an `href`.
 *
 * ⚠️ Every URL these components render is UNTRUSTED. They come from LLM output
 * (`cta_url` on a growth snippet, `finding.url` from a critique) or from a
 * scraped page (`references[]` in a source gallery) — and the webscraper, the scrape
 * ingress, will happily bring back whatever a page says. A prompt-injected page
 * returning `cta_url: "javascript:fetch('/api/...')"` gets that string bound
 * straight into a button, and clicking it executes in the app's own origin with
 * the user's session. `rel="noopener"` and `target="_blank"` do NOT stop
 * `javascript:` — they are about window handles, not scheme execution.
 *
 * The check already existed, correctly, in ONE component
 * (`runs/StageOutputView.svelte`) and was absent from nine siblings — the
 * guarded-beside-unguarded shape this fleet keeps rediscovering. So it lives
 * here now, and the components import it.
 *
 * Allow-list, not deny-list: `javascript:` is only the famous one. `data:`,
 * `vbscript:`, and `blob:` are all script-capable in some context, and a new
 * scheme can be added to the platform faster than to a deny-list.
 */

/** Schemes a rendered link may use. Everything else is refused. */
const SAFE_SCHEMES = ['http://', 'https://', 'mailto:'] as const;

/**
 * `true` when `value` is a string safe to bind to an `href`.
 *
 * Accepts absolute http(s) and mailto URLs, and site-relative paths (`/foo`).
 * Rejects everything else — including protocol-relative `//evil.example`, which
 * inherits the page's scheme and is a same-looking off-origin navigation.
 */
export function isSafeHref(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (trimmed === '') return false;
	// Site-relative, but NOT protocol-relative (`//host` is off-origin).
	if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
	// Scheme comparison is case-insensitive: `JaVaScRiPt:` is the same sink.
	const lowered = trimmed.toLowerCase();
	return SAFE_SCHEMES.some((scheme) => lowered.startsWith(scheme));
}

/**
 * `value` if it is a safe href, otherwise `undefined`.
 *
 * `undefined` rather than `'#'` so a caller can `{#if}` the link away entirely;
 * rendering a dead `#` link that looks clickable is its own small lie.
 */
export function safeHref(value: unknown): string | undefined {
	return isSafeHref(value) ? value.trim() : undefined;
}
