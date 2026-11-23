<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- the anchors here are
	   the external redesigned-site URL and the html_render artifact URLs from the
	   run output, never internal routes. */
	// Redesign / web-design output → before/after pairs + (web_design_v2) a live,
	// interactive preview and the automated-verification report.
	//   • visuals[]{label, role:before/after, image_url, video_url?}
	//   • live_html_url         → sandboxed <iframe> live preview (interactive)
	//   • pdf_url / redesign_job_id → downloads
	//   • verification_status + verification_report → the "only working designs
	//     complete" gate, surfaced as a pass/fail panel with findings.
	import ScoreRing from './_shared/ScoreRing.svelte';
	import Lightbox, { type LightboxItem } from './_shared/Lightbox.svelte';
	import { Pill } from '$lib/components/ui';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { probeFramePreview, type FramePreviewState } from '$lib/utils/frame-preview';
	import type { RendererProps } from './registry';
	import type { RedesignOutput, RedesignVisual } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as RedesignOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const style = $derived(str(data.style));
	const a11y = $derived(num(data.accessibility_score));
	const url = $derived(str(data.url));
	const jobId = $derived(str(data.redesign_job_id));
	const visuals = $derived<RedesignVisual[]>(Array.isArray(data.visuals) ? data.visuals : []);

	// Live, interactive preview — explicit URL (web_design_v2) or derived from the
	// job id. Both resolve through the orchestrator redesign proxy (/api/redesign/*),
	// which forwards to html_render; works in prod (server.js) and dev.
	// scopedMediaUrl: the <iframe>/<a>/<img>/<video> below are fetched by the browser
	// itself, which cannot carry our X-Active-Tenant-Id header — while a super-admin
	// browses another tenant those requests would 404 without the query-param form.
	const liveUrl = $derived(
		scopedMediaUrl(
			str(data.live_html_url) ?? (jobId ? `/api/redesign/jobs/${jobId}/html` : undefined)
		)
	);
	const pdfUrl = $derived(
		scopedMediaUrl(str(data.pdf_url) ?? (jobId ? `/api/redesign/jobs/${jobId}/pdf` : undefined))
	);

	// Verification report (assembly mode). status: passed | failed | skipped.
	const verification = $derived(
		data.verification_report && typeof data.verification_report === 'object'
			? data.verification_report
			: undefined
	);
	const verStatus = $derived(str(data.verification_status) ?? str(verification?.status));
	const findings = $derived(Array.isArray(verification?.findings) ? verification.findings : []);
	const hardFindings = $derived(findings.filter((f) => str(f.severity) === 'hard'));
	const advisoryFindings = $derived(findings.filter((f) => str(f.severity) === 'advisory'));

	// Probe the preview before framing it: a refused/erroring frame paints blank
	// and fires no `error`, so without this the operator saw an empty white box.
	let previewState = $state<FramePreviewState | 'checking'>('checking');
	$effect(() => {
		const target = liveUrl;
		if (!target) return;
		let cancelled = false;
		previewState = 'checking';
		void probeFramePreview(target).then((state) => {
			if (!cancelled) previewState = state;
		});
		return () => {
			cancelled = true;
		};
	});

	type View = 'preview' | 'screenshots';
	let view = $state<View>('preview');
	// Fall back to screenshots when there's no live preview to show.
	$effect(() => {
		if (!liveUrl && view === 'preview') view = 'screenshots';
	});

	type Pane = {
		rec: RedesignVisual;
		image?: string | null;
		video?: string | null;
		role: string;
		label: string;
	};
	const pane = (v: RedesignVisual): Pane => ({
		rec: v,
		image: scopedMediaUrl(str(v.image_url)),
		video: scopedMediaUrl(str(v.video_url)),
		role: (str(v.role) ?? '').toLowerCase(),
		label: str(v.label) ?? 'Design'
	});

	type Group = { before?: Pane; after?: Pane; others: Pane[] };
	const groups = $derived.by((): [string, Group][] => {
		const m: Record<string, Group> = {};
		const order: string[] = [];
		for (const v of visuals) {
			const p = pane(v);
			if (!m[p.label]) {
				m[p.label] = { others: [] };
				order.push(p.label);
			}
			const g = m[p.label];
			if (p.role === 'before') g.before = p;
			else if (p.role === 'after') g.after = p;
			else g.others.push(p);
		}
		return order.map((label) => [label, m[label]]);
	});

	// Flat lightbox over every visual.
	const lbItems = $derived(
		visuals.map((v): LightboxItem => {
			const p = pane(v);
			return p.video
				? { url: p.video, kind: 'video', label: p.label }
				: { url: p.image ?? '', kind: 'image', label: p.label };
		})
	);
	let lbOpen = $state(false);
	let lbIndex = $state(0);
	const openVisual = (v: RedesignVisual) => {
		const idx = visuals.indexOf(v);
		if (idx >= 0) {
			lbIndex = idx;
			lbOpen = true;
		}
	};

	const verTone = $derived<'success' | 'danger' | 'neutral'>(
		verStatus === 'passed' ? 'success' : verStatus === 'failed' ? 'danger' : 'neutral'
	);
</script>

