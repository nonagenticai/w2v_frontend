<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Tenant-admin Usage drill-down. The detailed view behind the Admin home's
	// flat total: all-time cost/token totals plus breakdowns by project type,
	// usage stage, and model/provider, from GET /api/admin/usage (orchestrator
	// #250). Gated by the (tenant) group layout; the server 403s on its own too.
	// A super-admin sees the scope-switched tenant (the endpoint honours
	// X-Active-Tenant-Id).
	import { admin, type AdminUsageDetailResponse } from '$lib/api';
	import { Button, Card, Skeleton, ErrorState, EmptyState, Select } from '$lib/components/ui';
	import TenantLimitsCard from '$lib/components/tenant/TenantLimitsCard.svelte';
	import BarChart from '$lib/components/charts/BarChart.svelte';
	import { formatCost, costUnavailableReasonText } from '$lib/utils/cost';

	let detail = $state<AdminUsageDetailResponse | null>(null);
	let error = $state<unknown>(null);
	let loading = $state(true);

	// `windowDays` is a PAGE-WIDE filter — it scopes the totals, every breakdown
	// AND the chart to metered usage in the window ('' = all-time). `bucket` is
	// chart-only (the time_series granularity). Bounded defaults.
	let bucket = $state<'day' | 'week' | 'month'>('day');
	let windowDays = $state('30');

	const windowOptions = [
		{ value: '7', label: 'Last 7 days' },
		{ value: '30', label: 'Last 30 days' },
		{ value: '90', label: 'Last 90 days' },
		{ value: '', label: 'All time' }
	];
	const bucketOptions = [
		{ value: 'day', label: 'Daily' },
		{ value: 'week', label: 'Weekly' },
		{ value: 'month', label: 'Monthly' }
	];

	async function loadUsage(
		b: 'day' | 'week' | 'month' = bucket,
		w: string = windowDays
	): Promise<void> {
		loading = true;
		error = null;
		try {
			detail = await admin.usage({ bucket: b, windowDays: w === '' ? null : Number(w) });
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Re-fetch when the chart's bucket or window changes (both read here are
		// tracked, so a selector change refetches with the new params).
		void loadUsage(bucket, windowDays);
	});

	function onWindow(e: Event): void {
		windowDays = (e.target as HTMLSelectElement).value;
	}
	function onBucket(e: Event): void {
		bucket = (e.target as HTMLSelectElement).value as 'day' | 'week' | 'month';
	}

	function cost(v: number): string {
		return `$${v.toFixed(4)}`;
	}
	function num(v: number): string {
		return v.toLocaleString();
	}

	// cost_status 'unavailable' ⇒ billing could not be read for not-yet-mirrored
	// runs: the total is a lower bound, so it renders "Cost unavailable" (reason
	// in the tooltip) and the breakdowns below carry a partial-figures notice.
	const costUnavailable = $derived(detail?.cost_status === 'unavailable');
	const totalCost = $derived(
		detail
			? formatCost(
					costUnavailable ? null : detail.totals.cost_usd,
					detail.cost_status,
					detail.cost_unavailable_reason,
					{ lowerBound: detail.totals.cost_usd }
				)
			: null
	);

	const totalStats: { label: string; value: string; title?: string }[] = $derived(
		detail
			? [
					{ label: 'Projects', value: num(detail.totals.project_count) },
					{ label: 'Runs', value: num(detail.totals.run_count) },
					{ label: 'Input tokens', value: num(detail.totals.input_tokens) },
					{ label: 'Output tokens', value: num(detail.totals.output_tokens) },
					{ label: 'Total cost', value: totalCost?.text ?? '', title: totalCost?.title }
				]
			: []
	);

	const isEmpty = $derived(detail !== null && detail.totals.run_count === 0);

	// P6 ORCH-3 breakdowns; an orchestrator that predates them omits the keys.
	const byUser = $derived(detail?.by_user ?? []);
	const bySlot = $derived(detail?.by_slot ?? []);
	const FUNDING_LABELS: Record<string, string> = {
		local_gpu: 'Local GPU',
		platform_external: 'Platform (external)',
		tenant_byo: 'Your provider',
		unattributed: 'Unattributed'
	};
	function unitsText(units: Record<string, number> | undefined): string {
		return Object.entries(units ?? {})
			.map(([kind, n]) => `${num(n)} ${kind}`)
			.join(' · ');
	}
