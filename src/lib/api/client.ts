import { ensureFreshToken } from '$lib/services/keycloak.js';

// Synthetic non-JWT tokens minted by the dev / e2e auth-bypass paths in
// keycloak.ts (kept in sync with the `kc.token = '…'` sentinels there). They are
// only used to satisfy the SPA's own auth-guard checks — they must NEVER be sent
// upstream as `Authorization`, because the backend validates it as a JWT and
// 401s on an unparseable one even when a valid X-Tenant-Id license is present.
const BYPASS_TOKEN_SENTINELS = new Set(['e2e-bypass-token', 'dev-bypass-token']);
import { ensureAuthReady } from '$lib/stores/auth.svelte.js';
import { TENANT_NOT_ONBOARDED } from './onboarding.js';
import { parseByoProviderRequired } from './byo-provider.js';

export class ApiError extends Error {
	status: number;
	statusText: string;
	detail: string;
	/** Stable machine code from the canonical error envelope (`error.code`, e.g.
	 *  `LAST_TENANT_ADMIN`, `INVITE_GONE`) — what a screen should branch on
	 *  instead of parsing the human message. Undefined for legacy bodies. */
	code: string | undefined;
	/** `error.details` from the envelope (e.g. `{invite_id}` on INVITE_PENDING). */
	details: Record<string, unknown> | undefined;
	/** `Retry-After` response header in whole seconds (delta-seconds or HTTP-date),
	 *  null when absent or unparseable. Lets a 429 screen say how long to wait. */
	retryAfter: number | null;
	/** The parsed JSON error body, verbatim (undefined when it was not JSON). For
	 *  screens that need a field the reducers above drop — e.g. a flat
	 *  `{error, detail, signupId}` body's extra keys, or a 422's `detail` list. */
	body: unknown;

	constructor(
		status: number,
		statusText: string,
		detail: string,
		code?: string,
		details?: Record<string, unknown>,
		retryAfter: number | null = null,
		body?: unknown
	) {
		super(`${status} ${statusText}: ${detail}`);
		this.status = status;
		this.statusText = statusText;
		this.detail = detail;
		this.code = code;
		this.details = details;
		this.retryAfter = retryAfter;
		this.body = body;
	}
}

/** Parse a `Retry-After` header value (RFC 9110: delta-seconds or HTTP-date) to
 *  whole seconds from `now`. Null when absent or unparseable; never negative. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
	if (value == null) return null;
	const v = value.trim();
	if (!v) return null;
	if (/^\d+$/.test(v)) return Number(v);
	const at = Date.parse(v);
	if (Number.isNaN(at)) return null;
	return Math.max(0, Math.ceil((at - now) / 1000));
}

// Auth headers that persist across requests. `Authorization` is read fresh
// from Keycloak per request (see `request()`), so it is NOT stored here —
// the only persistent header is `X-Tenant-Id` and only when we have a real
// license token to put in it.
//
// Backend contract (see /Users/mini1/Movies/w2v/CLAUDE.md "Auth — license
// token + tenant forwarding" and w2v_common/auth/middleware.py):
//   - Inbound SPA→backend: `X-Tenant-Id: Bearer <license_token>` carries the
//     opaque license token. The middleware ONLY accepts the `Bearer ` form
//     here; a plain UUID is silently treated as no license-token at all.
//   - `Authorization: Bearer <jwt>` is reserved for the Keycloak JWT and is
//     a separate auth axis (validated against Keycloak, not introspected).
//
// Until /auth/me starts returning a license token (or one is provisioned via
// VITE_LICENSE_TOKEN for local dev), the SPA can rely solely on its Keycloak
// JWT — the backend middleware accepts EITHER axis. Sending a malformed
// `x-tenant-id: <uuid>` was wrong and is gone.
const ENV_LICENSE_TOKEN = (import.meta.env.VITE_LICENSE_TOKEN as string | undefined) ?? '';
let licenseToken: string = ENV_LICENSE_TOKEN;

/** Set the license token used to build the `X-Tenant-Id: Bearer <token>` header. */
export function setLicenseToken(token: string | null | undefined): void {
	licenseToken = token ?? '';
}

/** Clear the license token. */
export function clearLicenseToken(): void {
	licenseToken = '';
}

/** Build the `X-Tenant-Id` header value, or undefined if there is no license token. */
function tenantHeader(): string | undefined {
	return licenseToken ? `Bearer ${licenseToken}` : undefined;
}

/** Public accessor for the formatted `X-Tenant-Id` value (or undefined). */
export function getTenantHeader(): string | undefined {
	return tenantHeader();
}

