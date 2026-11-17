<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- the only anchor here
	   is the external scored-site URL from the run output, never an internal route. */
	// The analysis_service scorecard scans (SEO audit / CRO audit / marketing
	// scorecard). Dispatch is on the output's `project_type` (auditProjectType); only
	// a run older than that field falls back to its breakdown-array key. Each type
	// gets its own title and signature section (SEO: indexability + SERP preview;
	// CRO: conversion journey + experiment backlog; scorecard: dimension weights with
	// pointers to the SEO/CRO audits), on top of the shared score ring, per-bucket
	// bars, quick-win/strategic lists and AI blocks. A bucket with a null score is
	// "Not measured — <reason>", never a 0 or a 100, and the `ai` block's status is
	// stated, not inferred.
	import ScoreRing from './_shared/ScoreRing.svelte';
	import { Pill } from '$lib/components/ui';
	import { severityTone } from '$lib/utils/severity';
	import { gradeTone } from '$lib/utils/grade';
	import type { RendererProps } from './registry';
	import type {
		AuditScorecardOutput,
		AuditBucket,
		AuditRef,
		AuditAssessment
	} from './stage-outputs';
	import { auditProjectType, aiStatusLine, type AuditProjectType } from '$lib/utils/audit-kind';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as AuditScorecardOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	// Per-type descriptor, keyed by project_type.
	type Kind = {
		bucketArray: 'groups' | 'subsections' | 'dimensions';
		itemKey: 'group' | 'section' | 'dimension';
		caption: string;
		title: string;
		testid: string;
		llmKey: 'llm_assessments' | 'llm_judgments' | null;
	};
	const KINDS: Record<AuditProjectType, Kind> = {
		seo_audit: {
			bucketArray: 'groups',
			itemKey: 'group',
			caption: 'SEO Health',
			title: 'Search & AI discoverability audit',
			testid: 'seo-audit-scorecard',
			llmKey: null
		},
		cro_audit: {
			bucketArray: 'subsections',
			itemKey: 'section',
			caption: 'Conversion',
			title: 'Conversion audit',
			testid: 'cro-audit-scorecard',
			llmKey: 'llm_judgments'
		},
		marketing_scorecard: {
			bucketArray: 'dimensions',
			itemKey: 'dimension',
			caption: 'Marketing',
			title: 'Go-to-market scorecard',
			testid: 'marketing-scorecard',
			llmKey: 'llm_assessments'
		}
	};
	const projectType = $derived(auditProjectType(data as Record<string, unknown>));
	const kind = $derived(KINDS[projectType]);
	const aiLine = $derived(aiStatusLine(data.ai));
	const AI_TONE_CLS = {
		neutral: 'text-[var(--color-text-muted)]',
		success: 'text-[var(--color-success-text)]',
		warning: 'text-[var(--color-warning-text)]',
		danger: 'text-[var(--color-danger-text)]'
	} as const;
	const facts = $derived(
		data.facts && typeof data.facts === 'object' ? (data.facts as Record<string, unknown>) : {}
	);
	const obj = (v: unknown): Record<string, unknown> | undefined =>
		v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

	// ── SEO signature: indexability + SERP preview (from deterministic facts) ──
	const seo = $derived.by(() => {
		if (projectType !== 'seo_audit') return undefined;
		const idx = obj(facts.indexable);
		const title = str(obj(facts.title)?.text);
		const meta = str(obj(facts.meta_description)?.text);
		if (!idx && !title && !meta) return undefined;
		return {
			indexable: typeof idx?.value === 'boolean' ? (idx.value as boolean) : undefined,
			reasons: Array.isArray(idx?.reasons)
				? (idx.reasons as unknown[]).map(str).filter(Boolean)
				: [],
			title,
			meta
		};
	});

	// ── CRO signature: conversion journey (funnel) + experiment backlog ──
	type Stage = { label: string; score: number | null; note?: string };
	const journey = $derived.by<Stage[]>(() => {
		if (projectType !== 'cro_audit') return [];
		const stages = obj(facts.journey)?.stages;
		return (Array.isArray(stages) ? stages : [])
			.map((raw) => {
				const st = obj(raw) ?? {};
				const measured = st.measured !== false;
				return {
					label: str(st.label) ?? str(st.stage) ?? '',
					score: measured ? (num(st.score) ?? null) : null,
					note: str(st.reason) ?? str(st.note)
				};
			})
			.filter((st) => st.label);
	});
	const experiments = $derived(
		projectType === 'cro_audit'
			? (Array.isArray(data.findings) ? data.findings : [])
					.map((f) => ({
						title: str(f.title) ?? str(f.check_id) ?? '',
						hypothesis: str(f.experiment?.hypothesis),
						metric: str(f.experiment?.primary_metric),
						variant: str(f.experiment?.variant)
					}))
					.filter((e) => e.hypothesis)
			: []
	);

	// ── Scorecard signature: dimension weights, with pointers to the source audit ──
	type Weight = { dimension: string; weight: number; score: number | null; pointer?: string };
	const POINTER_LABEL: Record<string, string> = {
		seo_audit: 'SEO audit',
		cro_audit: 'CRO audit'
	};
	const weights = $derived.by<Weight[]>(() => {
		if (projectType !== 'marketing_scorecard') return [];
		const sources = Array.isArray(facts.dimension_sources) ? facts.dimension_sources : [];
		return sources
			.map((raw) => {
				const d = obj(raw) ?? {};
				const pointer = d.reference_only === true ? str(d.report_pointer) : undefined;
				return {
					dimension: str(d.dimension) ?? '',
					weight: num(d.weight) ?? 0,
					score: num(d.score) ?? null,
					pointer: pointer ? (POINTER_LABEL[pointer] ?? pointer) : undefined
				};
			})
			.filter((w) => w.dimension);
	});

	const overall = $derived(num(data.overall_score));
	const grade = $derived(str(data.grade));
	const url = $derived(str(data.url));
	const llmEnriched = $derived(data.llm_enriched === true);

	// "great report" enrichment (present only when the run opted into include_llm);
	// every block below is presence-gated so an un-enriched scorecard renders as before.
	const execSummary = $derived.by(() => {
		const e = data.exec_summary;
		const summary = str(e?.summary);
		if (!summary) return undefined;
		return {
			summary,
			soWhat: str(e?.so_what) ?? '',
			roadmap: Array.isArray(e?.roadmap) ? e.roadmap.map(str).filter((s): s is string => !!s) : []
		};
	});
	const projection = $derived.by(() => {
		const p = data.projection;
		const projected = num(p?.projected);
		const baseline = num(p?.baseline);
		const count = Array.isArray(p?.removed) ? p.removed.length : 0;
		// Only a projection that actually models >= 1 fix is meaningful — without the
		// count gate an empty/zero projection renders "top 0 finding(s): 0 -> 0 (+0 pts)".
		if (projected === undefined || baseline === undefined || count === 0) return undefined;
		const delta = Math.round(num(p?.delta) ?? projected - baseline);
		return {
			baseline: Math.round(baseline),
			projected: Math.round(projected),
			// sign-safe: a regression projection shows "(-N pts)", never "(+-N pts)".
			deltaLabel: (delta >= 0 ? '+' : '') + delta,
			count
		};
	});
	// check_id -> supported verdict (absent key = no verdict, distinct from false).
	const groundingById = $derived.by(() => {
		const out: Record<string, boolean> = {};
		for (const g of Array.isArray(data.grounding) ? data.grounding : []) {
			const id = str(g.check_id);
			if (id !== undefined) out[id] = g.supported === true;
		}
		return out;
	});
	// Resolve a roadmap check_id to its finding title (id-locked; unknown id dropped).
	const titleById = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const r of [
			...(Array.isArray(data.quick_wins) ? data.quick_wins : []),
			...(Array.isArray(data.strategic) ? data.strategic : [])
		]) {
			const id = str(r.check_id);
			const t = str(r.title);
			if (id !== undefined && t !== undefined) out[id] = t;
		}
		return out;
	});
	const roadmap = $derived(
		(execSummary?.roadmap ?? []).map((id) => titleById[id]).filter((t): t is string => !!t)
	);

	// score `null` = not measured: shown as "Not measured — <reason>", no bar. A
	// missing score is NEVER coerced to 0 (or 100).
	type Bucket = {
		label: string;
		score: number | null;
		weight: number;
		count: number;
		note?: string;
	};
	const buckets = $derived<Bucket[]>(
		(Array.isArray(data[kind.bucketArray]) ? (data[kind.bucketArray] as AuditBucket[]) : [])
			.map((b) => {
				const score = b.measured === false ? null : (num(b.score) ?? null);
				return {
					label: str(b[kind.itemKey]) ?? '',
					score,
					weight: num(b.weight) ?? 0,
					count: num(b.count) ?? 0,
					note: score === null ? (str(b.note) ?? 'no data returned for this check') : undefined
				};
			})
			.filter((b) => b.label)
			.sort((a, b) => b.weight - a.weight)
	);

	type Ref = {
		check_id: string;
		bucket: string;
		title: string;
		severity: string;
		rank?: number;
		fixProse?: string;
		rationale?: string;
		example?: string;
		grounded?: boolean; // undefined = no grounding verdict for this finding
	};
	const toRefs = (v: AuditRef[] | undefined): Ref[] =>
		(Array.isArray(v) ? v : []).map((r) => {
			const id = str(r.check_id) ?? '';
			const fix = str(r.recommendation?.fix_prose);
			return {
				check_id: id,
				bucket: str(r[kind.itemKey]) ?? '',
				title: str(r.title) ?? '',
				severity: str(r.severity) ?? 'info',
				rank: num(r.rank),
				fixProse: fix,
				rationale: fix ? str(r.recommendation?.rationale) : undefined,
				example: fix ? str(r.recommendation?.example) : undefined,
				grounded: id in groundingById ? groundingById[id] : undefined
			};
		});
	const quickWins = $derived(toRefs(data.quick_wins));
	const strategic = $derived(toRefs(data.strategic));

	type Assessment = {
		element: string;
		score: number | null;
		assessment: string;
		suggestion: string;
	};
	const assessments = $derived<Assessment[]>(
		kind.llmKey && Array.isArray(data[kind.llmKey])
			? (data[kind.llmKey] as AuditAssessment[]).map((a) => ({
					element: str(a.element) ?? '',
					score: num(a.score) ?? null,
					assessment: str(a.assessment) ?? '',
					suggestion: str(a.suggestion) ?? ''
				}))
			: []
	);

	// bucket/overall scores are 0-100 already (unlike the 0-1 critique bars).
	const barTone = (v: number) =>
		v >= 80 ? 'var(--color-success)' : v >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

	const label = (s: string) => s.replace(/_/g, ' ');

	const refBuckets = $derived([
		{ title: 'Quick wins', refs: quickWins },
		{ title: 'Strategic', refs: strategic }
	]);
