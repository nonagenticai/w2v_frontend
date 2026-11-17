// What a saved sign-in secret is approved for — the SAME rule as the orchestrator's
// `auth_secrets._login_binding` / `context_origin`. The server keeps a saved
// password across every brief edit EXCEPT a change to this binding, where it drops
// the password and flags the login `needs_reentry`. Mirroring the rule lets the
// Brief page say "re-enter the password" the moment the user makes such a change,
// before saving; after a save the server's flag is the source of truth.

/** Login fields that are secrets (orchestrator `SECRET_FIELDS`). */
const SECRET_FIELDS = new Set([
	'password',
	'token',
	'access_token',
	'refresh_token',
	'client_secret',
	'api_key',
	'secret',
	'authorization',
	'headers',
	'cookie_header',
	'cookies',
	'cookie'
]);
/** Server-set flag, not part of what the secret is approved for. */
export const NEEDS_REENTRY = 'needs_reentry';
/** The dict keys a login is bound to when it names no origin of its own. */
const BOUND_URL_KEYS = ['target_url', 'source_url', 'url', 'ref'] as const;

function origin(raw: unknown): string | null {
	if (typeof raw !== 'string' || !raw.startsWith('https://')) return null;
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

/** The ONE site a login-carrying dict binds it to, else null (none or ambiguous). */
export function contextOrigin(context: Record<string, unknown>): string | null {
	const origins = new Set(
		BOUND_URL_KEYS.map((k) => context[k])
			.filter((v) => v)
			.map(origin)
	);
	return origins.size === 1 ? ([...origins][0] ?? null) : null;
}

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value as Record<string, unknown>)
				.sort()
				.map((k) => [k, stable((value as Record<string, unknown>)[k])])
		);
	}
	return value;
}

/** The login minus its secrets and the server flag, plus the site it is bound to. */
export function loginBinding(
	login: Record<string, unknown>,
	context: Record<string, unknown>
): string {
	const shape = Object.fromEntries(
		Object.entries(login).filter(([k]) => !SECRET_FIELDS.has(k) && k !== NEEDS_REENTRY)
	);
	return JSON.stringify([stable(shape), contextOrigin(context)]);
}

export type LoginChange = 'address' | 'username' | 'site' | 'settings';

/** Which part of the binding changed (for the message), or null when none did. */
export function loginChange(
	before: Record<string, unknown>,
	beforeContext: Record<string, unknown>,
	after: Record<string, unknown>,
	afterContext: Record<string, unknown>
): LoginChange | null {
	if (loginBinding(before, beforeContext) === loginBinding(after, afterContext)) return null;
	if ((before.login_url ?? '') !== (after.login_url ?? '')) return 'address';
	if ((before.username ?? '') !== (after.username ?? '')) return 'username';
	if ((before.signs_into ?? '') !== (after.signs_into ?? '')) return 'site';
	if (contextOrigin(beforeContext) !== contextOrigin(afterContext)) return 'site';
	return 'settings';
}
