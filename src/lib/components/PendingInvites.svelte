<!--
  PendingInvites — lists `/auth/me.pending_invites` (invites addressed to the
  caller's VERIFIED email). `/auth/me` accepts nothing: joining is an explicit
  Accept → POST /api/invites/{id}/accept, then a `/auth/me` refresh so role,
  memberships and the no-workspace signal update. Dismiss is local only — the
  invite stays pending server-side and reappears on the next page load.
  Rendered above the app shell by the root layout and on /no-workspace.
-->
<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { tenancy, tenancyErrorMessage } from '$lib/api/tenancy.js';
	import { fetchUser, getUser } from '$lib/stores/auth.svelte.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Button } from '$lib/components/ui';

	let { onaccepted }: { onaccepted?: () => void | Promise<void> } = $props();

	const dismissed = new SvelteSet<string>();
	let accepting = $state<string | null>(null);

	const invites = $derived(
		(getUser()?.pending_invites ?? []).filter((inv) => !dismissed.has(inv.id))
	);

	function roleLabel(role: string): string {
		return role === 'tenant_admin' ? 'admin' : role;
	}

	async function accept(id: string): Promise<void> {
		accepting = id;
		try {
			const res = await tenancy.acceptInviteById(id);
			await fetchUser();
			toastSuccess(
				res.already_member ? 'Already a member' : 'Workspace joined',
				`You're in ${res.tenant_name ?? 'the workspace'}.`
			);
			await onaccepted?.();
		} catch (err) {
			toastError('Could not accept the invite', tenancyErrorMessage(err));
			// A gone / foreign invite will not become acceptable — refresh the list.
			await fetchUser();
		} finally {
			accepting = null;
		}
	}
</script>

{#if invites.length > 0}
	<ul
		class="flex flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)]"
		data-testid="pending-invites"
	>
		{#each invites as inv (inv.id)}
			<li class="flex items-center justify-between gap-4 px-4 py-2" data-testid="pending-invite">
				<span>
					You've been invited to <strong>{inv.tenant_name ?? 'a workspace'}</strong> as
					{roleLabel(inv.role)}.
				</span>
				<span class="flex items-center gap-2">
					<Button
						variant="primary"
						size="sm"
						loading={accepting === inv.id}
						disabled={accepting !== null}
						onclick={() => void accept(inv.id)}
					>
						Accept
					</Button>
					<Button variant="ghost" size="sm" onclick={() => dismissed.add(inv.id)}>Dismiss</Button>
				</span>
			</li>
		{/each}
	</ul>
{/if}
