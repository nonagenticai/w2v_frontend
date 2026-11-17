<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Platform request-audit screen (super_admin only). Lists the middleware-wide
	// per-request security audit (GET /api/admin/request-audit, orchestrator#264):
	// one row per mutation, auth failure (401/403), or cross-tenant access. Gated
	// by the (platform) group layout. Newest-first, paginated, filterable by event
	// class, HTTP method, and cross-tenant access. Distinct from the Audit Log
	// (/audit), which records only deliberate admin actions.
	import { admin, type RequestAuditEntry, type AdminTenantSummary } from '$lib/api';
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

	const PAGE_SIZE = 50;

	let events = $state<RequestAuditEntry[]>([]);
	let total = $state(0);
	let page = $state(1);
	let error = $state<unknown>(null);
	let loading = $state(true);

	// Filters.
	let eventFilter = $state('');
	let methodFilter = $state('');
	let crossTenantFilter = $state(''); // '' all | 'true' cross-tenant only

	// Tenant registry → id→name map so rows show human labels, matching the
	// sibling /audit screen. Degrades to the raw UUID when unresolved.
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
			const res = await admin.requestAudit({
				limit: PAGE_SIZE,
				offset,
				event: eventFilter || undefined,
				method: methodFilter || undefined,
				crossTenant: crossTenantFilter === 'true' ? true : undefined
			});
			events = res.items;
			total = res.total;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	// Reading the filters synchronously at the top of load() makes this effect
	// re-run (and refetch) whenever any of them — or page — changes.
	$effect(() => {
		void load();
	});

	// Load the tenant registry once for id→name resolution. Degrades to UUIDs on
	// failure (mirrors the /audit screen).
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

	const eventOptions = [
		{ value: '', label: 'All events' },
		{ value: 'mutation', label: 'Mutations' },
		{ value: 'auth_failure', label: 'Auth failures' },
		{ value: 'read', label: 'Reads' }
	];
	const methodOptions = [
		{ value: '', label: 'All methods' },
		{ value: 'GET', label: 'GET' },
		{ value: 'POST', label: 'POST' },
		{ value: 'PATCH', label: 'PATCH' },
		{ value: 'PUT', label: 'PUT' },
		{ value: 'DELETE', label: 'DELETE' }
	];
	const crossTenantOptions = [
		{ value: '', label: 'All access' },
		{ value: 'true', label: 'Cross-tenant only' }
	];

	function onEventFilter(e: Event): void {
		eventFilter = (e.target as HTMLSelectElement).value;
		page = 1; // a narrower result set must start at the first page
	}
	function onMethodFilter(e: Event): void {
		methodFilter = (e.target as HTMLSelectElement).value;
		page = 1;
	}
	function onCrossTenantFilter(e: Event): void {
		crossTenantFilter = (e.target as HTMLSelectElement).value;
		page = 1;
	}

	const toneFor = (event: string): 'danger' | 'accent' | 'neutral' =>
		event === 'auth_failure' ? 'danger' : event === 'mutation' ? 'accent' : 'neutral';

	const statusTone = (status: number): 'danger' | 'warning' | 'success' | 'neutral' =>
		status >= 500 ? 'danger' : status >= 400 ? 'warning' : status >= 200 ? 'success' : 'neutral';
</script>

<Page width="narrow" testid="request-audit-home">
	<PageHeader
		kicker="Platform"
		title="Request audit log"
		subtitle="Per-request security log: mutations, auth failures, and cross-tenant access."
	>
		{#snippet actions()}
			{#if !loading && !error}
				<Pill tone="neutral">{total} {total === 1 ? 'event' : 'events'}</Pill>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="mb-4 flex flex-wrap items-center gap-2" data-testid="request-audit-filters">
		<div data-testid="filter-event" class="min-w-[11rem]">
			<Select
				name="ra-event"
				value={eventFilter}
				options={eventOptions}
				placeholder=""
				onchange={onEventFilter}
			/>
		</div>
		<div data-testid="filter-method" class="min-w-[10rem]">
			<Select
				name="ra-method"
				value={methodFilter}
				options={methodOptions}
				placeholder=""
				onchange={onMethodFilter}
			/>
		</div>
		<div data-testid="filter-cross-tenant" class="min-w-[12rem]">
			<Select
				name="ra-cross-tenant"
				value={crossTenantFilter}
				options={crossTenantOptions}
				placeholder=""
				onchange={onCrossTenantFilter}
			/>
		</div>
	</div>

	{#if loading}
		<div data-testid="request-audit-loading">
			<Card class="p-2">
				<Skeleton variant="text" count={6} height="2.25rem" />
			</Card>
		</div>
	{:else if error}
		<ErrorState title="Couldn't load the request audit" {error} onRetry={load} />
	{:else if events.length === 0}
		<EmptyState
			title="No matching requests"
			description="Mutations, auth failures, and cross-tenant access appear here. Try clearing the filters."
		/>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="request-audit-list">
				{#each events as entry (entry.id)}
					<li class="flex items-start justify-between gap-4 p-4" data-testid="request-audit-row">
						<div class="min-w-0">
							<p
								class="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]"
							>
								<Pill tone={toneFor(entry.event)}>{entry.event}</Pill>
								{#if entry.cross_tenant}
									<Pill tone="warning">cross-tenant</Pill>
								{/if}
								<Pill tone={statusTone(entry.status_code)}>{entry.status_code}</Pill>
							</p>
							<p class="mt-1 truncate font-mono text-xs text-[var(--color-text-muted)]">
								{entry.method}
								{entry.path}
							</p>
							<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
								actor {shortId(entry.actor_subject_id)} · tenant {nameOf(entry.effective_tenant_id)}
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