</script>

<div class="space-y-4" data-testid={kind.testid}>
	<div class="flex flex-wrap items-center gap-4">
		{#if overall != null}
			<ScoreRing value={overall} max={100} size={84} caption={kind.caption} />
		{:else if data.overall_score === null}
			<p class="text-sm text-[var(--color-text-muted)]" data-testid="audit-overall-not-measured">
				Overall score: not measured
			</p>
		{/if}
		<div class="min-w-0 flex-1 space-y-1">
			<div class="flex items-center gap-2">
				<span class="text-sm font-semibold text-[var(--color-text)]" data-testid="audit-title"
					>{kind.title}</span
				>
				{#if grade}<Pill tone={gradeTone(grade)}>{grade}</Pill>{/if}
				{#if llmEnriched}<Pill tone="neutral">AI-annotated</Pill>{/if}
			</div>
			{#if aiLine}
				<p
					class={`text-xs ${AI_TONE_CLS[aiLine.tone]}`}
					data-testid="audit-ai-status"
					data-status={aiLine.status}
				>
					{aiLine.text}
				</p>
			{/if}
			{#if url}
				<a
					href={safeHref(url)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline break-all">{url}</a
				>
			{/if}
		</div>
	</div>

	{#if seo}
		<div
			class="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
			data-section="serp-preview"
		>
			<div class="flex items-center gap-2">
				<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
					Search preview
				</p>
				{#if seo.indexable === true}<Pill tone="success">Indexable</Pill>
				{:else if seo.indexable === false}<Pill tone="danger">Not indexable</Pill>{/if}
			</div>
			{#if seo.indexable === false && seo.reasons.length}
				<p class="text-xs text-[var(--color-danger-text)]">{seo.reasons.join('; ')}</p>
			{/if}
			{#if url}<p class="truncate text-xs text-[var(--color-text-muted)]">{url}</p>{/if}
			<p class="text-sm font-medium text-[var(--color-accent)]">
				{seo.title ?? 'Not measured — no <title> found'}
			</p>
			<p class="text-xs text-[var(--color-text-muted)]">
				{seo.meta ?? 'Not measured — no meta description found'}
			</p>
		</div>
	{/if}

	{#if journey.length}
		<div class="space-y-1.5" data-section="conversion-journey">
			<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				Conversion journey
			</p>
			<ol class="space-y-1">
				{#each journey as st, i (st.label + '-' + i)}
					<li class="grid grid-cols-[120px_1fr_auto] items-center gap-2 text-sm">
						<span class="text-[var(--color-text-muted)]">{i + 1}. {st.label}</span>
						{#if st.score === null}
							<span class="col-span-2 text-xs text-[var(--color-text-muted)]"
								>Not measured — {st.note ?? 'no data for this stage'}</span
							>
						{:else}
							<span class="h-2 rounded-full bg-[var(--color-surface-strong)] overflow-hidden">
								<span
									class="block h-full rounded-full"
									style={`width:${Math.round(st.score)}%;background:${barTone(Math.round(st.score))}`}
								></span>
							</span>
							<span class="tabular-nums text-xs text-[var(--color-text-muted)]"
								>{Math.round(st.score)}</span
							>
						{/if}
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	{#if experiments.length}
		<div class="space-y-1.5" data-testid="cro-experiments">
			<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				Experiment backlog
			</p>
			<ol class="space-y-1.5">
				{#each experiments as e, i (e.title + '-' + i)}
					<li
						class="space-y-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-sm"
					>
						<p class="text-[var(--color-text)]">{e.hypothesis}</p>
						{#if e.variant}<p class="text-xs text-[var(--color-text-muted)]">
								Variant: {e.variant}
							</p>{/if}
						{#if e.metric}<p class="text-xs text-[var(--color-text-muted)]">
								Measure: {e.metric}
							</p>{/if}
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	{#if weights.length}
		<div class="space-y-1.5" data-testid="mkt-weights">
			<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				Dimension weights
			</p>
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-xs text-[var(--color-text-muted)]">
						<th class="font-medium">Dimension</th>
						<th class="font-medium">Weight</th>
						<th class="font-medium">Score</th>
						<th class="font-medium">Details</th>
					</tr>
				</thead>
				<tbody>
					{#each weights as w, i (w.dimension + '-' + i)}
						<tr class="border-t border-[var(--color-border)]">
							<td class="py-1 capitalize text-[var(--color-text)]">{label(w.dimension)}</td>
							<td class="py-1 tabular-nums text-[var(--color-text-muted)]"
								>{Math.round(w.weight * 100)}%</td
							>
							<td class="py-1 tabular-nums text-[var(--color-text-muted)]"
								>{w.score === null ? 'Not measured' : Math.round(w.score)}</td
							>
							<td class="py-1 text-xs text-[var(--color-text-muted)]"
								>{w.pointer ? `See the ${w.pointer}` : 'Scored here'}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if execSummary}
		<div
			class="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
			data-testid="audit-exec-summary"
		>
			<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				Executive summary
			</p>
			<p class="text-sm text-[var(--color-text)]">{execSummary.summary}</p>
			{#if execSummary.soWhat}<p class="text-sm text-[var(--color-text-muted)]">
					{execSummary.soWhat}
				</p>{/if}
			{#if roadmap.length}
				<div class="pt-1">
					<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
						Do these first
					</p>
					<ol class="list-decimal pl-5 text-sm text-[var(--color-text)]">
						{#each roadmap as t, i (t + '-' + i)}<li>{t}</li>{/each}
					</ol>
				</div>
			{/if}
		</div>
	{/if}

	{#if projection}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="audit-projection">
			Fixing the top {projection.count} finding(s):
			<span class="font-semibold text-[var(--color-text)]"
				>{projection.baseline} → {projection.projected}</span
			>
			<span class="text-[var(--color-accent)]">({projection.deltaLabel} pts)</span>
		</p>
	{/if}

	{#if buckets.length}
		<div class="space-y-1.5">
			{#each buckets as b, i (b.label + '-' + i)}
				<div class="grid grid-cols-[160px_1fr_auto] items-center gap-2 text-sm">
					<span class="text-[var(--color-text-muted)] truncate capitalize">
						{label(b.label)}{#if b.count > 0}<span class="text-xs"> ({b.count})</span>{/if}
					</span>
					{#if b.score === null}
						<span
							class="col-span-2 text-xs text-[var(--color-text-muted)]"
							data-testid="audit-bucket-not-measured">Not measured — {b.note}</span
						>
					{:else}
						<span class="h-2 rounded-full bg-[var(--color-surface-strong)] overflow-hidden">
							<span
								class="block h-full rounded-full"
								style={`width:${Math.round(b.score)}%;background:${barTone(Math.round(b.score))}`}
							></span>
						</span>
						<span class="tabular-nums text-[var(--color-text-muted)] text-xs"
							>{Math.round(b.score)}</span
						>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#each refBuckets as bucket (bucket.title)}
		{#if bucket.refs.length}
			<div class="space-y-1.5">
				<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
					{bucket.title}
				</p>
				<ol class="space-y-1.5">
					{#each bucket.refs as f, i (f.check_id + '-' + i)}
						<li
							class="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
						>
							<div class="flex items-start justify-between gap-2">
								<p class="text-sm text-[var(--color-text)]">
									{#if f.rank != null}<span
											class="mr-1 tabular-nums text-xs font-semibold text-[var(--color-text-muted)]"
											>#{f.rank}</span
										>{/if}{f.title || f.check_id}
								</p>
								<span class="flex shrink-0 items-center gap-1.5">
									{#if f.grounded === true}<Pill tone="success">grounded</Pill
										>{:else if f.grounded === false}<Pill tone="warning">unverified</Pill>{/if}
									{#if f.bucket}<Pill tone="neutral">{label(f.bucket)}</Pill>{/if}
									{#if f.severity}<Pill tone={severityTone(f.severity)}>{f.severity}</Pill>{/if}
								</span>
							</div>
							{#if f.fixProse}
								<div class="space-y-1 border-t border-[var(--color-border)] pt-1.5">
									<p class="text-sm text-[var(--color-text)]">{f.fixProse}</p>
									{#if f.rationale}<p class="text-xs text-[var(--color-text-muted)]">
											{f.rationale}
										</p>{/if}
									{#if f.example}<pre
											class="overflow-x-auto rounded bg-[var(--color-surface-strong)] p-2 text-xs whitespace-pre-wrap text-[var(--color-text-muted)]">{f.example}</pre>{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</div>
		{/if}
	{/each}

	{#if assessments.length}
		<div class="space-y-1.5">
			<p class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
				AI copy review
			</p>
			<ol class="space-y-1.5">
				{#each assessments as a, i (a.element + '-' + i)}
					<li
						class="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="text-sm font-medium capitalize text-[var(--color-text)]"
								>{label(a.element)}</span
							>
							<span class="tabular-nums text-xs text-[var(--color-text-muted)]"
								>{a.score === null ? 'not scored' : Math.round(a.score)}</span
							>
						</div>
						{#if a.assessment}<p class="text-sm text-[var(--color-text-muted)]">
								{a.assessment}
							</p>{/if}
						{#if a.suggestion}<p class="text-xs text-[var(--color-text-muted)]">
								→ {a.suggestion}
							</p>{/if}
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>
