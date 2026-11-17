// Can this URL actually render inside an <iframe> on our page?
//
// A framed page that refuses to be framed (`X-Frame-Options: DENY`,
// `frame-ancestors 'none'`) or that errors does NOT fire `error` on the iframe —
// the browser paints its own blank/"refused to connect" page and still fires
// `load`. And the redesign preview is sandboxed without `allow-same-origin`, so
// its document is unreadable from here. The only reliable signal is to ask the
// URL first: same-origin GET with the same cookies the frame would send, then
// read the status and the framing headers. The live redesign preview rendered a
// blank frame in prod because the html_render proxy sent DENY.

export type FramePreviewState = 'ok' | 'unavailable';

/** Header-only check, split out so it is testable without a network. */
export function framingAllowed(headers: Pick<Headers, 'get'>): boolean {
	const xfo = headers.get('x-frame-options');
	if (xfo && /deny/i.test(xfo)) return false;
	const csp = headers.get('content-security-policy');
	if (csp) {
		const m = /frame-ancestors([^;]*)/i.exec(csp);
		if (m && /'none'/i.test(m[1])) return false;
	}
	return true;
}

export async function probeFramePreview(
	url: string,
	fetchFn: typeof fetch = fetch
): Promise<FramePreviewState> {
	// Our CSP has no frame-src, so default-src 'self' blocks any other origin —
	// an absolute or protocol-relative URL can never render in the frame.
	if (!url.startsWith('/') || url.startsWith('//')) return 'unavailable';
	try {
		const res = await fetchFn(url, {
			method: 'GET',
			credentials: 'same-origin',
			headers: { Accept: 'text/html' }
		});
		// Only the headers are needed; do not download the page twice.
		void res.body?.cancel().catch(() => {});
		if (!res.ok) return 'unavailable';
		return framingAllowed(res.headers) ? 'ok' : 'unavailable';
	} catch {
		return 'unavailable';
	}
}