</script>

<Page width="narrow" testid="usage-home">
	<PageHeader
		kicker="Workspace"
		title="Usage"
		subtitle="Cost and token usage across this workspace's runs, for the selected window."
	>
		{#snippet actions()}
			<!-- Page-wide window filter: scopes the totals, every breakdown and the
			     chart. Lives in the header (not by the chart) because it governs the
			     whole page; the bucket control stays by the chart. -->
			<div data-testid="usage-window" class="min-w-[10rem]">
				<Select
					name="usage-window"
					value={windowDays}
					options={windowOptions}
					placeholder=""
					onchange={onWindow}
				/>
			</div>
		{/snippet}
	</PageHeader>

	{#if loading}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="usage-loading">
			{#each [0, 1, 2, 3, 4] as i (i)}
				<Card class="p-5"><Skeleton height="2.5rem" /></Card>
			{/each}
		</div>
	{:else if error}
		<!-- Retry must be a zero-arg wrapper: `onRetry={loadUsage}` hands the click's
		     MouseEvent to `loadUsage`'s first positional param (`b = bucket`), which
		     then serialises into the `bucket` query param and re-issues the WRONG
		     request. The wrapper re-reads the live `bucket`/`windowDays` state. -->
		<ErrorState title="Couldn't load usage" {error} onRetry={() => void loadUsage()} />
	{:else if isEmpty}
		<EmptyState
			title="No usage recorded yet"
			description="Run a project to see cost and token usage."
		>
			{#snippet action()}
				<Button variant="primary" href="/projects/new">New project</Button>
			{/snippet}
		</EmptyState>
	{:else if detail}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="usage-totals">
			{#each totalStats as stat (stat.label)}
				<Card class="p-5">
					<dt class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
						{stat.label}
					</dt>
					<dd
						class="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]"
						title={stat.title}
					>
						{stat.value}
					</dd>
				</Card>
			{/each}
		</div>
		{#if costUnavailable}
			<p
				data-testid="usage-cost-unavailable"
				class="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			>
				Cost unavailable: {costUnavailableReasonText(detail.cost_unavailable_reason)} The cost figures
				below cover only cost already recorded and are incomplete.
			</p>
		{/if}

		<div class="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				Cost over time
			</h2>
			<div data-testid="usage-bucket" class="min-w-[8rem]">
				<Select
					name="usage-bucket"
					value={bucket}
					options={bucketOptions}
					placeholder=""
					onchange={onBucket}
				/>
			</div>
		</div>
		<Card class="p-5">
			<div data-testid="usage-timeseries">
				<BarChart
					points={detail.time_series.map((p) => ({ label: p.bucket, value: p.cost_usd }))}
					formatValue={cost}
					ariaLabel="Cost over time"
					emptyLabel="No usage in this range."
				/>
			</div>
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				Bucket sets the chart's time granularity; the window above applies to every figure on this
				page.
			</p>
		</Card>

		<h2
			class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
		>
			By project type
		</h2>
		<Card class="p-0">
			<ul class="divide-y divide-[var(--color-border)]" data-testid="usage-by-type">
				{#each detail.by_type as row (row.type)}
					<li class="flex items-center justify-between px-5 py-3" data-testid="usage-by-type-row">
						<div>
							<span class="text-sm font-medium text-[var(--color-text)]">{row.type}</span>
							<span class="ml-2 text-xs text-[var(--color-text-muted)]">
								{num(row.run_count)} runs
							</span>
						</div>
						<span class="font-mono text-sm tabular-nums text-[var(--color-text)]">
							{cost(row.cost_usd)}
						</span>
					</li>
				{/each}
			</ul>
		</Card>

		<h2
			class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
		>
			By stage
		</h2>
		<Card class="p-0">
			<ul class="divide-y divide-[var(--color-border)]" data-testid="usage-by-stage">
				{#each detail.by_stage as row (row.stage_name)}
					<li class="flex items-center justify-between px-5 py-3" data-testid="usage-by-stage-row">
						<div>
							<span class="text-sm font-medium text-[var(--color-text)]">{row.stage_name}</span>
							<span class="ml-2 text-xs text-[var(--color-text-muted)]">
								{num(row.call_count)} calls · {num(row.input_tokens)}→{num(row.output_tokens)} tok
							</span>
						</div>
						<span class="font-mono text-sm tabular-nums text-[var(--color-text)]">
							{cost(row.cost_usd)}
						</span>
					</li>
				{/each}
			</ul>
		</Card>

		<h2
			class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
		>
			By model
		</h2>
		<Card class="p-0">
			<ul class="divide-y divide-[var(--color-border)]" data-testid="usage-by-model">
				{#each detail.by_model as row, i (`${row.model ?? 'none'}:${row.provider ?? 'none'}:${i}`)}
					<li class="flex items-center justify-between px-5 py-3" data-testid="usage-by-model-row">
						<div>
							<span class="text-sm font-medium text-[var(--color-text)]">{row.model ?? '—'}</span>
							{#if row.provider}
								<span class="ml-2 text-xs text-[var(--color-text-muted)]">{row.provider}</span>
							{/if}
							<span class="ml-2 text-xs text-[var(--color-text-muted)]">
								{num(row.call_count)} calls
							</span>
						</div>
						<span class="font-mono text-sm tabular-nums text-[var(--color-text)]">
							{cost(row.cost_usd)}
						</span>
					</li>
				{/each}
			</ul>
		</Card>

		<h2
			class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
		>
			By user
		</h2>
		<Card class="p-0">
			{#if byUser.length === 0}
				<p
					class="px-5 py-3 text-sm text-[var(--color-text-muted)]"
					data-testid="usage-by-user-empty"
				>
					No per-user breakdown for this window.
				</p>
			{:else}
				<ul class="divide-y divide-[var(--color-border)]" data-testid="usage-by-user">
					{#each byUser as row, i (`${row.subject_id ?? 'unattributed'}:${i}`)}
						<li class="flex items-center justify-between px-5 py-3" data-testid="usage-by-user-row">
							<div>
								<span class="text-sm font-medium text-[var(--color-text)]">{row.label}</span>
								{#if row.member_status === 'removed'}
									<span class="ml-2 text-xs text-[var(--color-text-muted)]">(removed member)</span>
								{:else if !row.subject_id}
									<span class="ml-2 text-xs text-[var(--color-text-muted)]">
										(usage recorded before per-user attribution)
									</span>
								{:else if row.member_status == null}
									<span class="ml-2 text-xs text-[var(--color-text-muted)]">(not a member)</span>
								{/if}
								<span class="ml-2 text-xs text-[var(--color-text-muted)]">
									{num(row.call_count)} calls · {num(row.input_tokens)}→{num(row.output_tokens)} tok
								</span>
							</div>
							<span class="font-mono text-sm tabular-nums text-[var(--color-text)]">
								{cost(row.cost_usd)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<h2
			class="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
		>
			By provider slot
		</h2>
		<Card class="p-0">
			{#if bySlot.length === 0}
				<p
					class="px-5 py-3 text-sm text-[var(--color-text-muted)]"
					data-testid="usage-by-slot-empty"
				>
					No per-slot breakdown for this window.
				</p>
			{:else}
				<ul class="divide-y divide-[var(--color-border)]" data-testid="usage-by-slot">
					{#each bySlot as row, i (`${row.slot}:${row.funding}:${i}`)}
						<li class="flex items-center justify-between px-5 py-3" data-testid="usage-by-slot-row">
							<div>
								<span class="text-sm font-medium text-[var(--color-text)]">{row.slot}</span>
								<span class="ml-2 text-xs text-[var(--color-text-muted)]">
									{FUNDING_LABELS[row.funding] ?? row.funding}
								</span>
								<span class="ml-2 text-xs text-[var(--color-text-muted)]">
									{num(row.call_count)} calls{#if unitsText(row.units)}
										· {unitsText(row.units)}{/if}
								</span>
							</div>
							<span class="font-mono text-sm tabular-nums text-[var(--color-text)]">
								{cost(row.cost_usd)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="px-5 pb-3 text-xs text-[var(--color-text-muted)]">
				"platform" is the platform route (billing-mirrored calls), not who paid.
			</p>
		</Card>
	{/if}

	<!-- Limits load independently: a licences-service hiccup must not hide usage. -->
	<div class="mt-10">
		<TenantLimitsCard />
	</div>
</Page>
