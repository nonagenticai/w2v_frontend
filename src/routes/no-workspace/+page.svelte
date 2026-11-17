<script lang="ts">
	// Shown when `/auth/me` says the signed-in user belongs to NO workspace
	// (`tenant_id: null`, P2 membership tenancy). Nothing tenant-scoped works
	// until they join one, so explain that plainly, list any invite pending for
	// their verified email (explicit Accept — /auth/me accepts nothing), and offer
	// a re-check.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clearUser, fetchUser, getUser, hasNoWorkspace } from '$lib/stores/auth.svelte.js';
	import { Button, Card } from '$lib/components/ui';
	import PendingInvites from '$lib/components/PendingInvites.svelte';

	const email = $derived(getUser()?.email ?? null);
	let checking = $state(false);
	let stillNone = $state(false);

	/** After an Accept, PendingInvites has refreshed /auth/me — leave if it worked. */
	async function afterAccept(): Promise<void> {
		if (!hasNoWorkspace()) await goto(resolve('/'), { replaceState: true });
	}

	async function checkAgain(): Promise<void> {
		checking = true;
		stillNone = false;
		try {
			await fetchUser();
			if (hasNoWorkspace()) stillNone = true;
			else await goto(resolve('/'), { replaceState: true });
		} finally {
			checking = false;
		}
	}
</script>

<main class="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
	<div class="w-full max-w-md" data-testid="no-workspace">
		<Card class="p-6">
			<h1 class="text-xl font-semibold text-[var(--color-text)]">You're not in a workspace yet</h1>
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				Your sign-in worked, but this account isn't a member of any workspace. Ask an admin of the
				workspace you want to join to invite you{#if email}
					at <strong class="text-[var(--color-text)]">{email}</strong>{/if}. Once the invite is
				sent, open the link in the email — or come back here and check again.
			</p>
			<div class="mt-4" data-testid="no-workspace-invites">
				<PendingInvites onaccepted={afterAccept} />
			</div>
			{#if stillNone}
				<p class="mt-3 text-sm text-[var(--color-danger)]" data-testid="no-workspace-still-none">
					Still no workspace for this account. If you were invited at a different email address,
					sign in with that one.
				</p>
			{/if}
			<div class="mt-6 flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => void clearUser()}>Sign out</Button>
				<Button variant="primary" size="sm" loading={checking} onclick={checkAgain}>
					Check again
				</Button>
			</div>
		</Card>
	</div>
</main>
