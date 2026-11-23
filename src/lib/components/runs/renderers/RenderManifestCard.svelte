<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- the only anchor here
	   is the external rendered-artifact URL from the run output, never a route. */
	// render_manifest output → "How this video was made": an override-ledger of
	// every resolved knob with a PROVENANCE chip (default / smart-auto / override /
	// llm-clamped), an audited-completeness badge, and a reproducibility spine
	// (master_seed + input_hash fingerprints). Surfaces the backend's decision
	// provenance instead of a raw JSON blob.
	import Duration from './_shared/Duration.svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type {
		RenderManifestOutput,
		RenderManifest,
		ProvenanceLedgerEntry
	} from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as RenderManifestOutput);
	const manifest = $derived<RenderManifest>(
		data.manifest && typeof data.manifest === 'object' ? data.manifest : {}
	);

	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const ledger = $derived<ProvenanceLedgerEntry[]>(
		Array.isArray(manifest.override_ledger) ? manifest.override_ledger : []
	);

	const completeness = $derived(num(manifest.completeness));
	const completenessPct = $derived(
		completeness != null ? Math.round(Math.max(0, Math.min(1, completeness)) * 100) : null
	);
	const isAudited = $derived(completeness != null && completeness >= 1);

	// Un-audited knobs = those still on their `default` source (nothing chose them).
	const unauditedCount = $derived(
		ledger.filter((e) => (str(e.source) ?? 'default') === 'default').length
	);

	const masterSeed = $derived(num(manifest.master_seed));
	const inputHash = $derived(str(manifest.input_hash));
	const outputSha = $derived(str(manifest.output_sha256));
	const hasMastering = $derived(!!manifest.mastering && typeof manifest.mastering === 'object');
	// Followed as a plain <a href> — a browser navigation, which can't carry the
	// X-Active-Tenant-Id header a super-admin's tenant switch relies on.
	const artifactUrl = $derived(scopedMediaUrl(str(manifest.artifact_url)));
	const durationSeconds = $derived(num(manifest.duration_seconds));

	// Provenance chip styling keyed by source. default = muted, smart-auto = teal
	// accent, override = coral (brand secondary), llm-clamped = amber (warning).
	type Prov = { label: string; bg: string; fg: string; bd: string };
	const PROVENANCE: Record<string, Prov> = {
		default: {
			label: 'default',
			bg: 'var(--color-surface-strong)',
			fg: 'var(--color-text-muted)',
			bd: 'var(--color-border)'
		},
		'smart-auto': {
			label: 'smart-auto',
			bg: 'var(--color-accent-bg)',
			fg: 'var(--color-accent-text)',
			bd: 'var(--color-accent-border)'
		},
		override: {
			label: 'override',
			bg: 'var(--color-secondary-bg)',
			fg: 'var(--color-secondary-text)',
			bd: 'var(--color-secondary-border)'
		},
		'llm-clamped': {
			label: 'llm-clamped',
			bg: 'var(--color-warning-bg)',
			fg: 'var(--color-warning-text)',
			bd: 'var(--color-warning-border)'
		}
	};
	const provOf = (source: string | undefined): Prov =>
		PROVENANCE[source ?? 'default'] ?? {
			label: source ?? 'default',
			bg: 'var(--color-surface-strong)',
			fg: 'var(--color-text-muted)',
			bd: 'var(--color-border)'
		};

	const fmtValue = (v: unknown): string => {
		if (v == null) return '—';
		if (typeof v === 'string') return v;
		if (typeof v === 'number' || typeof v === 'boolean') return String(v);
		try {
			return JSON.stringify(v);
		} catch {
			return String(v);
		}
	};
</script>

<div class="space-y-4" data-testid="render-manifest-card">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h3 class="text-sm font-semibold text-[var(--color-text)]">How this video was made</h3>
			<p class="text-kicker text-[var(--color-text-muted)]">Render manifest</p>
		</div>
		<div class="flex flex-col items-end gap-1">
			{#if completenessPct != null}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
					style={`background:${isAudited ? 'var(--color-success-bg)' : 'var(--color-warning-bg)'};color:${isAudited ? 'var(--color-success-text)' : 'var(--color-warning-text)'};border-color:${isAudited ? 'var(--color-success-border)' : 'var(--color-warning-border)'}`}
					data-testid="completeness-badge"
				>
					<span class="tabular-nums">{completenessPct}%</span> audited
				</span>
				{#if !isAudited}
					<span class="text-[11px] text-[var(--color-text-muted)]" data-testid="unaudited-note">
						{#if unauditedCount > 0}
							{unauditedCount} knob{unauditedCount === 1 ? '' : 's'} un-audited
						{:else}
							{100 - completenessPct}% un-audited
						{/if}
					</span>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Override ledger -->
	{#if ledger.length}
		<div class="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="text-left text-[var(--color-text-muted)]">
						<th class="px-3 py-2 text-xs font-medium uppercase tracking-wide">Knob</th>
						<th class="px-3 py-2 text-xs font-medium uppercase tracking-wide">Value</th>
						<th class="px-3 py-2 text-xs font-medium uppercase tracking-wide">Source</th>
					</tr>
				</thead>
				<tbody>
					{#each ledger as entry, i (str(entry.key) ?? i)}
						{@const p = provOf(str(entry.source))}
						<tr class="border-t border-[var(--color-border)] align-top" data-testid="ledger-row">
							<td class="px-3 py-2 font-mono text-xs text-[var(--color-text)]">
								{str(entry.key) ?? '—'}
							</td>
							<td class="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)] break-all">
								{fmtValue(entry.value)}
								{#if str(entry.computed_by)}
									<span class="ml-1 text-[10px] italic opacity-70">via {entry.computed_by}</span>
								{/if}
							</td>
							<td class="px-3 py-2">
								<span
									class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
									style={`background:${p.bg};color:${p.fg};border-color:${p.bd}`}
									data-testid="provenance-chip"
									data-provenance-source={str(entry.source) ?? 'default'}
								>
									{p.label}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p
			class="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]"
			data-testid="ledger-empty"
		>
			No knobs recorded for this run
		</p>
	{/if}

	<!-- Reproducibility spine -->
	<div class="space-y-1.5" data-testid="reproducibility-spine">
		<div class="flex flex-wrap items-center gap-2">
			{#if masterSeed != null}
				<span
					class="inline-flex items-center rounded-full border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-success-text)]"
					data-testid="reproducible-badge"
				>
					Reproducible
				</span>
				<span class="font-mono text-xs text-[var(--color-text-muted)]">
					seed <span class="text-[var(--color-text)]">{masterSeed}</span>
				</span>
			{/if}
			{#if inputHash}
				<span class="font-mono text-xs text-[var(--color-text-muted)]">
					input <span class="text-[var(--color-text)]">{inputHash}</span>
				</span>
			{/if}
		</div>
		{#if !outputSha || !hasMastering}
			<p class="text-[11px] text-[var(--color-text-muted)]" data-testid="reserved-note">
				{#if !outputSha && !hasMastering}output hash + mastering reserved — not on the wire yet
				{:else if !outputSha}output hash reserved — not on the wire yet
				{:else}mastering reserved — not on the wire yet{/if}
			</p>
		{/if}
	</div>

	<!-- Footer: artifact + duration -->
	{#if artifactUrl || durationSeconds != null}
		<div class="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
			{#if artifactUrl}
				<a
					href={safeHref(artifactUrl)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline"
					data-testid="artifact-link"
				>
					View rendered video
				</a>
			{/if}
			{#if durationSeconds != null}
				<Duration seconds={durationSeconds} />
			{/if}
		</div>
	{/if}
</div>
