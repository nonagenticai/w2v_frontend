<script lang="ts">
	// Invite acceptance — the landing page of the one-time link a workspace admin
	// sends (`/invite/accept?token=…`).
	//
	// The token is parked in sessionStorage first and scrubbed from the address
	// bar: a Keycloak login round-trip may drop the query, and a token left in the
	// URL ends up in history and Referer headers. The root layout has already made
	// sure the user is signed in (it renders nothing but the login prompt
	// otherwise), so by the time this mounts we can POST /api/invites/accept.
	//
	// Error codes come from the orchestrator's tenancy envelope:
	//   403 INVITE_EMAIL_MISMATCH — signed in as someone else
	//   403 EMAIL_NOT_VERIFIED    — Keycloak email not verified yet
	//   410 INVITE_GONE           — expired / revoked / membership since ended
	//   404 INVITE_NOT_FOUND      — not a valid link
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ApiError } from '$lib/api/client.js';
	import { tenancy, tenancyErrorMessage } from '$lib/api/tenancy.js';
	import { clearUser, fetchUser, getUser, isSuperAdmin } from '$lib/stores/auth.svelte.js';
	import { tenantSwitcher } from '$lib/stores/tenant-switcher.svelte.js';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Button, Card, Spinner } from '$lib/components/ui';

	const TOKEN_KEY = 'w2v_invite_token';

	type View =
		| { kind: 'working' }
		| { kind: 'missing' }
		| { kind: 'error'; code: string | undefined; status: number; message: string };

	let view = $state<View>({ kind: 'working' });
	const email = $derived(getUser()?.email ?? null);

	function readStored(): string | null {
		try {
			return sessionStorage.getItem(TOKEN_KEY);
		} catch {
			return null;
		}
	}
	function store(token: string | null): void {
		try {
			if (token) sessionStorage.setItem(TOKEN_KEY, token);
			else sessionStorage.removeItem(TOKEN_KEY);
		} catch {
			/* private mode — the in-memory token still works for this attempt */
		}
	}

	let current: string | null = null;

	async function accept(token: string): Promise<void> {
		current = token;
		view = { kind: 'working' };
		try {
			const res = await tenancy.acceptInvite(token);
			store(null);
			// Act in the workspace just joined, and refresh role/memberships. Only
			// where the backend honours `X-Active-Tenant-Id`: claim mode reports
			// `role: null` and ignores it for non-super callers, so persisting it
			// there would just be a stale header.
			if (isSuperAdmin() || getUser()?.role != null) tenantSwitcher.setActive(res.tenant_id);
			await fetchUser();
			toastSuccess(
				res.already_member ? 'Already a member' : 'Workspace joined',
				`You're in ${res.tenant_name ?? 'the workspace'}.`
			);
			await goto(resolve('/'), { replaceState: true });
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 0;
			const code = err instanceof ApiError ? err.code : undefined;
			// A dead link stays dead, and a 403 (wrong account / unverified email)
			// must not leave a live token parked in sessionStorage for whoever signs
			// in next: forget it. "Try again" on this page retries the in-memory copy.
			if (status === 403 || status === 404 || status === 410) store(null);
			view = {
				kind: 'error',
				status,
				code,
				message: tenancyErrorMessage(err, 'Could not accept this invite. Try again.')
			};
		}
	}

	onMount(() => {
		const fromUrl = $page.url.searchParams.get('token');
		if (fromUrl) {
			store(fromUrl);
			// The token is the only query this route takes, so the scrubbed URL is
			// just the bare route.
			try {
				replaceState(resolve('/invite/accept'), {});
			} catch {
				/* router not ready (tests) — the scrub is hygiene, not correctness */
			}
		}
		const token = fromUrl ?? readStored();
		if (!token) {
			view = { kind: 'missing' };
			return;
		}
		void accept(token);
	});

	function retry(): void {
		const token = current ?? readStored();
		if (token) void accept(token);
		else view = { kind: 'missing' };
	}

	const errorTitle = $derived.by(() => {
		if (view.kind !== 'error') return '';
		if (view.status === 410) return 'This invite is no longer valid';
		if (view.status === 403) return "This invite can't be accepted by this account";
		if (view.status === 404) return 'Invite not found';
		return 'Something went wrong';
	});
</script>

<main class="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
	<div class="w-full max-w-md" data-testid="invite-accept">
		<Card class="p-6">
			{#if view.kind === 'working'}
				<div class="flex items-center gap-3" data-testid="invite-accept-working">
					<Spinner />
					<p class="text-sm text-[var(--color-text)]">Joining the workspace…</p>
				</div>
			{:else if view.kind === 'missing'}
				<div data-testid="invite-accept-missing">
					<h1 class="text-xl font-semibold text-[var(--color-text)]">No invite link</h1>
					<p class="mt-3 text-sm text-[var(--color-text-muted)]">
						Open the invite link from your email again. If it has expired, ask a workspace admin to
						resend it.
					</p>
				</div>
			{:else}
				<div data-testid="invite-accept-error" data-code={view.code ?? ''}>
					<h1 class="text-xl font-semibold text-[var(--color-text)]">{errorTitle}</h1>
					<p
						class="mt-3 text-sm text-[var(--color-text-muted)]"
						data-testid="invite-accept-message"
					>
						{view.message}
					</p>
					{#if view.code === 'INVITE_EMAIL_MISMATCH' && email}
						<p class="mt-2 text-sm text-[var(--color-text-muted)]">
							You're signed in as <strong class="text-[var(--color-text)]">{email}</strong>.
						</p>
					{/if}
					<div class="mt-6 flex justify-end gap-2">
						{#if view.status === 403}
							<Button variant="ghost" size="sm" onclick={() => void clearUser()}>
								Sign out and switch account
							</Button>
							<Button variant="primary" size="sm" onclick={retry}>Try again</Button>
						{:else if view.status === 0 || view.status >= 500}
							<Button variant="primary" size="sm" onclick={retry}>Try again</Button>
						{:else}
							<Button variant="primary" size="sm" href={resolve('/')}>Go to the app</Button>
						{/if}
					</div>
				</div>
			{/if}
		</Card>
	</div>
</main>
