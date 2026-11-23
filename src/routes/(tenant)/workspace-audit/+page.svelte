<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Workspace audit log (P6 FE-2) — GET /api/tenant/audit, tenant_admin only.
	// (`/audit` is the super_admin cross-tenant log; this is the tenant's own view.)
	// Rows whose target is this workspace, newest first, keyset paged ("Load older"
	// follows `next_cursor`). A member actor is named by email; anyone else — a
	// platform operator acting into the workspace — is shown as "platform operator"
	// with no identity, exactly as the API returns it.
	import { onMount } from 'svelte';
	import { ApiError } from '$lib/api/client.js';
	import {
		tenantAudit,
		auditDetailSummary,
		TENANT_AUDIT_ACTIONS,
		AUDIT_ACTION_LABELS,
		auditActionLabel,
		type TenantAuditRow,
		type TenantAuditActionName,
		type AuditActorKind
	} from '$lib/api/tenant-audit.js';
	import {
		Button,
		Card,
		EmptyState,
		ErrorState,
		Select,
		Skeleton,
		Spinner
	} from '$lib/components/ui';

	const PAGE_SIZE = 50;

	let items = $state<TenantAuditRow[]>([]);
	let cursor = $state<string | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<unknown>(null);
	/** The API's reason for a failed page load (shown, never swallowed). */
	const loadErrorText = $derived(
		error instanceof ApiError
			? error.detail || error.message
			: error instanceof Error
				? error.message
				: ''
	);
	let action = $state<'' | TenantAuditActionName>('');
	let actorKind = $state<'' | AuditActorKind>('');
	const filtered = $derived(action !== '' || actorKind !== '');
	function clearFilters(): void {
		action = '';
		actorKind = '';
		void load();
	}

	async function load(more = false): Promise<void> {
		if (more) loadingMore = true;
		else loading = true;
		error = null;
		try {
			const page = await tenantAudit.list({
				limit: PAGE_SIZE,
				cursor: more ? cursor : null,
				action: action || null,
				actorKind: actorKind || null
			});
			items = more ? [...items, ...page.items] : page.items;
			cursor = page.next_cursor ?? null;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
			loadingMore = false;
		}
	}
	onMount(() => void load());

	const actionOptions = [
		{ value: '', label: 'All actions' },
		...TENANT_AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))
	];
	const actorOptions = [
		{ value: '', label: 'Everyone' },
		{ value: 'member', label: 'Members' },
		{ value: 'platform_operator', label: 'Platform operator' }
	];
</script>

<Page width="narrow" testid="workspace-audit">
	<PageHeader
		kicker="Workspace"
		title="Workspace audit log"
		subtitle="Admin changes made to this workspace, newest first."
	>
		{#snippet actions()}
			<div class="flex gap-2">
				<div class="min-w-[11rem]" data-testid="audit-action-filter">
					<Select
						name="audit-action"
						value={action}
						options={actionOptions}
						placeholder=""
						onchange={(e) => {
							action = (e.currentTarget as HTMLSelectElement).value as '' | TenantAuditActionName;
							void load();
						}}
					/>
				</div>
				<div class="min-w-[10rem]" data-testid="audit-actor-filter">
					<Select
						name="audit-actor"
						value={actorKind}
						options={actorOptions}
						placeholder=""
						onchange={(e) => {
							actorKind = (e.currentTarget as HTMLSelectElement).value as '' | AuditActorKind;
							void load();
						}}
					/>
				</div>
			</div>
		{/snippet}
	</PageHeader>

	{#if loading}
		<Card class="p-5"><Skeleton height="4rem" /></Card>
	{:else if error && items.length === 0}
		<ErrorState title="Couldn't load the audit log" {error} onRetry={() => void load()} />
	{:else if items.length === 0}
		<EmptyState
			title="No audit entries"
			description={filtered
				? 'Nothing matches these filters.'
				: 'Admin changes to this workspace (members, keys, providers, settings) appear here.'}
		>
			{#snippet action()}
				{#if filtered}
					<Button variant="secondary" onclick={clearFilters}>Clear filters</Button>
				{:else}
					<Button variant="secondary" href="/members">Manage members</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<Card class="p-0">
			<ul class="divide-y divide-[var(--color-border)]" data-testid="audit-rows">
				{#each items as row (row.id)}
					<li class="px-5 py-3" data-testid="audit-row">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="text-sm text-[var(--color-text)]" title={row.action}>
								{auditActionLabel(row.action)}
							</span>
							<time class="text-xs text-[var(--color-text-muted)]" datetime={row.created_at}>
								{new Date(row.created_at).toLocaleString()}
							</time>
						</div>
						<div class="mt-0.5 text-xs text-[var(--color-text-muted)]" data-testid="audit-actor">
							{#if row.actor_kind === 'platform_operator'}
								by platform operator
							{:else}
								by {row.actor_label ?? row.actor_subject_id ?? 'a member'}
							{/if}
						</div>
						{#if row.detail && Object.keys(row.detail).length}
							<p class="mt-1 break-words font-mono text-xs text-[var(--color-text-secondary)]">
								{auditDetailSummary(row.detail)}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		</Card>
		{#if error}
			<p class="mt-3 text-sm text-status-failed" data-testid="audit-load-more-error">
				Couldn't load more entries{loadErrorText ? `: ${loadErrorText}` : '.'}
			</p>
		{/if}
		{#if cursor}
			<div class="mt-4 flex justify-center">
				<Button variant="secondary" size="sm" onclick={() => load(true)} disabled={loadingMore}>
					{#if loadingMore}<span class="mr-1.5 inline-block"><Spinner size="sm" /></span>{/if}
					Load older
				</Button>
			</div>
		{/if}
	{/if}
</Page>
