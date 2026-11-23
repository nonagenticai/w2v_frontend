<script lang="ts">
	import { tenantLabel } from '$lib/utils/tenant-label';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Platform tenants screen (super_admin only). Lists every known tenant via
	// GET /api/admin/tenants (registry ∪ project-tenants) and lets a super_admin
	// rename a tenant + toggle its status (PATCH /api/admin/tenants/{id},
	// orchestrator#247). Gated by the (platform) group layout.
	// Also: the platform YouTube channel panel and a per-tenant tri-state
	// "may use the platform YouTube channel" (PUT /api/admin/tenants/{id}/youtube).
	// Also: the offboarding queue (P6 ORCH-6) and per-tenant Export / two-step
	// Delete (plan → typed confirm token → DELETE /api/admin/tenants/{id}).
	import { admin, type AdminTenantSummary } from '$lib/api';
	import { youtube, type YouTubeAdminTenantSettings } from '$lib/api/youtube.js';
	import YouTubePlatformChannelPanel from '$lib/components/providers/YouTubePlatformChannelPanel.svelte';
	import {
		allowedFromPlatformPolicy,
		platformPolicyFromAllowed,
		type PlatformChannelPolicy
	} from '$lib/utils/youtube-status';
	import {
		Card,
		Skeleton,
		ErrorState,
		EmptyState,
		Pill,
		Button,
		Dialog,
		Input,
		Select
	} from '$lib/components/ui';
	import { formatDateTime } from '$lib/utils/format';
	import { formatCost } from '$lib/utils/cost';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { adminOffboarding, offboardingError } from '$lib/api/tenant-offboarding.js';
	import OffboardingQueue from '$lib/components/offboarding/OffboardingQueue.svelte';
	import TenantDeleteDialog from '$lib/components/offboarding/TenantDeleteDialog.svelte';
	import type { LlmAccessMode } from '$lib/api/providers.js';
	import {
		LLM_ACCESS_LABELS,
		isLlmAccessMode,
		llmAccessErrorMessage,
		isTenantNotOnboarded
	} from '$lib/components/providers/llm-access.js';
	import LlmAccessSelect from '$lib/components/providers/LlmAccessSelect.svelte';

	let tenants = $state<AdminTenantSummary[]>([]);

	function knownCost(v: number | null | undefined): number | null {
		return typeof v === 'number' && Number.isFinite(v) ? v : null;
	}
	let total = $state(0);
	let error = $state<unknown>(null);
	let loading = $state(true);

	// Search + sort. /admin/tenants returns the FULL list (un-paginated), so
	// filtering/sorting client-side is correct — there's no other page to mislead.
	let searchInput = $state('');
	let sortKey = $state('activity:desc');

	const sortOptions = [
		{ value: 'activity:desc', label: 'Recent activity' },
		{ value: 'name:asc', label: 'Name (A–Z)' },
		{ value: 'cost:desc', label: 'Cost (high→low)' },
		{ value: 'runs:desc', label: 'Runs (high→low)' },
		{ value: 'status:asc', label: 'Status' }
	];

	function onSortChange(e: Event): void {
		sortKey = (e.target as HTMLSelectElement).value;
	}

	const visibleTenants = $derived.by(() => {
		const q = searchInput.trim().toLowerCase();
		const filtered = q
			? tenants.filter(
					(t) =>
						(t.name?.toLowerCase().includes(q) ?? false) || t.tenant_id.toLowerCase().includes(q)
				)
			: tenants;
		const [field, order] = sortKey.split(':');
		const dir = order === 'asc' ? 1 : -1;
		const activityMs = (t: AdminTenantSummary): number =>
			t.last_activity ? Date.parse(t.last_activity) : 0;
		return [...filtered].sort((a, b) => {
			switch (field) {
				case 'name':
					return dir * (a.name ?? a.tenant_id).localeCompare(b.name ?? b.tenant_id);
				case 'cost': {
					// An unknown cost is not $0: it sorts last in either direction.
					const ka = knownCost(a.total_cost_usd);
					const kb = knownCost(b.total_cost_usd);
					if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
					return dir * (ka - kb);
				}
				case 'runs':
					return dir * ((a.run_count ?? 0) - (b.run_count ?? 0));
				case 'status':
					return dir * (a.status ?? 'active').localeCompare(b.status ?? 'active');
				default:
					return dir * (activityMs(a) - activityMs(b));
			}
		});
	});

	// Rename dialog + status-toggle state.
	let renameOpen = $state(false);
	let renameTarget = $state<AdminTenantSummary | null>(null);
	let renameValue = $state('');
	let saving = $state(false);
	let busyId = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	// Per-tenant platform-channel policy, from GET /api/admin/youtube/tenants
	// (merged by tenant_id). A tenant ABSENT from that list follows the default
	// (null). Only when the list itself could not be read is the policy unknown —
	// then the select shows the placeholder, never a guessed "Default".
	const policyOptions = [
		{ value: 'default', label: 'Default' },
		{ value: 'allow', label: 'Allow' },
		{ value: 'deny', label: 'Deny' }
	];
	let ytByTenant = $state<Record<string, YouTubeAdminTenantSettings>>({});
	let ytLoaded = $state(false);
	let ytLoadError = $state<string | null>(null);
	let ytBusy = $state<Record<string, boolean>>({});

	const ytRow = (t: AdminTenantSummary): YouTubeAdminTenantSettings | undefined =>
		ytByTenant[t.tenant_id];

	const policyValue = (t: AdminTenantSummary): string =>
		ytLoaded ? platformPolicyFromAllowed(ytRow(t)?.platform_channel_allowed ?? null) : '';

	async function loadYouTubeTenants(): Promise<void> {
		ytLoadError = null;
		try {
			const rows = await youtube.adminTenantSettings();
			ytByTenant = Object.fromEntries((rows ?? []).map((r) => [r.tenant_id, r]));
			ytLoaded = true;
		} catch (e) {
			ytByTenant = {};
			ytLoaded = false;
			ytLoadError = describe(e, "Couldn't load the tenants' YouTube settings.");
		}
	}

	async function setYouTubePolicy(tenant: AdminTenantSummary, e: Event): Promise<void> {
		const select = e.target as HTMLSelectElement;
		const option = policyOptions.find((o) => o.value === select.value);
		if (!option) return;
		const allowed = allowedFromPlatformPolicy(option.value as PlatformChannelPolicy);
		const id = tenant.tenant_id;
		ytBusy = { ...ytBusy, [id]: true };
		actionError = null;
		try {
			await youtube.setTenantPlatformChannelAllowed(id, allowed);
			const prev = ytByTenant[id];
			ytByTenant = {
				...ytByTenant,
				[id]: {
					tenant_id: id,
					has_grant: prev?.has_grant ?? false,
					has_oauth_client: prev?.has_oauth_client ?? false,
					platform_channel_allowed: allowed
				}
			};
			toastSuccess('Platform YouTube channel', `${tenantLabel(tenant)}: ${option.label}`);
		} catch (err) {
			// Put the control back to what the server still holds.
			select.value = policyValue(tenant);
			actionError = describe(err, 'Updating the YouTube policy failed. Try again.');
		} finally {
			const next = { ...ytBusy };
			delete next[id];
			ytBusy = next;
		}
	}

	// Per-tenant Service access (GET/PUT /api/admin/tenants/{id}/llm-access). A tenant
	// whose mode could not be read shows the "Unknown" placeholder plus the reason —
	// never a guessed default.
	let llmByTenant = $state<Record<string, LlmAccessMode>>({});
	let llmErrors = $state<Record<string, string>>({});
	let llmSaved = $state<Record<string, boolean>>({});
	let llmBusy = $state<Record<string, boolean>>({});
	// Tenants another app owns (licences 403 tenant_not_accessible → TENANT_NOT_ONBOARDED):
	// w2v cannot read or set their Service access, so they get a note, not a selector.
	let llmForeign = $state<Record<string, boolean>>({});

	function without<T>(rec: Record<string, T>, id: string): Record<string, T> {
		const next = { ...rec };
		delete next[id];
		return next;
	}

	async function loadLlmAccess(ids: string[]): Promise<void> {
		const results = await Promise.allSettled(ids.map(async (id) => admin.tenantLlmAccess(id)));
		const modes: Record<string, LlmAccessMode> = {};
		const errors: Record<string, string> = {};
		const foreign: Record<string, boolean> = {};
		results.forEach((r, i) => {
			const id = ids[i];
			if (r.status === 'fulfilled' && isLlmAccessMode(r.value?.mode)) modes[id] = r.value.mode;
			else if (r.status === 'rejected' && isTenantNotOnboarded(r.reason)) foreign[id] = true;
			else
				errors[id] = llmAccessErrorMessage(
					r.status === 'rejected' ? r.reason : null,
					"Couldn't read the service access."
				);
		});
		llmByTenant = modes;
		llmErrors = errors;
		llmForeign = foreign;
	}

	/** False = the PUT failed and the selector reverts to what the server still holds. */
	async function setLlmAccess(tenant: AdminTenantSummary, mode: LlmAccessMode): Promise<boolean> {
		const id = tenant.tenant_id;
		llmBusy = { ...llmBusy, [id]: true };
		llmSaved = without(llmSaved, id);
		llmErrors = without(llmErrors, id);
		try {
			const res = await admin.setTenantLlmAccess(id, mode);
			const saved = isLlmAccessMode(res?.mode) ? res.mode : mode;
			llmByTenant = { ...llmByTenant, [id]: saved };
			llmSaved = { ...llmSaved, [id]: true };
			toastSuccess('Service access saved', `${tenantLabel(tenant)}: ${LLM_ACCESS_LABELS[saved]}`);
			return true;
		} catch (err) {
			llmErrors = {
				...llmErrors,
				[id]: llmAccessErrorMessage(err, 'Updating the service access failed. Try again.')
			};
			return false;
		} finally {
			llmBusy = without(llmBusy, id);
		}
	}

	async function loadTenants(): Promise<void> {
		loading = true;
		error = null;
		try {
			const [res] = await Promise.all([admin.tenants(), loadYouTubeTenants()]);
			tenants = res.items;
			total = res.total;
			void loadLlmAccess(res.items.map((t) => t.tenant_id));
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void loadTenants();
	});

	const projectsLabel = (n: number): string => `${n} ${n === 1 ? 'project' : 'projects'}`;
	// A missing / non-finite cost is UNKNOWN, never $0 (utils/cost.ts): the row and
	// the platform total render "Cost unavailable" instead of a fabricated figure.
	const tenantCost = (t: AdminTenantSummary) =>
		formatCost(t.total_cost_usd, 'ok', null, { digits: 2 });

	// Platform-wide cost roll-up (orchestrator#251 surfaces per-tenant cost). One
	// unknown tenant cost makes the total unknown; the known part is only a lower
	// bound and goes in the tooltip.
	const platformCost = $derived.by(() => {
		const known = tenants.map((t) => knownCost(t.total_cost_usd));
		const sum = known.reduce<number>((acc, v) => acc + (v ?? 0), 0);
		return known.every((v) => v !== null)
			? formatCost(sum, 'ok', null, { digits: 2 })
			: formatCost(null, 'ok', null, { digits: 2, lowerBound: sum });
	});

	function openRename(tenant: AdminTenantSummary): void {
		renameTarget = tenant;
		renameValue = tenant.name ?? '';
		actionError = null;
		renameOpen = true;
	}

	// An empty / whitespace-only name blanks the tenant's display name, after
	// which the row falls back to a raw UUID and the tenant is effectively
	// unidentifiable in the list. Block it at the Save button.
	const renameInvalid = $derived(renameValue.trim().length === 0);

	// A real error message: 'Rename failed' reads the same for a 403 (not
	// permitted) and a 500 (backend broke). Surface what actually happened.
	function describe(e: unknown, fallback: string): string {
		return e instanceof Error && e.message ? e.message : fallback;
	}

	async function saveRename(): Promise<void> {
		if (!renameTarget || renameInvalid) return;
		saving = true;
		actionError = null;
		const name = renameValue.trim();
		try {
			await admin.updateTenant(renameTarget.tenant_id, { name });
			renameOpen = false;
			renameTarget = null;
			await loadTenants();
			toastSuccess('Tenant renamed', name);
		} catch (e) {
			actionError = describe(e, 'Rename failed. Try again.');
		} finally {
			saving = false;
		}
	}

	// Suspending a tenant cuts off every user in that organization at once, so
	// it goes through an explicit confirm that names the tenant. Re-activating
	// is not destructive and stays a single click.
	let suspendOpen = $state(false);
	let suspendTarget = $state<AdminTenantSummary | null>(null);

	function requestStatusChange(tenant: AdminTenantSummary): void {
		actionError = null;
		if (tenant.status === 'suspended') {
			void toggleStatus(tenant);
			return;
		}
		suspendTarget = tenant;
		suspendOpen = true;
	}

	function confirmSuspend(): void {
		const target = suspendTarget;
		suspendOpen = false;
		suspendTarget = null;
		if (target) void toggleStatus(target);
	}

	// --- Offboarding: direct export + two-step delete ---
	let queue = $state<ReturnType<typeof OffboardingQueue> | null>(null);
	const nameOf = (id: string): string | null =>
		tenants.find((t) => t.tenant_id === id)?.name ?? null;
	let exportingId = $state<string | null>(null);

	async function exportTenant(tenant: AdminTenantSummary): Promise<void> {
		exportingId = tenant.tenant_id;
		actionError = null;
		try {
			await adminOffboarding.exportTenant(tenant.tenant_id);
			toastSuccess(
				'Export started',
				`${tenantLabel(tenant)} — its progress shows in the offboarding queue.`
			);
			void queue?.reload();
		} catch (e) {
			actionError = offboardingError(e, 'Starting the export failed.');
		} finally {
			exportingId = null;
		}
	}

	let deleteOpen = $state(false);
	let deleteTarget = $state<AdminTenantSummary | null>(null);
	function openDelete(tenant: AdminTenantSummary): void {
		actionError = null;
		deleteTarget = tenant;
		deleteOpen = true;
	}

	async function toggleStatus(tenant: AdminTenantSummary): Promise<void> {
		const next = tenant.status === 'suspended' ? 'active' : 'suspended';
		busyId = tenant.tenant_id;
		actionError = null;
		try {
			await admin.updateTenant(tenant.tenant_id, { status: next });
			await loadTenants();
			toastSuccess(
				next === 'suspended' ? 'Tenant suspended' : 'Tenant re-activated',
				tenantLabel(tenant)
			);
		} catch (e) {
			actionError = describe(e, 'Status change failed. Try again.');
		} finally {
			busyId = null;
		}
	}
