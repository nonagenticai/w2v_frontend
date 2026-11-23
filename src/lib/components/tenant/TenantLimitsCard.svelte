<script lang="ts">
	// Read-only limits (P6 ORCH-3) — GET /api/tenant/limits, tenant_admin only.
	// Honest by construction: each limit shows whether anything in this deployment
	// actually refuses work on it. Licence quotas are listed but NOT enforced by w2v
	// today; there is no edit control because there is no write route.
	import { onMount } from 'svelte';
	import {
		tenantLimits,
		limitLabel,
		limitValueText,
		LICENCE_LOOKUP_TEXT,
		type TenantLimitsReport
	} from '$lib/api/tenant-limits.js';
	import { Badge, Card, ErrorState, Skeleton } from '$lib/components/ui';

	let report = $state<TenantLimitsReport | null>(null);
	let error = $state<unknown>(null);
	let loading = $state(true);

	async function load(): Promise<void> {
		loading = true;
		error = null;
		try {
			report = await tenantLimits.get();
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());
</script>

<div data-testid="tenant-limits">
	<h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
		Limits
	</h2>
	<p class="mb-3 text-xs text-[var(--color-text-muted)]">
		Read-only. Limits are set by your plan and the platform operator. "Not enforced" means nothing
		in this deployment refuses work when the value is exceeded.
	</p>
	{#if loading}
		<Card class="p-5"><Skeleton height="4rem" /></Card>
	{:else if error}
		<ErrorState title="Couldn't load limits" {error} onRetry={() => void load()} />
	{:else if report}
		<Card class="p-0">
			{#if report.licence_lookup !== 'ok'}
				<p
					class="border-b border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-muted)]"
					data-testid="tenant-limits-licence"
				>
					{LICENCE_LOOKUP_TEXT[report.licence_lookup]}
				</p>
			{:else if report.plan_code}
				<p
					class="border-b border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-muted)]"
					data-testid="tenant-limits-licence"
				>
					Plan: <span class="font-mono">{report.plan_code}</span>
				</p>
			{/if}
			<ul class="divide-y divide-[var(--color-border)]">
				{#each report.limits as row (row.key)}
					<li class="px-5 py-3" data-testid="tenant-limit-row" data-key={row.key}>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="text-sm font-medium text-[var(--color-text)]">
								{limitLabel(row.key)}
							</span>
							<span
								data-testid="tenant-limit-enforced"
								data-enforced={row.enforced ? 'true' : 'false'}
							>
								<Badge variant={row.enforced ? 'success' : 'default'}>
									{row.enforced ? 'Enforced' : 'Not enforced'}
								</Badge>
							</span>
						</div>
						<div class="mt-1 text-sm text-[var(--color-text)]">
							<span class="tabular-nums">{limitValueText(row, report.licence_lookup)}</span>
							{#if row.unit && row.value != null}
								<span class="text-xs text-[var(--color-text-muted)]"> {row.unit}</span>
							{/if}
						</div>
						{#if row.enforced && row.enforced_at}
							<p class="mt-1 text-xs text-[var(--color-text-muted)]">
								Enforced at: {row.enforced_at}
							</p>
						{/if}
						<p class="mt-1 text-xs text-[var(--color-text-muted)]">{row.note}</p>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</div>
