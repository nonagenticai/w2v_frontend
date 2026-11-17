<script lang="ts">
	// Tenant-admin home. Shows the caller's identity context (role + tenant) plus
	// the org aggregate from GET /api/admin/overview (orchestrator#241), and lets
	// a tenant_admin rename the workspace (PATCH /api/tenant, P2). Members and API
	// keys have their own screens — this page links to them.
	// Gated by the (tenant) group layout; the server 403s on its own too.
	import { fetchUser, getMembershipRole, getUser } from '$lib/stores/auth.svelte';
	import { admin, type AdminOverviewResponse } from '$lib/api';
	import { formatCost } from '$lib/utils/cost';
	import { tenancy, tenancyErrorMessage } from '$lib/api/tenancy.js';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Button, Card, Input, Pill, Skeleton, ErrorState } from '$lib/components/ui';
	import TenantOffboardingCard from '$lib/components/offboarding/TenantOffboardingCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import { NAV_SECTIONS } from '$lib/layout/navConfig';
	import { isSuperAdmin } from '$lib/stores/auth.svelte';

	// Every other Workspace screen, in sidebar order (this page excluded).
	const siblings = (NAV_SECTIONS.find((s) => s.id === 'workspace')?.items ?? []).filter(
		(i) => i.id !== 'admin'
	);

	const user = $derived(getUser());
	const membershipRole = $derived(getMembershipRole());
	// No GET /api/tenant exists; the current name comes from the caller's
	// membership row for the active tenant (/auth/me.memberships).
	const currentName = $derived(
		user?.memberships?.find((m) => m.tenant_id === user?.tenant_id)?.name ?? null
	);

	// ─── Rename ──────────────────────────────────────────────────────────
	let nameDraft = $state<string | null>(null); // null ⇒ untouched, show current
	const nameValue = $derived(nameDraft ?? currentName ?? '');
	const canRename = $derived(
		nameValue.trim().length > 0 &&
			nameValue.trim().length <= 200 &&
			nameValue.trim() !== currentName
	);
	let renaming = $state(false);
	let renameError = $state<string | null>(null);

	async function rename(): Promise<void> {
		if (!canRename || renaming) return;
		renaming = true;
		renameError = null;
		try {
			const res = await tenancy.renameTenant(nameValue.trim());
			// Re-read /auth/me so the switcher + this page show the new name.
			await fetchUser();
			nameDraft = null;
			toastSuccess('Workspace renamed', `This workspace is now “${res.name ?? nameValue.trim()}”.`);
		} catch (e) {
			renameError = tenancyErrorMessage(e, 'Rename failed. Try again.');
		} finally {
			renaming = false;
		}
	}

	let overview = $state<AdminOverviewResponse | null>(null);
	let error = $state<unknown>(null);
	let loading = $state(true);

	async function loadOverview(): Promise<void> {
		loading = true;
		error = null;
		try {
			overview = await admin.overview();
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void loadOverview();
	});

	// Admin is the summary; Projects/Usage are the detail views. Wire each tile to
	// its drill-down (same affordance the home page gives via StatsGrid hrefs):
	// Projects → the project list, Runs/Total cost → the Usage detail (which is the
	// expanded view behind this flat total). Counts already exist; the link is the
	// leverage.
	// cost_status 'unavailable' ⇒ total_cost_usd is a lower bound, not the cost:
	// render "Cost unavailable" (reason in the tooltip), never the partial figure.
	const totalCost = $derived(
		overview
			? formatCost(
					overview.cost_status === 'unavailable' ? null : overview.total_cost_usd,
					overview.cost_status,
					overview.cost_unavailable_reason,
					{ lowerBound: overview.total_cost_usd }
				)
			: null
	);

	const stats: { label: string; value: string; title?: string; href?: string }[] = $derived(
		overview
			? [
					{ label: 'Projects', value: String(overview.project_count), href: '/projects' },
					{ label: 'Runs', value: String(overview.run_count), href: '/usage' },
					{
						label: 'Total cost',
						value: totalCost?.text ?? '',
						title: totalCost?.title,
						href: '/usage'
					}
				]
			: []
	);