</script>

<Page width="narrow" testid="tenants-home">
	<PageHeader kicker="Platform" title="Tenants" subtitle="Cross-tenant administration.">
		{#snippet actions()}
			{#if !loading && !error}
				<div class="flex items-center gap-2" data-testid="platform-summary">
					<Pill tone="neutral">
						{#if visibleTenants.length === total}
							{total} {total === 1 ? 'tenant' : 'tenants'}
						{:else}
							{visibleTenants.length} of {total} tenants
						{/if}
					</Pill>
					<span data-testid="platform-cost" title={platformCost.title}>
						<Pill tone="accent">
							{platformCost.unavailable ? 'Total cost unavailable' : `${platformCost.text} total`}
						</Pill>
					</span>
				</div>
			{/if}
		{/snippet}
	</PageHeader>

	<YouTubePlatformChannelPanel />

	<OffboardingQueue bind:this={queue} tenantName={nameOf} />

	{#if ytLoadError}
		<p class="mb-3 text-sm text-[var(--color-danger)]" data-testid="tenant-youtube-load-error">
			{ytLoadError}
		</p>
	{/if}

	{#if actionError}
		<p class="mb-3 text-sm text-[var(--color-danger)]" data-testid="tenant-action-error">
			{actionError}
		</p>
	{/if}

	{#if loading}
		<div data-testid="tenants-loading">
			<Card class="p-2">
				<Skeleton variant="text" count={4} height="2.25rem" />
			</Card>
		</div>
	{:else if error}
		<ErrorState title="Couldn't load tenants" {error} onRetry={loadTenants} />
	{:else if tenants.length === 0}
		<EmptyState
			title="No tenants yet"
			description="Tenants appear here once they create their first project."
		>
			{#snippet action()}
				<Button variant="primary" href="/provision">Provision tenant</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="mb-4 flex flex-wrap items-end gap-3" data-testid="tenants-filters">
			<Input
				name="tenants-search"
				placeholder="Search by name or ID…"
				bind:value={searchInput}
				class="min-w-[14rem] flex-1"
			/>
			<Select
				name="tenants-sort"
				value={sortKey}
				options={sortOptions}
				placeholder=""
				onchange={onSortChange}
				class="min-w-[11rem]"
			/>
		</div>
		{#if visibleTenants.length === 0}
			<EmptyState title="No tenants match your search" description="Try a different name or ID.">
				{#snippet action()}
					<Button variant="secondary" onclick={() => (searchInput = '')}>Clear search</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Card>
				<ul class="divide-y divide-[var(--color-border)]" data-testid="tenants-list">
					{#each visibleTenants as tenant (tenant.tenant_id)}
						<li
							class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
							data-testid="tenant-row"
						>
							<div class="min-w-0">
								<p
									class="flex items-center gap-2 truncate text-sm font-medium text-[var(--color-text)]"
								>
									{#if tenant.name}
										{tenant.name}
									{:else}
										<span class="font-mono">{tenant.tenant_id}</span>
									{/if}
									<Pill tone={tenant.status === 'suspended' ? 'danger' : 'success'}>
										{tenant.status ?? 'active'}
									</Pill>
								</p>
								{#if tenant.name}
									<p class="mt-0.5 truncate font-mono text-xs text-[var(--color-text-muted)]">
										{tenant.tenant_id}
									</p>
								{/if}
								<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
									Last activity: {formatDateTime(tenant.last_activity) || '—'}
								</p>
								{#if llmForeign[tenant.tenant_id]}
									<p
										class="mt-2 text-xs text-[var(--color-text-muted)]"
										data-testid="tenant-llm-access-foreign"
									>
										Service access: managed by another app (not onboarded to Studio)
									</p>
								{:else}
									<div
										class="mt-2 flex flex-wrap items-center gap-2"
										data-testid="tenant-llm-access"
									>
										<LlmAccessSelect
											name={`tenant-llm-access-${tenant.tenant_id}`}
											value={llmByTenant[tenant.tenant_id] ?? ''}
											placeholder="Unknown"
											disabled={llmBusy[tenant.tenant_id] === true}
											showHint={false}
											onchange={(mode) => setLlmAccess(tenant, mode)}
											class="w-[14rem] max-w-full"
										/>
										{#if llmSaved[tenant.tenant_id]}
											<span
												class="text-xs text-status-completed"
												data-testid="tenant-llm-access-saved"
											>
												Saved
											</span>
										{/if}
									</div>
									{#if llmErrors[tenant.tenant_id]}
										<p
											class="mt-1 text-xs break-words text-[var(--color-danger)]"
											data-testid="tenant-llm-access-error"
										>
											{llmErrors[tenant.tenant_id]}
										</p>
									{/if}
								{/if}
								<div
									class="mt-2 flex flex-wrap items-center gap-2"
									data-testid="tenant-youtube-policy"
								>
									<span class="text-xs text-[var(--color-text-muted)]">
										May use platform YouTube channel
									</span>
									<Select
										name={`tenant-youtube-${tenant.tenant_id}`}
										value={policyValue(tenant)}
										options={policyOptions}
										placeholder="Unknown"
										disabled={ytBusy[tenant.tenant_id] === true}
										onchange={(e) => setYouTubePolicy(tenant, e)}
										class="w-[7.5rem]"
									/>
									{#if ytRow(tenant)?.has_grant}
										<span data-testid="tenant-youtube-grant">
											<Pill tone="accent">Own channel</Pill>
										</span>
									{/if}
									{#if ytRow(tenant)?.has_oauth_client}
										<span data-testid="tenant-youtube-oauth-client">
											<Pill tone="neutral">Own OAuth client</Pill>
										</span>
									{/if}
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-2 sm:shrink-0">
								<div class="hidden text-right sm:block" data-testid="tenant-cost">
									<p
										class="font-mono text-sm tabular-nums text-[var(--color-text)]"
										title={tenantCost(tenant).title}
									>
										{tenantCost(tenant).text}
									</p>
									<p class="text-xs text-[var(--color-text-muted)]">
										{(tenant.run_count ?? 0).toLocaleString()} runs
									</p>
								</div>
								<Pill tone="accent">{projectsLabel(tenant.project_count)}</Pill>
								<Button variant="ghost" size="sm" onclick={() => openRename(tenant)}>Rename</Button>
								<Button
									variant={tenant.status === 'suspended' ? 'secondary' : 'danger'}
									size="sm"
									loading={busyId === tenant.tenant_id}
									onclick={() => requestStatusChange(tenant)}
								>
									{tenant.status === 'suspended' ? 'Activate' : 'Suspend'}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									loading={exportingId === tenant.tenant_id}
									onclick={() => exportTenant(tenant)}
								>
									Export
								</Button>
								<Button variant="danger" size="sm" onclick={() => openDelete(tenant)}>
									Delete…
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</Page>

<Dialog bind:open={renameOpen} title="Rename tenant">
	<div class="flex flex-col gap-4" data-testid="tenant-rename-dialog">
		<Input
			name="tenant-name"
			label="Display name"
			placeholder="e.g. Acme Corp"
			bind:value={renameValue}
		/>
		<p class="font-mono text-xs text-[var(--color-text-muted)]">{renameTarget?.tenant_id}</p>
		{#if renameInvalid}
			<p class="text-xs text-[var(--color-danger)]" data-testid="tenant-rename-invalid">
				A display name is required — an empty name would leave only the tenant ID.
			</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" size="sm" onclick={() => (renameOpen = false)}>Cancel</Button>
			<Button
				variant="primary"
				size="sm"
				loading={saving}
				disabled={renameInvalid}
				onclick={saveRename}
			>
				Save
			</Button>
		</div>
	</div>
</Dialog>

<!-- Gated on the target: the <dialog> subtree stays mounted when closed. -->
<Dialog bind:open={suspendOpen} title="Suspend this tenant?">
	{#if suspendTarget}
		<div class="flex flex-col gap-4" data-testid="tenant-suspend-confirm">
			<p class="text-sm text-[var(--color-text)]">
				Suspending <strong>{suspendTarget ? tenantLabel(suspendTarget) : ''}</strong> cuts off every user
				in that organization immediately. Running jobs are not resumed by re-activating.
			</p>
			<p class="font-mono text-xs text-[var(--color-text-muted)]">{suspendTarget?.tenant_id}</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (suspendOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={confirmSuspend}>Suspend tenant</Button>
			</div>
		</div>
	{/if}
</Dialog>

<TenantDeleteDialog
	bind:open={deleteOpen}
	tenantId={deleteTarget?.tenant_id ?? null}
	tenantLabel={deleteTarget ? tenantLabel(deleteTarget) : undefined}
	onStarted={() => void queue?.reload()}
	onDone={() => {
		void queue?.reload();
		void loadTenants();
	}}
/>
