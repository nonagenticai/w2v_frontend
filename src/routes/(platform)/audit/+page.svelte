<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Platform audit-log screen (super_admin only). Lists deliberate admin actions
	// recorded by the orchestrator (GET /api/admin/audit, orchestrator#248):
	// tenant rename/suspend and super-admin scope switches. Gated by the
	// (platform) group layout. Newest-first, paginated, filterable by action +
	// target tenant. Tenant UUIDs are resolved to names via the tenants registry.
	import { admin, type AdminAuditEntry, type AdminTenantSummary } from '$lib/api';
	import {
		Card,
		Skeleton,
		ErrorState,
		EmptyState,
		Pill,
		Pagination,
		Select
	} from '$lib/components/ui';
	import { formatDateTime, shortId } from '$lib/utils/format';
	import { tenantLabel } from '$lib/utils/tenant-label';
	import {
		AUDIT_ACTION_LABELS,
		TENANT_AUDIT_ACTIONS,
		auditActionLabel
	} from '$lib/api/tenant-audit.js';

	const PAGE_SIZE = 50;

	let events = $state<AdminAuditEntry[]>([]);
	let total = $state(0);
	let page = $state(1);
	let error = $state<unknown>(null);
	let loading = $state(true);

	// Filters.
	let actionFilter = $state('');
	let tenantFilter = $state('');

	// Tenant registry → id→name map for label resolution + the tenant filter.
	let tenants = $state<AdminTenantSummary[]>([]);
	const tenantNames = $derived(new Map(tenants.map((t) => [t.tenant_id, t.name])));

	function nameOf(id: string | null | undefined): string {
		if (!id) return '—';
		return tenantNames.get(id) ?? id;
	}

	async function load(): Promise<void> {
		loading = true;
		error = null;
		const offset = (page - 1) * PAGE_SIZE;
		try {
			const res = await admin.auditLog({
				limit: PAGE_SIZE,
				offset,
				action: actionFilter || undefined,
				tenantId: tenantFilter || undefined
			});
			events = res.items;
			total = res.total;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	// Reading page/actionFilter/tenantFilter synchronously at the top of load()
	// makes this effect re-run (and refetch) on any of them changing.
	$effect(() => {
		void load();
	});

	// Load the tenant registry once (for names + the filter dropdown). Degrades to
	// UUID labels + a tenant-less filter on failure.
	$effect(() => {
		admin
			.tenants()
			.then((res) => {
				tenants = res.items;
			})
			.catch(() => {
				/* degrade to UUIDs */
			});
	});

	const actionOptions = [
		{ value: '', label: 'All actions' },
		...TENANT_AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))
	];
	const tenantOptions = $derived([
		{ value: '', label: 'All tenants' },
		...tenants.map((t) => ({ value: t.tenant_id, label: tenantLabel(t) }))
	]);

	function onActionFilter(e: Event): void {
		actionFilter = (e.target as HTMLSelectElement).value;
		page = 1; // a narrower result set must start at the first page
	}
	function onTenantFilter(e: Event): void {
		tenantFilter = (e.target as HTMLSelectElement).value;
		page = 1;
	}

	const toneFor = (action: string): 'accent' | 'warning' | 'neutral' =>
		action === 'tenant.update' ? 'accent' : action === 'scope.switch' ? 'warning' : 'neutral';

	function summarize(entry: AdminAuditEntry): string {
		const d = entry.detail ?? {};
		if (entry.action === 'scope.switch') {
			const from = typeof d.from_tenant === 'string' ? d.from_tenant : null;
			return `acting as ${nameOf(entry.target_tenant_id)} (from ${nameOf(from)})`;
		}
		if (entry.action === 'scope.reset') {
			return 'reset to own tenant';
		}
		// tenant.update: diff name/status before → after.
		const before = (d.before ?? null) as { name?: string | null; status?: string } | null;
		const after = (d.after ?? null) as { name?: string | null; status?: string } | null;
		if (!after) return nameOf(entry.target_tenant_id);
		const parts: string[] = [];
		if ((before?.name ?? null) !== (after.name ?? null)) {
			parts.push(`name "${before?.name ?? '—'}" → "${after.name ?? '—'}"`);
		}
		if ((before?.status ?? null) !== (after.status ?? null)) {
			parts.push(`status ${before?.status ?? '—'} → ${after.status ?? '—'}`);
		}
		const what = parts.length ? parts.join('; ') : 'no change';
		return `${nameOf(entry.target_tenant_id)}: ${what}`;
	}
</script>

<Page width="narrow" testid="audit-home">
	<PageHeader
		kicker="Platform"
		title="Platform audit log"
		subtitle="Deliberate admin actions across all tenants."
	>
		{#snippet actions()}
			{#if !loading && !error}
				<Pill tone="neutral">{total} {total === 1 ? 'event' : 'events'}</Pill>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="mb-4 flex flex-wrap items-center gap-2" data-testid="audit-filters">
		<div data-testid="filter-action" class="min-w-[12rem]">
			<Select
				name="audit-action"
				value={actionFilter}
				options={actionOptions}
				placeholder=""
				onchange={onActionFilter}
			/>
		</div>
		<div data-testid="filter-tenant" class="min-w-[14rem]">
			<Select
				name="audit-tenant"
				value={tenantFilter}
				options={tenantOptions}
				placeholder=""
				onchange={onTenantFilter}
			/>
		</div>
	</div>

	{#if loading}
		<div data-testid="audit-loading">
			<Card class="p-2">
				<Skeleton variant="text" count={6} height="2.25rem" />
			</Card>
		</div>
	{:else if error}
		<ErrorState title="Couldn't load the audit log" {error} onRetry={load} />
	{:else if events.length === 0}
		<EmptyState
			title="No admin activity yet"
			description="Tenant changes and scope switches by admins appear here. Try clearing the filters."
		/>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="audit-list">
				{#each events as entry (entry.id)}
					<li class="flex items-start justify-between gap-4 p-4" data-testid="audit-row">
						<div class="min-w-0">
							<p class="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
								<Pill tone={toneFor(entry.action)}>{auditActionLabel(entry.action)}</Pill>
								<span class="font-mono text-xs text-[var(--color-text-muted)]"
									>{shortId(entry.actor_subject_id, 'system')}</span
								>
							</p>
							<p class="mt-1 truncate text-xs text-[var(--color-text-muted)]">
								{summarize(entry)}
							</p>
						</div>
						<p class="shrink-0 text-xs text-[var(--color-text-muted)]">
							{formatDateTime(entry.created_at) || '—'}
						</p>
					</li>
				{/each}
			</ul>
		</Card>
		<Pagination {page} pageSize={PAGE_SIZE} {total} onPageChange={(p) => (page = p)} class="mt-4" />
	{/if}
</Page>