// Super-admin scope-switch: when a super_admin picks another tenant in the
// header switcher, that tenant id is sent as `X-Active-Tenant-Id` on every
// subsequent call and the orchestrator re-scopes the whole app to it. Empty ⇒
// header absent ⇒ identical to acting as the caller's own tenant. The backend
// silently ignores the header for non-super callers (probe-resistant), so it is
// harmless if it ever leaks onto a non-admin session.
let activeTenantId = '';

/** Set (or clear, with null) the active tenant id sent as `X-Active-Tenant-Id`. */
export function setActiveTenantId(id: string | null | undefined): void {
	activeTenantId = id ?? '';
}

/**
 * The currently switched-to tenant id, or `''` when acting as our own tenant.
 *
 * Exported so the OTHER fetch surface in `$lib/api` — `downloads.ts`, which
 * builds its own headers rather than going through `request()` — can attach
 * `X-Active-Tenant-Id` too. Without it, every byte-returning download (report
 * PDFs, redesign HTML, storyboard CSV/EDL/FCPXML, `fetchArtifact`) silently
 * re-scoped to the admin's own tenant and 404'd on a cross-tenant run.
 */
export function getActiveTenantId(): string {
	return activeTenantId;
}

/**
 * Append the super-admin active-tenant scope-switch to an SSE URL.
 *
 * `fetch` calls carry the switch as the `X-Active-Tenant-Id` header (see
 * `request()` below), but `EventSource` cannot set request headers — so the
 * header-less SSE streams (`/api/runs/{id}/events`, `/api/projects/{id}/events`)
 * would silently drop the switch and get re-scoped to the admin's own tenant,
 * 404-ing a cross-tenant run/project. Carry it as the `active_tenant` query param
 * instead — the only channel `EventSource` can vary. The orchestrator's SSE
 * routes read it (super_admin-gated, identical to the header). No-op when no
 * tenant is switched, so non-admin sessions get a clean URL.
 */
export function withActiveTenant(url: string): string {
	if (!activeTenantId) return url;
	const sep = url.includes('?') ? '&' : '?';
	return `${url}${sep}active_tenant=${encodeURIComponent(activeTenantId)}`;
}

// Matches any absolute URL carrying a scheme (`https:`, `blob:`, `data:`,
// `mailto:`) — deliberately the generic RFC-3986 scheme grammar rather than a
// http/https allow-list, because the thing we must never touch is "anything
// that is not a same-origin path into OUR api".
const HAS_URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Scope a URL that the BROWSER will fetch (not us) to the super-admin's
 * active tenant.
 *
 * `request()` can set `X-Active-Tenant-Id` because it owns the fetch. But
 * `<img src>`, `<video src>`, `<audio src>`, `<iframe src>` and `<a download>`
 * are browser-initiated: the browser builds those requests itself and there is
 * no API to attach a custom header to them. So a super_admin browsing another
 * tenant's run got the JSON (headered fetch → correct tenant) but a 404 on
 * every single artifact behind it — the orchestrator resolved the admin's OWN
 * tenant for the header-less media request. Same root cause as the SSE gap
 * above, same remedy: carry the switch in the `active_tenant` query param,
 * which browser-initiated requests CAN vary. The four browser-direct
 * orchestrator routes accept it (super_admin-gated, identical to the header).
 *
 * The guards, in order, and why each one is load-bearing:
 *  - Falsy / non-string input passes straight through, so call sites can hand
 *    us an optional field (`clip.audio_url`) without a ternary at every one of
 *    the ~30 adoption sites.
 *  - No switch active ⇒ return the SAME REFERENCE, not a rebuilt-but-equal
 *    string. The own-tenant path (i.e. every non-admin session, i.e. almost all
 *    traffic) must be byte-identical to before this helper existed; returning
 *    the input itself makes that impossible to regress and makes it cheap in a
 *    reactive `$derived`.
 *  - Only same-origin `/api/…` paths are rewritten. Scraped source images,
 *    YouTube embeds, live external site previews, and `blob:` / `data:` URLs
 *    minted client-side would either leak our tenant id to a third party or
 *    simply break (`blob:…?active_tenant=x` does not resolve). Anything with a
 *    URI scheme or a protocol-relative `//` prefix is refused outright.
 *  - Idempotent: components re-render (and re-derive) freely, so a URL that
 *    already carries `active_tenant=` is returned untouched rather than
 *    accumulating `?active_tenant=a&active_tenant=a&…`.
 */
export function scopedMediaUrl(url: string | null | undefined): string | null | undefined {
	if (!url || typeof url !== 'string') return url;
	if (!activeTenantId) return url;
	if (!url.startsWith('/api/')) return url;
	if (url.startsWith('//') || HAS_URI_SCHEME.test(url)) return url;
	if (url.includes('active_tenant=')) return url;
	return withActiveTenant(url);
}

