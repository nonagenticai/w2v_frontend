// What the account menu calls the signed-in person.
//
// `/auth/me` returns `name = preferred_username`, and on the licence-token /
// trusted-network paths w2v_common mints that as the bare SUBJECT ID — so the
// "name" is a UUID, not a name. Keycloak's getUserInfo() likewise falls back to
// `sub`. Rendering it as-is put "01a0dd02-d324-…" in the header. A candidate
// that is the subject id (or merely UUID-shaped) is a placeholder and is
// skipped in favour of a real name / handle / email; the id itself is shown
// only when nothing else exists.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdentityLike {
	sub?: string | null;
	subject_id?: string | null;
	name?: string | null;
	preferred_username?: string | null;
	email?: string | null;
}

/** True when `value` is an id placeholder rather than something a person chose. */
export function isIdPlaceholder(value: string | null | undefined, user: IdentityLike): boolean {
	const v = value?.trim();
	if (!v) return true;
	return UUID_RE.test(v) || v === user.sub || v === user.subject_id;
}

export interface AccountLabel {
	/** Text for the trigger + menu header. */
	label: string;
	/** True when `label` is a real name/handle/email, not the id fallback. */
	human: boolean;
}

export function accountLabel(user: IdentityLike | null | undefined): AccountLabel {
	if (!user) return { label: 'Account', human: false };
	for (const c of [user.name, user.preferred_username, user.email]) {
		if (!isIdPlaceholder(c, user)) return { label: c!.trim(), human: true };
	}
	const id = user.subject_id?.trim() || user.sub?.trim() || user.name?.trim();
	return id ? { label: id, human: false } : { label: 'Account', human: false };
}

/** Avatar initials: two letters of a real name, else two of the handle/email,
 *  else "?" — never the first hex digit of a UUID. */
export function accountInitials(user: IdentityLike | null | undefined): string {
	if (!user) return '?';
	const name = isIdPlaceholder(user.name, user) ? '' : (user.name ?? '').trim();
	if (name && !name.includes('@')) {
		const parts = name.split(/\s+/);
		const first = parts[0]?.[0] ?? '';
		const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
		return (first + last).toUpperCase();
	}
	const handle = [user.email, user.preferred_username, user.name].find(
		(c) => !isIdPlaceholder(c, user)
	);
	return handle?.trim().slice(0, 2).toUpperCase() || '?';
}