<div class="space-y-4" data-testid="redesign-compare">
	<div class="flex flex-wrap items-center gap-3">
		{#if a11y != null}<ScoreRing value={a11y} size={64} caption="Accessibility" />{/if}
		<div class="flex flex-wrap items-center gap-2">
			{#if style}<Pill tone="accent">{style}</Pill>{/if}
			{#if verStatus}
				<span data-testid="verification-badge">
					<Pill tone={verTone}>Verification: {verStatus}</Pill>
				</span>
			{/if}
			{#if liveUrl}
				<a
					href={safeHref(liveUrl)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline"
				>
					Open ↗
				</a>
			{/if}
			{#if pdfUrl}
				<a
					href={safeHref(pdfUrl)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline"
				>
					PDF
				</a>
			{/if}
			{#if url}
				<a
					href={safeHref(url)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline break-all"
				>
					{url}
				</a>
			{/if}
		</div>
	</div>

	<!-- View toggle: live interactive preview vs. rendered screenshots. -->
	{#if liveUrl && groups.length > 0}
		<div class="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
			{#each [{ id: 'preview', label: 'Live preview' }, { id: 'screenshots', label: 'Screenshots' }] as tab (tab.id)}
				<button
					type="button"
					onclick={() => (view = tab.id as View)}
					class="px-3 py-1 text-sm rounded-[var(--radius-sm)] {view === tab.id
						? 'bg-[var(--color-accent)] text-white'
						: 'text-[var(--color-text-muted)]'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if liveUrl && view === 'preview'}
		{#if previewState === 'ok'}
			<!-- Sandboxed: scripts run (htmx/Alpine) but the artifact is treated as an
			     opaque origin, so it cannot touch the app's origin/cookies/storage. -->
			<iframe
				src={liveUrl}
				title="Live design preview"
				sandbox="allow-scripts"
				referrerpolicy="no-referrer"
				loading="lazy"
				class="w-full h-[70vh] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white"
				data-testid="live-preview-frame"
			></iframe>
		{:else if previewState === 'checking'}
			<div
				class="flex h-[70vh] w-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)]"
				data-testid="live-preview-checking"
			>
				Loading preview…
			</div>
		{:else}
			<div
				class="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center"
				data-testid="live-preview-unavailable"
				role="status"
			>
				<p class="text-sm font-medium text-[var(--color-text)]">Preview unavailable</p>
				<p class="text-xs text-[var(--color-text-muted)]">
					The redesigned page can't be shown inside this panel.
				</p>
				<a
					href={safeHref(liveUrl)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline"
					data-testid="live-preview-open"
				>
					Open in new tab ↗
				</a>
			</div>
		{/if}
	{/if}

	{#if (!liveUrl || view === 'screenshots') && groups.length > 0}
		{#each groups as [label, g] (label)}
			<div class="space-y-1.5">
				<p class="text-kicker text-[var(--color-text-muted)]">{label}</p>
				{#if g.before && g.after}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						{#each [{ p: g.before, tag: 'Before' }, { p: g.after, tag: 'After' }] as cell (cell.tag)}
							<figure class="space-y-1">
								<figcaption class="text-xs font-medium text-[var(--color-text-muted)]">
									{cell.tag}
								</figcaption>
								<button
									type="button"
									onclick={() => openVisual(cell.p.rec)}
									class="block w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
								>
									{#if cell.p.video}
										<video src={cell.p.video} preload="metadata" muted class="w-full"></video>
									{:else if cell.p.image}
										<img
											src={cell.p.image}
											alt={`${label} ${cell.tag}`}
											loading="lazy"
											class="w-full"
										/>
									{/if}
								</button>
							</figure>
						{/each}
					</div>
				{:else}
					{@const flat = [g.before, g.after, ...g.others].filter((x): x is Pane => !!x)}
					<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
						{#each flat as p, idx (idx)}
							<button
								type="button"
								onclick={() => openVisual(p.rec)}
								class="block w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
							>
								{#if p.video}
									<video src={p.video} preload="metadata" muted class="w-full"></video>
								{:else if p.image}
									<img src={p.image} alt={label} loading="lazy" class="w-full" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	<!-- Verification report: the automated gate that let this design complete. -->
	{#if verStatus}
		<div
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-2"
			data-testid="verification-panel"
		>
			<div class="flex items-center gap-2">
				<Pill tone={verTone}>{verStatus}</Pill>
				<span class="text-sm text-[var(--color-text-muted)]">
					{hardFindings.length} blocking · {advisoryFindings.length} advisory
				</span>
			</div>
			{#if hardFindings.length > 0}
				<ul class="text-sm list-disc pl-5 space-y-0.5">
					{#each hardFindings as f, i (i)}
						<li><span class="font-medium">{str(f.check)}</span>: {str(f.message)}</li>
					{/each}
				</ul>
			{/if}
			{#if advisoryFindings.length > 0}
				<ul class="text-xs list-disc pl-5 space-y-0.5 text-[var(--color-text-muted)]">
					{#each advisoryFindings as f, i (i)}
						<li>{str(f.check)}: {str(f.message)}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<Lightbox items={lbItems} bind:open={lbOpen} bind:index={lbIndex} />
</div>