/** The orchestrator's same-origin image proxy for third-party thumbnails. */
export const MEDIA_THUMB_PROXY_PATH = '/api/media/thumb';

/**
 * The `<img src>` for a thumbnail that may live on a THIRD-PARTY host (stock
 * media search results, pinned media refs).
 *
 * The SPA's CSP is `img-src 'self' data: blob:`, so an external `https://…`
 * thumbnail is blocked by the browser outright — the Find-media grid rendered a
 * wall of broken images with their alt text overflowing every card. Widening
 * the CSP to arbitrary image hosts is not the fix (it would let an injected
 * `<img>` beacon anywhere); instead every external URL is fetched through
 * `GET /api/media/thumb?url=<encoded>`, which is same-origin, cookie-authed and
 * returns the image bytes.
 *
 *  - Falsy input passes through unchanged (optional fields at call sites).
 *  - `http(s):` and protocol-relative `//` URLs → the proxy, then the active
 *    tenant switch is applied exactly like any other browser-fetched `/api/`
 *    URL (via `scopedMediaUrl`).
 *  - Everything else (`/api/…` paths, `data:`, `blob:`) is already allowed by
 *    the CSP and goes through `scopedMediaUrl` unchanged — never proxied, which
 *    would break `blob:` and double-hop our own artifacts.
 */
export function thumbnailSrc(url: string | null | undefined): string | null | undefined {
	if (!url || typeof url !== 'string') return url;
	const external = url.startsWith('//') || /^https?:/i.test(url);
	if (!external) return scopedMediaUrl(url);
	const absolute = url.startsWith('//') ? `https:${url}` : url;
	return scopedMediaUrl(`${MEDIA_THUMB_PROXY_PATH}?url=${encodeURIComponent(absolute)}`);
}

// `setAuthToken()` / `clearAuthToken()` used to live here as empty no-op bodies
// "retained so existing callers compile". They are gone: `Authorization` is read
// fresh from Keycloak per request (see `request()` below) and is never stored, so
// there was never any token for them to set or clear — `logout()` in ./auth.ts was
// calling a function that did nothing. The real session teardown is
// `clearUser()` in $lib/stores/auth.svelte.ts (DELETE /auth/cookie → clear the
// in-memory caches → `keycloak.logout()`), which is unaffected.
//
// `setDefaultHeader()` / `removeDefaultHeader()` / `getLicenseToken()` are gone for
// the same reason: no non-test caller. With no setter, `defaultHeaders` could only
// ever be empty, so it went too.

// No 401 → keycloak.login() auto-redirect. Three reasons it was harmful:
//  1. Fresh unauth visit: page load() functions fire /api/* before the user
//     sees the layout; an auto-redirect yanks them to Keycloak without the
//     layout's "Sign in" UI ever appearing.
//  2. Token rejected by backend (license/ext-authz denial): auth IS valid
//     from Keycloak's perspective, so redirect → Keycloak returns immediately
//     with a new token → backend rejects again → redirect loop. Observed
//     in prod as "URL blinking 10x/sec" — a ~100ms Keycloak round-trip.
//  3. Real session expiry is already handled by the updateToken() refresh
//     poll in keycloak.ts, which fires login() exactly once on failure.
//
// So: 401s now just throw ApiError. Pages see the error via their
// +error.svelte (pipelines/+error.svelte is already wired with the
// ErrorBoundary component). The user gets a "Something went wrong" card
// with a Retry button instead of an invisible loop.