</script>

<Page width="narrow" testid="admin-home">
	<PageHeader
		kicker="Workspace"
		title="Workspace overview"
		subtitle="Rename this workspace, see its usage, and jump to everything else you manage here."
	/>

	<!-- The hub links to EVERY sibling workspace screen (from the one navConfig), so
	     nothing an admin manages is reachable only from the sidebar. -->
	<nav aria-label="Workspace admin" data-testid="admin-sibling-links">
		<ul class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each siblings as item (item.id)}
				<li>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- fixed internal hrefs from navConfig. -->
					<a
						href={item.href}
						class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-strong)]"
					>
						<Icon icon={item.icon} size={16} class="text-[var(--color-text-muted)]" />
						{item.label}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</li>
			{/each}
		</ul>
	</nav>

	<div class="mb-4" data-testid="tenant-rename">
		<Card class="p-5">
			<form
				class="flex flex-wrap items-end gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					void rename();
				}}
			>
				<Input
					name="tenant-name"
					label="Workspace name"
					placeholder="Acme Corp"
					value={nameValue}
					oninput={(e: Event) => (nameDraft = (e.target as HTMLInputElement).value)}
					class="min-w-[14rem] flex-1"
				/>
				<Button type="submit" variant="primary" size="sm" loading={renaming} disabled={!canRename}>
					Save
				</Button>
			</form>
			{#if renameError}
				<p class="mt-2 text-sm text-[var(--color-danger)]" data-testid="tenant-rename-error">
					{renameError}
				</p>
			{/if}
		</Card>
	</div>

	<Card class="p-5">
		<dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Workspace</dt>
				<dd class="mt-1 text-sm text-[var(--color-text)]">{currentName ?? '—'}</dd>
				<!-- The raw id is platform vocabulary: only the platform operator sees it. -->
				{#if isSuperAdmin()}
					<dd
						class="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]"
						data-testid="admin-workspace-id"
					>
						{user?.tenant_id ?? '—'}
					</dd>
				{/if}
			</div>
			<div>
				<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Your role</dt>
				<dd class="mt-1 flex flex-wrap gap-1.5">
					{#if membershipRole}
						<Pill tone="accent">{membershipRole === 'tenant_admin' ? 'admin' : membershipRole}</Pill
						>
					{:else}
						{#each (user?.roles ?? []).filter( (r) => ['super_admin', 'tenant_admin'].includes(r) ) as role (role)}
							<Pill tone="accent">{role}</Pill>
						{:else}
							<span class="text-sm text-[var(--color-text-muted)]">none</span>
						{/each}
					{/if}
				</dd>
			</div>
		</dl>
	</Card>

	<h2
		class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
	>
		Workspace usage
	</h2>

	{#if loading}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="overview-loading">
			{#each [0, 1, 2] as i (i)}
				<Card class="p-5"><Skeleton height="2.5rem" /></Card>
			{/each}
		</div>
	{:else if error}
		<ErrorState title="Couldn't load usage" {error} onRetry={loadOverview} />
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="overview-stats">
			{#each stats as stat (stat.label)}
				{#snippet tile()}
					<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
						{stat.label}
					</dt>
					<dd
						class="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]"
						title={stat.title}
					>
						{stat.value}
					</dd>
				{/snippet}
				{#if stat.href}
					<!-- Caller-provided internal link (plain href; resolve() only types static
					     route ids — same tolerated pattern as StatsGrid). -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -- stat.href is a caller-provided runtime string; resolve() only types static route ids. -->
					<a
						href={stat.href}
						data-testid="overview-stat-link"
						class="block rounded-[var(--radius-lg)] transition hover:shadow-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
						aria-label={`${stat.label}: ${stat.value}${stat.title ? ` (${stat.title})` : ''}`}
					>
						<Card hover class="p-5">{@render tile()}</Card>
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<Card class="p-5">{@render tile()}</Card>
				{/if}
			{/each}
		</div>
	{/if}

	<h2
		class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
	>
		Data export &amp; deletion
	</h2>
	<TenantOffboardingCard />
</Page>
