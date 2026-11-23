<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Tenant-admin Members (P2 tenancy). Membership is the orchestrator's own
	// `tenant_members` table — role ∈ member | tenant_admin — managed here:
	//   GET/PATCH/DELETE /api/tenant/members[/{subject_id}]
	//   POST/GET /api/tenant/invites, POST …/{id}/resend, DELETE …/{id}
	// The server is the authority on every rule; in particular it refuses to
	// leave a workspace without an admin (409 LAST_TENANT_ADMIN), which this
	// screen surfaces in plain words rather than pre-guessing from one page.
	// Gated by the (tenant) group layout; the server 403s on its own too.
	import {
		tenancy,
		tenancyErrorMessage,
		type Invite,
		type InviteCreated,
		type MemberRole,
		type TenantMember
	} from '$lib/api/tenancy.js';
	import {
		Card,
		Skeleton,
		ErrorState,
		EmptyState,
		Pill,
		Pagination,
		Button,
		Dialog,
		Input,
		Select
	} from '$lib/components/ui';
	import { formatDateTime } from '$lib/utils/format';
	import { getUser } from '$lib/stores/auth.svelte.js';
	import { ApiError } from '$lib/api/client.js';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';

	const PAGE_SIZE = 50;
	const ROLE_OPTIONS = [
		{ value: 'member', label: 'Member' },
		{ value: 'tenant_admin', label: 'Admin' }
	];

	let members = $state<TenantMember[]>([]);
	let total = $state(0);
	let page = $state(1);
	let error = $state<unknown>(null);
	let loading = $state(true);
	let busyId = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	let invites = $state<Invite[]>([]);
	let invitesError = $state<unknown>(null);

	async function load(): Promise<void> {
		loading = true;
		error = null;
		try {
			const res = await tenancy.members({
				status: 'active',
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE
			});
			members = res.items;
			total = res.total;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	async function loadInvites(): Promise<void> {
		invitesError = null;
		try {
			invites = (await tenancy.invites('pending')).items;
		} catch (e) {
			invitesError = e;
		}
	}

	// Reading `page` synchronously in load() makes this refetch on page change.
	$effect(() => {
		void load();
	});
	$effect(() => {
		void loadInvites();
	});

	const selfId = $derived(getUser()?.sub ?? null);
	const isSelf = (m: TenantMember): boolean => selfId !== null && m.subject_id === selfId;
	const primary = (m: TenantMember): string => m.display_name ?? m.email ?? m.subject_id;
	const secondary = (m: TenantMember): string | null =>
		m.display_name ? (m.email ?? m.subject_id) : m.email ? m.subject_id : null;

	// ─── Role change ─────────────────────────────────────────────────────
	// Demoting YOURSELF loses access to this screen — confirm first. Everything
	// else is one step; the server refuses the last-admin case.
	let confirmDemoteOpen = $state(false);
	let pendingDemote = $state<TenantMember | null>(null);

	function onRoleSelect(m: TenantMember, e: Event): void {
		const next = (e.target as HTMLSelectElement).value as MemberRole;
		if (next === m.role) return;
		actionError = null;
		if (isSelf(m) && next === 'member') {
			pendingDemote = m;
			confirmDemoteOpen = true;
			// Snap the select back until confirmed.
			(e.target as HTMLSelectElement).value = m.role;
			return;
		}
		void setRole(m, next);
	}

	async function setRole(m: TenantMember, role: MemberRole): Promise<void> {
		busyId = m.subject_id;
		actionError = null;
		try {
			await tenancy.setMemberRole(m.subject_id, role);
			toastSuccess(
				'Role updated',
				`${primary(m)} is now ${role === 'tenant_admin' ? 'an admin' : 'a member'}.`
			);
		} catch (e) {
			actionError = tenancyErrorMessage(e, 'Role change failed. Try again.');
		} finally {
			busyId = null;
			await load();
		}
	}

	function confirmDemote(): void {
		const m = pendingDemote;
		confirmDemoteOpen = false;
		pendingDemote = null;
		if (m) void setRole(m, 'member');
	}

	// ─── Remove ──────────────────────────────────────────────────────────
	let confirmRemoveOpen = $state(false);
	let pendingRemove = $state<TenantMember | null>(null);

	function requestRemove(m: TenantMember): void {
		actionError = null;
		pendingRemove = m;
		confirmRemoveOpen = true;
	}

	async function confirmRemove(): Promise<void> {
		const m = pendingRemove;
		confirmRemoveOpen = false;
		pendingRemove = null;
		if (!m) return;
		busyId = m.subject_id;
		try {
			await tenancy.removeMember(m.subject_id);
			toastSuccess('Member removed', `${primary(m)} no longer has access to this workspace.`);
			await load();
		} catch (e) {
			actionError = tenancyErrorMessage(e, 'Could not remove the member. Try again.');
		} finally {
			busyId = null;
		}
	}

	// ─── Invites ─────────────────────────────────────────────────────────
	let inviteOpen = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<MemberRole>('member');
	let inviteBusy = $state(false);
	let inviteError = $state<string | null>(null);
	// 409 INVITE_PENDING on create: offer to resend the existing invite instead.
	let pendingConflictId = $state<string | null>(null);
	// The last create/resend whose EMAIL FAILED to send: the invite stands, so the
	// admin gets its one-time link to share by hand plus a Resend. A delivered
	// invite shows no link — the token only belongs in the invitee's mailbox.
	let failedDelivery = $state<{ id: string; email: string; url: string } | null>(null);
	let copied = $state(false);

	const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
	const inviteValid = $derived(EMAIL_RE.test(inviteEmail.trim()));

	function openInvite(): void {
		inviteEmail = '';
		inviteRole = 'member';
		inviteError = null;
		pendingConflictId = null;
		inviteOpen = true;
	}

	/** Toast on delivery, or keep the link + a Resend on screen when the email failed. */
	function afterSend(res: InviteCreated, verb: 'sent' | 'resent'): void {
		copied = false;
		if (res.email_delivery === 'failed') {
			failedDelivery = { id: res.id, email: res.email, url: res.invite_url };
		} else {
			if (failedDelivery?.id === res.id) failedDelivery = null;
			toastSuccess(`Invite ${verb}`, `An invite email was requested for ${res.email}.`);
		}
	}

	async function sendInvite(): Promise<void> {
		if (!inviteValid || inviteBusy) return;
		inviteBusy = true;
		inviteError = null;
		pendingConflictId = null;
		try {
			const res = await tenancy.createInvite(inviteEmail.trim(), inviteRole);
			inviteOpen = false;
			afterSend(res, 'sent');
			await loadInvites();
		} catch (e) {
			const existing =
				e instanceof ApiError && e.code === 'INVITE_PENDING' ? e.details?.invite_id : undefined;
			if (typeof existing === 'string') {
				pendingConflictId = existing;
				inviteError = `${inviteEmail.trim()} is already invited. Resend the invite?`;
			} else {
				inviteError = tenancyErrorMessage(e, 'Could not send the invite. Try again.');
			}
		} finally {
			inviteBusy = false;
		}
	}

	async function resendById(id: string): Promise<void> {
		busyId = id;
		actionError = null;
		try {
			const res = await tenancy.resendInvite(id);
			afterSend(res, 'resent');
		} catch (e) {
			actionError = tenancyErrorMessage(e, 'Could not resend the invite.');
		} finally {
			busyId = null;
			await loadInvites();
		}
	}

	async function resendConflict(): Promise<void> {
		const id = pendingConflictId;
		if (!id) return;
		inviteOpen = false;
		pendingConflictId = null;
		await resendById(id);
	}

	const resend = (inv: Invite): Promise<void> => resendById(inv.id);

	async function revoke(inv: Invite): Promise<void> {
		busyId = inv.id;
		actionError = null;
		try {
			await tenancy.revokeInvite(inv.id);
			if (failedDelivery?.id === inv.id) failedDelivery = null;
			toastSuccess('Invite revoked', `The link sent to ${inv.email} no longer works.`);
		} catch (e) {
			actionError = tenancyErrorMessage(e, 'Could not revoke the invite.');
		} finally {
			busyId = null;
			await loadInvites();
		}
	}

	async function copyLink(): Promise<void> {
		if (!failedDelivery) return;
		try {
			await navigator.clipboard.writeText(failedDelivery.url);
			copied = true;
		} catch {
			/* clipboard unavailable — the link is on screen to select by hand */
		}
	}
</script>

<Page width="narrow" testid="members-home">
	<PageHeader
		kicker="Workspace"
		title="Members"
		subtitle="Who belongs to this workspace, and what they can do."
	>
		{#snippet actions()}
			<div class="flex items-center gap-2">
				{#if !loading && !error}
					<Pill tone="neutral">{total} {total === 1 ? 'member' : 'members'}</Pill>
				{/if}
				<Button variant="primary" onclick={openInvite}>Invite</Button>
			</div>
		{/snippet}
	</PageHeader>

	{#if actionError}
		<p class="mb-3 text-sm text-[var(--color-danger)]" data-testid="members-action-error">
			{actionError}
		</p>
	{/if}

	{#if failedDelivery}
		<div class="mb-4" data-testid="invite-delivery-failed">
			<Card class="p-4">
				<p class="text-sm font-medium text-[var(--color-danger)]">
					Invite created but the email could not be sent
				</p>
				<p class="mt-1 text-sm text-[var(--color-text)]">
					Resend it, or copy the link below and share it with <strong>
						{failedDelivery.email}
					</strong>
					yourself. The link is shown only now.
				</p>
				<div class="mt-2 flex items-center gap-2">
					<code
						class="min-w-0 flex-1 truncate rounded border border-[var(--color-border)] p-2 text-xs"
						data-testid="invite-link"
					>
						{failedDelivery.url}
					</code>
					<Button variant="ghost" size="sm" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</Button>
					<Button
						variant="secondary"
						size="sm"
						loading={busyId === failedDelivery.id}
						onclick={() => failedDelivery && resendById(failedDelivery.id)}
					>
						Resend
					</Button>
					<Button variant="ghost" size="sm" onclick={() => (failedDelivery = null)}>Dismiss</Button>
				</div>
			</Card>
		</div>
	{/if}

	{#if loading}
		<div data-testid="members-loading">
			<Card class="p-2">
				<Skeleton variant="text" count={6} height="2.25rem" />
			</Card>
		</div>
	{:else if error}
		<ErrorState title="Couldn't load members" {error} onRetry={load} />
	{:else if members.length === 0}
		<EmptyState title="No members yet" description="Invite someone to get started.">
			{#snippet action()}
				<Button variant="primary" onclick={openInvite}>Invite</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="members-list">
				{#each members as m (m.subject_id)}
					<li
						class="flex flex-wrap items-center justify-between gap-4 p-4"
						data-testid="members-row"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-[var(--color-text)]">
								{primary(m)}
								{#if isSelf(m)}<span class="text-xs text-[var(--color-text-muted)]">
										(you)
									</span>{/if}
							</p>
							{#if secondary(m)}
								<p class="truncate font-mono text-xs text-[var(--color-text-muted)]">
									{secondary(m)}
								</p>
							{/if}
							<p class="mt-1 text-xs text-[var(--color-text-muted)]">
								Joined {formatDateTime(m.first_seen_at) || '—'} · last seen {formatDateTime(
									m.last_seen_at
								) || '—'}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2" data-testid="members-role-action">
							<Select
								name={`role-${m.subject_id}`}
								value={m.role}
								options={ROLE_OPTIONS}
								placeholder=""
								disabled={busyId === m.subject_id}
								onchange={(e: Event) => onRoleSelect(m, e)}
								class="min-w-[8rem]"
							/>
							<Button
								variant="ghost"
								size="sm"
								loading={busyId === m.subject_id}
								onclick={() => requestRemove(m)}
							>
								{isSelf(m) ? 'Leave' : 'Remove'}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		</Card>
		<Pagination {page} pageSize={PAGE_SIZE} {total} onPageChange={(p) => (page = p)} class="mt-4" />
	{/if}

	<h2
		class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
	>
		Pending invites
	</h2>
	{#if invitesError}
		<ErrorState title="Couldn't load invites" error={invitesError} onRetry={loadInvites} />
	{:else if invites.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="invites-empty">
			No pending invites.
		</p>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="invites-list">
				{#each invites as inv (inv.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 p-4"
						data-testid="invites-row"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-[var(--color-text)]">{inv.email}</p>
							<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
								{inv.role === 'tenant_admin' ? 'Admin' : 'Member'} · expires {formatDateTime(
									inv.expires_at
								) || '—'}
							</p>
						</div>
						<div class="flex shrink-0 gap-2">
							<Button
								variant="secondary"
								size="sm"
								loading={busyId === inv.id}
								onclick={() => resend(inv)}
							>
								Resend
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={busyId === inv.id}
								onclick={() => revoke(inv)}
							>
								Revoke
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</Page>

<Dialog bind:open={inviteOpen} title="Invite someone">
	{#if inviteOpen}
		<form
			class="flex flex-col gap-4"
			data-testid="invite-form"
			onsubmit={(e) => {
				e.preventDefault();
				void sendInvite();
			}}
		>
			<Input
				name="invite-email"
				label="Email"
				type="email"
				placeholder="person@example.com"
				bind:value={inviteEmail}
			/>
			<Select
				name="invite-role"
				label="Role"
				value={inviteRole}
				options={ROLE_OPTIONS}
				placeholder=""
				onchange={(e: Event) => (inviteRole = (e.target as HTMLSelectElement).value as MemberRole)}
			/>
			{#if inviteError}
				<p class="text-sm text-[var(--color-danger)]" data-testid="invite-error">{inviteError}</p>
			{/if}
			{#if pendingConflictId}
				<div class="flex justify-end">
					<Button variant="secondary" size="sm" onclick={resendConflict}>Resend invite</Button>
				</div>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (inviteOpen = false)}>Cancel</Button>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					loading={inviteBusy}
					disabled={!inviteValid}
				>
					Send invite
				</Button>
			</div>
		</form>
	{/if}
</Dialog>

<!-- Dialog bodies are gated on their target so no confirm testid exists until pending. -->
<Dialog bind:open={confirmDemoteOpen} title="Remove your own admin role?">
	{#if pendingDemote}
		<div class="flex flex-col gap-4" data-testid="members-self-demote-confirm">
			<p class="text-sm text-[var(--color-text)]">
				You will immediately lose access to Members and API keys, and you can't give the role back
				to yourself — another admin has to.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmDemoteOpen = false)}>
					Cancel
				</Button>
				<Button variant="danger" size="sm" onclick={confirmDemote}>Make me a member</Button>
			</div>
		</div>
	{/if}
</Dialog>

<Dialog bind:open={confirmRemoveOpen} title="Remove from workspace?">
	{#if pendingRemove}
		<div class="flex flex-col gap-4" data-testid="members-remove-confirm">
			<p class="text-sm text-[var(--color-text)]">
				{#if isSelf(pendingRemove)}
					You will lose access to this workspace. Someone will have to invite you again.
				{:else}
					<strong>{primary(pendingRemove)}</strong> will lose access to this workspace immediately.
				{/if}
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (confirmRemoveOpen = false)}>
					Cancel
				</Button>
				<Button variant="danger" size="sm" onclick={confirmRemove}>Remove</Button>
			</div>
		</div>
	{/if}
</Dialog>