// Per-request timeout defaults. ``timeoutMs`` is the wall-clock limit
// after which the AbortController is fired; callers can override via the
// ``RequestInit`` extension or pass an existing ``signal`` to chain into
// route-navigation cancellation. Without this guard a hung backend (or a
// large upload over a slow link) stalls the SPA's request queue and the
// UI shows a perpetual loading spinner.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Render ONE FastAPI validation entry as a sentence a human can act on.
 *
 * A 422 `detail` is a LIST of `{loc, msg, type}` objects, not a string. Passing
 * that list into `ApiError`'s message template stringified it as `[object
 * Object]` — the single most useless thing a form can tell an operator, and
 * exactly what a tester saw. `loc` is dropped of its leading `body`/`query`
 * envelope segment because "body.filename" names our wire shape, not their
 * field.
 */
function formatValidationEntry(entry: unknown): string {
	if (typeof entry === 'string') return entry;
	if (!entry || typeof entry !== 'object') return '';
	const rec = entry as Record<string, unknown>;
	const msg =
		typeof rec.msg === 'string' ? rec.msg : typeof rec.message === 'string' ? rec.message : '';
	const loc = Array.isArray(rec.loc)
		? rec.loc
				.filter((part) => part !== 'body' && part !== 'query')
				.map(String)
				.join('.')
		: '';
	if (loc && msg) return `${loc}: ${msg}`;
	return msg || loc || '';
}

/**
 * Reduce an error body to ONE readable string.
 *
 * Order matters: the canonical fleet envelope `{ error: { message } }` first,
 * then legacy `{ detail }` — which may be a string (hand-raised HTTPException)
 * OR a list (FastAPI's own request validation). The final `JSON.stringify` is
 * the last resort it always was; what changed is that the shapes which used to
 * REACH it — an array, a `{msg}` object — are now rendered instead of being
 * handed to a template that turns them into `[object Object]`.
 */
export function detailFromBody(body: unknown, fallback: string): string {
	if (typeof body === 'string') return body || fallback;
	if (!body || typeof body !== 'object') return fallback;
	const rec = body as Record<string, unknown>;

	const envelope = rec.error;
	if (envelope && typeof envelope === 'object') {
		const message = (envelope as Record<string, unknown>).message;
		if (typeof message === 'string' && message) return message;
	}

	const detail = rec.detail;
	if (typeof detail === 'string' && detail) return detail;
	if (Array.isArray(detail)) {
		const parts = detail.map(formatValidationEntry).filter(Boolean);
		if (parts.length > 0) return parts.join('; ');
	}
	if (detail && typeof detail === 'object') {
		const rendered = formatValidationEntry(detail);
		if (rendered) return rendered;
	}
	if (typeof envelope === 'string' && envelope) return envelope;

	try {
		const json = JSON.stringify(body);
		return json && json !== '{}' ? json : fallback;
	} catch {
		return fallback;
	}
}

export function codeFromBody(body: unknown): string | undefined {
	if (!body || typeof body !== 'object') return undefined;
	const rec = body as Record<string, unknown>;
	const envelope = rec.error;
	if (envelope && typeof envelope === 'object') {
		const code = (envelope as Record<string, unknown>).code;
		if (typeof code === 'string') return code;
	}
	if (typeof envelope === 'string') return envelope;
	return typeof rec.code === 'string' ? rec.code : undefined;
}

/**
 * The structured detail OBJECT of an error body: the canonical envelope's
 * `error.details`, else a bare FastAPI `{ detail: {...} }` object (e.g.
 * `HTTPException(402, detail={code: 'byo_provider_required', ...})` reaching us
 * without the envelope). A string or list `detail` is not structured.
 */
export function detailsFromBody(body: unknown): Record<string, unknown> | undefined {
	if (!body || typeof body !== 'object') return undefined;
	const rec = body as Record<string, unknown>;
	const isObject = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const envelope = rec.error;
	if (isObject(envelope)) {
		return isObject(envelope.details) ? envelope.details : undefined;
	}
	return isObject(rec.detail) ? rec.detail : undefined;
}

/** The orchestrator's error code for a tenant it will not serve. */
export const TENANT_NOT_FOUND = 'TENANT_NOT_FOUND';

/**
 * Is this error the backend refusing our ACTIVE tenant choice (the stored
 * `X-Active-Tenant-Id`)? The tenancy middleware answers a non-switchable
 * (unknown / suspended / deleted) active tenant with 404 `TENANT_NOT_FOUND` and
 * `details.active_tenant` naming it — that detail is the ONLY proof. Routes
 * also return a detail-less `TENANT_NOT_FOUND` for a perfectly switchable
 * tenant (PUT /tenant/defaults, POST /tenant/music, POST /tenant/offboarding
 * on a project-only tenant with no registry row; /admin/tenants/{id}/… about a
 * TARGET tenant): that is data, and dropping the choice there would bounce a
 * super_admin out of a tenant they may act in. The one exception is
 * `/auth/me` itself: an orchestrator predating the detail 404'd it only for a
 * refused active tenant, and healing that is what keeps roles visible.
 */
export function isActiveTenantRefusal(
	status: number,
	errorCode: string | undefined,
	path: string,
	errorDetails?: Record<string, unknown>
): boolean {
	if (!activeTenantId) return false;
	if (status !== 404 && status !== 403) return false;
	if (errorCode !== TENANT_NOT_FOUND) return false;
	const named = errorDetails?.active_tenant;
	if (typeof named === 'string') return named === activeTenantId;
	return path.startsWith('/auth/me');
}

/**
 * A request (other than the `/auth/me` bootstrap, which `fetchUser` heals in
 * place) was refused because the active tenant is gone: drop the stored choice
 * — for a super_admin too — and land on home with a notice, instead of leaving
 * an empty shell that 404s forever. Dynamic import: the switcher store imports
 * this module.
 */
function maybeDropRefusedActiveTenant(
	status: number,
	errorCode: string | undefined,
	path: string,
	errorDetails?: Record<string, unknown>
): void {
	if (path.startsWith('/auth/me')) return;
	if (!isActiveTenantRefusal(status, errorCode, path, errorDetails)) return;
	const refused = activeTenantId;
	void import('$lib/stores/tenant-switcher.svelte.js').then(({ tenantSwitcher }) => {
		if (!tenantSwitcher.dropRefused(refused)) return;
		tenantSwitcher.flagRefusedNotice();
		if (typeof window !== 'undefined') window.location.assign('/');
	});
}

/**
 * License-gate interceptor (gate-OFF today; forward-looking). A 402, or a 403
 * whose error code indicates the workspace's license is required/expired or
 * that the tenant is not onboarded to w2v (`TENANT_NOT_ONBOARDED`),
 * hard-blocks the SPA immediately via the licenseGate store — instead of
 * surfacing a raw error toast. The status/me endpoints are exempt so the block
 * screen can still resolve the precise reason without looping. Dynamic import
 * avoids a static client⇄licenseGate cycle.
 */
function maybeTripLicenseGate(
	status: number,
	errorCode: string | undefined,
	path: string,
	errorDetails?: Record<string, unknown>
): void {
	// A 402 `byo_provider_required` is NOT a licence problem: the tenant is licensed
	// and must configure its own provider. Blocking the whole SPA would hide the
	// one screen that can fix it — the caller renders the BYO notice instead.
	if (status === 402 && parseByoProviderRequired(errorDetails)) return;
	const codeStr = typeof errorCode === 'string' ? errorCode.toLowerCase() : '';
	const isLicenseRequired =
		status === 402 ||
		(status === 403 &&
			(codeStr.includes('license_required') ||
				codeStr.includes('license') ||
				errorCode === TENANT_NOT_ONBOARDED));
	// `/admin/tenants/{id}/…` answers about the TARGET tenant, not the caller: a
	// super_admin reading a tenant another app owns gets 403 TENANT_NOT_ONBOARDED as
	// data. Tripping the gate there unmounted the tenants page, `/license/status`
	// cleared it, the page remounted and re-fetched — a reload loop (~8/s).
	const isGateExemptPath =
		path.startsWith('/license/status') ||
		path.startsWith('/auth/me') ||
		path.startsWith('/admin/tenants/');
	if (isLicenseRequired && !isGateExemptPath) {
		void import('$lib/stores/licenseGate.svelte').then(({ licenseGate }) =>
			licenseGate.handleForbidden()
		);
	}
}

/**
 * The per-request auth/tenant headers, built fresh (see `request()` for why each
 * one is read at request time rather than cached). Shared with the
 * XMLHttpRequest transport below so the two surfaces cannot drift: an upload
 * that silently lost `X-Active-Tenant-Id` would 404 for a super_admin acting on
 * another tenant, and nothing in the UI would say why.
 */
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
	const token = await ensureFreshToken(30);
	const authHeader: Record<string, string> =
		token && !BYPASS_TOKEN_SENTINELS.has(token) ? { Authorization: `Bearer ${token}` } : {};
	const tenantValue = tenantHeader();
	const tenantHdr: Record<string, string> = tenantValue ? { 'X-Tenant-Id': tenantValue } : {};
	const activeHdr: Record<string, string> = activeTenantId
		? { 'X-Active-Tenant-Id': activeTenantId }
		: {};
	return { ...tenantHdr, ...activeHdr, ...extra, ...authHeader };
}

/** `(loaded, total)` in BYTES, fired as the request body goes out. */
export type UploadProgressHandler = (loaded: number, total: number) => void;

/**
 * The upload twin of `request()`, backed by `XMLHttpRequest`.
 *
 * WHY a second transport exists at all: `fetch` emits no upload-progress event.
 * A 134 MB clip therefore showed an empty bar for its entire transfer, which is
 * indistinguishable from a hang — the operator's only signal that anything was
 * happening was the tab not being idle. `XMLHttpRequest.upload.onprogress` is
 * the only PORTABLE way to get those bytes; `fetch` with a `ReadableStream` body
 * needs `duplex: 'half'` + HTTP/2 and is Chromium-only, so it would leave
 * Safari/Firefox on the same blank bar.
 *
 * It deliberately mirrors `request()` rather than sharing its body: the same
 * headers (auth read fresh, tenant, active-tenant), the same `timeoutMs`
 * semantics (a wall-clock deadline defaulting to the UPLOAD default, since every
 * caller here is `raw`), the same caller-signal chaining, the same `ApiError`
 * shape with the same detail extraction, and the same empty-body handling.
 * Anything that diverges is a bug, not a variant.
 */
async function xhrRequest<T>(
	method: 'PUT' | 'POST',
	path: string,
	body: XMLHttpRequestBodyInit,
	opts?: {
		contentType?: string;
		timeoutMs?: number;
		signal?: AbortSignal;
		onUploadProgress?: UploadProgressHandler;
	}
): Promise<T> {
	await ensureAuthReady();
	// `raw` by construction: no JSON Content-Type is ever added. A FormData body
	// must have NO Content-Type set at all, or the browser cannot append its
	// multipart boundary.
	const headers = await authHeaders(opts?.contentType ? { 'Content-Type': opts.contentType } : {});
	const deadline = opts?.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
	const external = opts?.signal;

	return new Promise<T>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(method, `/api${path}`, true);
		for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

		let settled = false;
		// Function declarations, not arrows: `settle` and `onExternalAbort` reference
		// each other and the timer below, and hoisting is what lets the three be
		// written in the order that reads correctly rather than the order the
		// initialisers happen to allow.
		function settle(run: () => void) {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			external?.removeEventListener('abort', onExternalAbort);
			run();
		}
		function fail(reason: unknown) {
			settle(() => reject(reason));
		}
		function onExternalAbort() {
			// Mirror fetch: aborting rejects with the caller's abort REASON when it is
			// an Error, so `putVideoSourcePart` can re-throw the cancel the operator
			// actually asked for instead of a synthesised one.
			const reason = external?.reason;
			fail(reason instanceof Error ? reason : new Error('The upload was cancelled.'));
			xhr.abort();
		}

		const timeoutHandle = setTimeout(() => {
			// Same sentinel `request()` aborts with, so the retry classifier upstream
			// cannot tell the two transports apart.
			fail(new Error('request_timeout'));
			xhr.abort();
		}, deadline);

		// Checked AFTER the timer exists so `settle`'s `clearTimeout` is never
		// reached with an unassigned binding; an already-fired signal settles and
		// returns without ever putting a body on the wire.
		if (external?.aborted) {
			onExternalAbort();
			return;
		}
		external?.addEventListener('abort', onExternalAbort);

		if (opts?.onUploadProgress) {
			const report = opts.onUploadProgress;
			xhr.upload?.addEventListener('progress', (event: ProgressEvent) => {
				if (event.lengthComputable) report(event.loaded, event.total);
			});
		}

		// A transport failure has no status. `fetch` throws TypeError here, and
		// `isRetryablePartError` keys "no status ⇒ retry" off exactly that.
		xhr.addEventListener('error', () => fail(new TypeError('Failed to fetch')));
		xhr.addEventListener('abort', () => fail(new Error('The upload was cancelled.')));
		xhr.addEventListener('load', () => {
			const status = xhr.status;
			const statusText = xhr.statusText || '';
			const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
			if (status < 200 || status >= 300) {
				let detail = statusText;
				let errorCode: string | undefined;
				let errorDetails: Record<string, unknown> | undefined;
				let errorBody: unknown;
				try {
					const parsed: unknown = JSON.parse(text);
					errorBody = parsed;
					detail = detailFromBody(parsed, statusText);
					errorCode = codeFromBody(parsed);
					errorDetails = detailsFromBody(parsed);
				} catch {
					// Non-JSON error body (an edge's HTML 413 page); keep statusText.
				}
				maybeTripLicenseGate(status, errorCode, path, errorDetails);
				maybeDropRefusedActiveTenant(status, errorCode, path, errorDetails);
				fail(
					new ApiError(
						status,
						statusText,
						detail,
						errorCode,
						errorDetails,
						parseRetryAfter(xhr.getResponseHeader?.('Retry-After')),
						errorBody
					)
				);
				return;
			}
			if (status === 204 || status === 205 || !text) {
				settle(() => resolve(undefined as T));
				return;
			}
			try {
				const parsed = JSON.parse(text) as T;
				settle(() => resolve(parsed));
			} catch (err) {
				fail(err);
			}
		});

		xhr.send(body);
	});
}

async function request<T>(
	path: string,
	init?: RequestInit & {
		raw?: boolean;
		timeoutMs?: number;
		skipAuthGate?: boolean;
		/** Called with the SUCCESSFUL response's headers before the body is parsed —
		 *  for the few lists that carry metadata in a header (`X-Total-Count`)
		 *  while their body stays a bare array. */
		onHeaders?: (headers: Headers) => void;
	}
): Promise<T> {
	const { raw, timeoutMs, skipAuthGate, onHeaders, ...fetchInit } = init ?? {};

	// Block until Keycloak has finished initializing before reading
	// keycloak.token. Without this gate, a +page.ts:load() that runs in
	// parallel with +layout.ts:load() (SvelteKit's default — pages don't
	// inherit their parent's await unless they call `await parent()`) reads
	// keycloak.token while it's still undefined, fires the fetch with no
	// Authorization header → 401.
	//
	// `skipAuthGate` is the single deliberate opt-out: the bootstrap
	// `/auth/me` call is made *inside* initAuth(), so awaiting ensureAuthReady()
	// (which returns initAuth's own in-flight promise) would deadlock. Every
	// other caller — including page loads that fire while init is still
	// running — must await, otherwise they race init and fire token-less.
	if (!skipAuthGate) {
		await ensureAuthReady();
	}

	// Refresh the Keycloak token AT REQUEST TIME — keycloak.token is only
	// kept current by a 10s polling interval that the browser suspends on
	// backgrounded tabs, so a tab refocused after long inactivity would
	// otherwise send a stale JWT until the next tick. ensureFreshToken
	// triggers updateToken(30) so any token expiring in the next 30s is
	// rotated before being attached. On refresh failure it redirects to
	// Keycloak and returns undefined — the request fires anonymously, gets
	// a 401, and the user lands on the fresh page after the redirect.
	// Omit Authorization for the dev/e2e bypass sentinels: they're not real JWTs,
	// so the backend 401s on them even with a valid X-Tenant-Id license — which
	// killed every client-side poll/SSE call and froze the run-status badge (the
	// post-promote E2E then timed out). Bypass requests rely on the X-Tenant-Id
	// license path (the SSR proxy fills it from the license_token cookie), exactly
	// like the server-side loader. X-Tenant-Id / X-Active-Tenant-Id are likewise
	// built at request time — see `authHeaders`. Keycloak token wins: callers
	// cannot override Authorization.
	const headers: Record<string, string> = await authHeaders({
		...(!raw ? { 'Content-Type': 'application/json' } : {}),
		...(fetchInit.headers as Record<string, string>)
	});

	// Compose an AbortController so the request hangs on a wall-clock
	// deadline rather than the browser's default (no client deadline,
	// browser-tab navigation only). Chains any caller-provided signal so
	// route-navigation aborts propagate through.
	const deadline = timeoutMs ?? (raw ? DEFAULT_UPLOAD_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS);
	const controller = new AbortController();
	const externalSignal = fetchInit.signal;
	if (externalSignal) {
		if (externalSignal.aborted) controller.abort(externalSignal.reason);
		else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
	}
	const timeoutHandle = setTimeout(() => controller.abort(new Error('request_timeout')), deadline);

	let response: Response;
	try {
		response = await fetch(`/api${path}`, {
			...fetchInit,
			headers,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeoutHandle);
	}

	if (!response.ok) {
		let detail = response.statusText;
		let errorCode: string | undefined;
		let errorDetails: Record<string, unknown> | undefined;
		let errorBody: unknown;
		try {
			// Canonical fleet error envelope is `{ error: { message, ... } }`, with a
			// legacy `{ detail }` fallback. `detail` is NOT always a string: FastAPI's
			// own 422 makes it a LIST of `{loc, msg}` objects, which the old
			// `body?.detail ?? JSON.stringify(body)` handed straight to ApiError's
			// message template as `[object Object]`. See `detailFromBody`.
			const body: unknown = await response.json();
			errorBody = body;
			detail = detailFromBody(body, response.statusText);
			errorCode = codeFromBody(body);
			errorDetails = detailsFromBody(body);
		} catch {
			// keep default
		}

		maybeTripLicenseGate(response.status, errorCode, path, errorDetails);
		maybeDropRefusedActiveTenant(response.status, errorCode, path, errorDetails);

		throw new ApiError(
			response.status,
			response.statusText,
			detail,
			errorCode,
			errorDetails,
			parseRetryAfter(response.headers?.get?.('Retry-After')),
			errorBody
		);
	}

	if (onHeaders && response.headers) onHeaders(response.headers);

	// 204 No Content / 205 Reset Content have no body. Calling response.json()
	// on them throws SyntaxError ("Unexpected end of JSON input"), which the
	// FE was silently surfacing as a generic mutation failure for several
	// endpoints (DELETE /annotations/{id}, DELETE /verbatim-items/{id},
	// PATCH /projects/{id}/children/reorder, ...). Treat empty bodies as
	// `undefined` and let void-typed callers be happy.
	if (response.status === 204 || response.status === 205) {
		return undefined as T;
	}
	return response.json() as Promise<T>;
}

// Bootstrap GET that skips the auth-ready gate. ONLY for the `/auth/me` call
// made inside initAuth() — every other caller must use `api.get` so it waits
// for auth init to finish before firing (otherwise it races init and sends no
// Authorization header). See `request()`'s `skipAuthGate` note.
export function bootstrapGet<T>(path: string): Promise<T> {
	return request<T>(path, { skipAuthGate: true });
}

export const api = {
	/** `signal` lets a caller cancel a GET that is still in flight when its owner
	 *  is torn down. `request()` chains it into its own deadline controller, so a
	 *  teardown abort and the wall-clock timeout compose rather than compete. The
	 *  safety-net run poll needs this: without it a 30s GET issued just before
	 *  `disconnect()` keeps a socket (and its response body) alive on a page the
	 *  operator has already left. */
	get<T>(
		path: string,
		opts?: { signal?: AbortSignal; onHeaders?: (headers: Headers) => void }
	): Promise<T> {
		return request<T>(path, { signal: opts?.signal, onHeaders: opts?.onHeaders });
	},
	/** `timeoutMs` overrides the 30s JSON default. It exists because a JSON POST
	 *  is not automatically a *short* POST: the chunked video-source `complete`
	 *  route carries a tiny body but makes the pod compose N staged objects,
	 *  download the whole clip and ffprobe it — work proportional to a file that
	 *  may be 512 MiB. At the default that call aborted client-side while the
	 *  server went on to succeed, and the operator was told their upload failed.
	 *  See `videoCompleteTimeoutMs` in `uploads.ts`. */
	post<T>(
		path: string,
		data?: unknown,
		opts?: { idempotencyKey?: string; timeoutMs?: number; signal?: AbortSignal }
	): Promise<T> {
		// An Idempotency-Key lets a client safely retry a create after a lost
		// response: the orchestrator replays the original 2xx (tenant-scoped)
		// instead of creating a duplicate. The proxy forwards the header verbatim.
		const headers = opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined;
		return request<T>(path, {
			method: 'POST',
			body: data ? JSON.stringify(data) : undefined,
			headers,
			timeoutMs: opts?.timeoutMs,
			signal: opts?.signal
		});
	},
	/** ``timeoutMs`` exists for uploads whose size makes the 120s default wrong.
	 *  A 512 MiB clip (the video-source cap) needs ~36 Mbps SUSTAINED to finish
	 *  inside the default, which no ordinary connection holds — the abort then
	 *  surfaces as a failed file rather than as "your link is slow", blaming a
	 *  clip that was never the problem. Callers sizing a timeout from the
	 *  payload is the only honest way to tell those two apart. */
	postForm<T>(path: string, data: FormData, timeoutMs?: number): Promise<T> {
		return request<T>(path, {
			method: 'POST',
			body: data,
			raw: true,
			timeoutMs
		});
	},
	/**
	 * `postForm` over the XMLHttpRequest transport, so the caller can watch the
	 * body go out and can cancel it.
	 *
	 * Separate from `postForm` rather than a flag on it because the other five
	 * multipart uploaders (manuscript, document, package, voiceover, storyboard
	 * asset) are all small, single-round-trip files with no progress UI — moving
	 * them to a second transport would buy them nothing and put every one of them
	 * behind a code path only the video uploader exercises.
	 */
	postFormProgress<T>(
		path: string,
		data: FormData,
		opts?: {
			timeoutMs?: number;
			signal?: AbortSignal;
			onUploadProgress?: UploadProgressHandler;
		}
	): Promise<T> {
		return xhrRequest<T>('POST', path, data, opts);
	},
	put<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, {
			method: 'PUT',
			body: data ? JSON.stringify(data) : undefined
		});
	},
	/**
	 * PUT a RAW body — a Blob/ArrayBuffer sent as-is, with no JSON encoding and no
	 * multipart envelope.
	 *
	 * The chunked video-source part route takes `application/octet-stream`, not
	 * multipart: a multipart wrapper would add a boundary preamble to every part
	 * and force the pod to re-parse a body it already knows the shape of. `api.put`
	 * cannot serve it (it JSON-stringifies) and `postForm` is the wrong verb and
	 * the wrong encoding, so this is its own helper rather than a flag on either.
	 *
	 * Runs on the `XMLHttpRequest` transport, NOT `fetch`: this is the only route
	 * whose body is large enough that the operator needs to see it move, and
	 * `fetch` emits no upload-progress event (see `xhrRequest`). Everything else
	 * about it — headers, the size-scaled `timeoutMs`, caller-signal chaining, the
	 * `ApiError` it throws — is identical to `request()`'s raw path.
	 */
	putRaw<T>(
		path: string,
		body: XMLHttpRequestBodyInit,
		opts?: {
			contentType?: string;
			timeoutMs?: number;
			signal?: AbortSignal;
			onUploadProgress?: UploadProgressHandler;
		}
	): Promise<T> {
		return xhrRequest<T>('PUT', path, body, {
			...opts,
			contentType: opts?.contentType ?? 'application/octet-stream'
		});
	},
	patch<T>(path: string, data?: unknown): Promise<T> {
		return request<T>(path, {
			method: 'PATCH',
			body: data ? JSON.stringify(data) : undefined
		});
	},
	delete<T>(path: string): Promise<T> {
		return request<T>(path, { method: 'DELETE' });
	}
};
