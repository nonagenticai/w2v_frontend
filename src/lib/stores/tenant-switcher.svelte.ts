// Tenant switcher (Svelte 5 runes). Holds the workspace the caller is currently
// acting in — any of their memberships (P2) or, for a super_admin, any
// switchable tenant — and persists it to localStorage so the choice survives
// reloads. The selected id is mirrored onto the API client as `setActiveTenantId`
// so every request carries `X-Active-Tenant-Id` and the orchestrator re-scopes
// the whole app (see src/lib/api/client.ts). `null` ⇒ acting as the caller's own
// tenant (no header). P2 membership mode: the backend REFUSES a requested
// tenant the caller is not a member of (403 NO_MEMBERSHIP) instead of silently
// serving another one, so a stale value is dropped by `reconcile()` once
// `/auth/me` reports the caller's memberships.

import { setActiveTenantId } from '$lib/api/client.js';

const STORAGE_KEY = 'w2v_active_tenant';
/** One-shot "your workspace choice was dropped" flag that survives the reload. */
const NOTICE_KEY = 'w2v_active_tenant_notice';

/** What the user is told when a refused workspace choice is dropped. */
export const REFUSED_TENANT_NOTICE = {
	title: 'Workspace unavailable',
	description:
		'The workspace you were acting in is suspended or no longer exists. You are back in your own workspace.'
} as const;

function loadActiveTenant(): string | null {
	// Defensive: SSR has no localStorage, and a browser in private mode (or a
	// test env with a stubbed Storage) can throw on access. Fall back to null.
	try {
		return localStorage?.getItem(STORAGE_KEY) || null;
	} catch {
		return null;
	}
}

class TenantSwitcherStore {
	activeTenantId = $state<string | null>(loadActiveTenant());

	constructor() {
		// Hydrate the API client header from persisted state at module load, so
		// requests fired before the switcher component mounts are already scoped.
		setActiveTenantId(this.activeTenantId);
	}

	/**
	 * Drop the active tenant if it is not one of `memberTenantIds` (the caller's
	 * active memberships). Returns true when it dropped one, so the caller can
	 * re-resolve. Never call this for a super_admin — they may act anywhere.
	 */
	reconcile(memberTenantIds: readonly string[]): boolean {
		if (!this.activeTenantId || memberTenantIds.includes(this.activeTenantId)) return false;
		this.setActive(null);
		return true;
	}

	/**
	 * The backend REFUSED the active tenant (unknown, suspended or deleted —
	 * `/auth/me.active_tenant_refused`, or a 404 `TENANT_NOT_FOUND` naming it).
	 * Drop it for EVERY caller, super_admin included: a super_admin may act into
	 * any SWITCHABLE tenant, but a refused one is never served, and keeping it
	 * pinned every request to a 404 (an empty shell that never self-heals).
	 * `refusedId` null/undefined = the refusal named no tenant; drop whatever is
	 * active. Returns true when it dropped one.
	 */
	dropRefused(refusedId?: string | null): boolean {
		if (!this.activeTenantId) return false;
		if (refusedId && refusedId !== this.activeTenantId) return false;
		this.setActive(null);
		return true;
	}

	/** Remember to tell the user after the reload that follows a mid-session drop. */
	flagRefusedNotice(): void {
		try {
			sessionStorage?.setItem(NOTICE_KEY, '1');
		} catch {
			// best-effort
		}
	}

	/** True once if a mid-session drop is waiting to be announced. */
	consumeRefusedNotice(): boolean {
		try {
			if (sessionStorage?.getItem(NOTICE_KEY) !== '1') return false;
			sessionStorage.removeItem(NOTICE_KEY);
			return true;
		} catch {
			return false;
		}
	}

	/** Switch into `id` (or back to own tenant with null). Persists + updates the client header. */
	setActive(id: string | null): void {
		this.activeTenantId = id;
		setActiveTenantId(id);
		try {
			if (id) localStorage?.setItem(STORAGE_KEY, id);
			else localStorage?.removeItem(STORAGE_KEY);
		} catch {
			// Persistence is best-effort; the in-memory + client header still apply.
		}
	}
}

export const tenantSwitcher = new TenantSwitcherStore();
