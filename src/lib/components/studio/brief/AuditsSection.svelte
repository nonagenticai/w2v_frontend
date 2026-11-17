<script lang="ts">
	import type { ProjectBrief } from '$lib/types';
	import type { PickType } from '$lib/studio/project-request';
	import { typeIsScanOnlyAudit } from '$lib/studio/project-request';

	let {
		type,
		brief = $bindable<ProjectBrief>({})
	}: {
		type: PickType;
		brief?: ProjectBrief;
	} = $props();

	// seo_audit / cro_audit: two scalar-flag opt-ins that ride through briefFields
	// (buildBrief spreads them). include_llm turns on the AI review layers
	// (no score change, no voice/video); generate_video opts the whole narrated-video chain
	// in (default off → the scorecard is the deliverable). Off → drop the key so the
	// orchestrator's presence checks see it absent.
	//
	// The narrated-video variant exists only for non-scan-only audits (seo_audit /
	// cro_audit today); a scan-only audit (marketing_scorecard) hides its
	// generate_video toggle. Driven by the TYPE_BRIEF descriptor so a new audit
	// type is classified by its `audit.scanOnly` flag, not a hand-listed union.
	const showAuditVideoOption = $derived(!typeIsScanOnlyAudit(type));
	const auditIncludeLlmEnabled = $derived(brief.include_llm === true);
	function setAuditIncludeLlm(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, include_llm: true };
		} else {
			// Dropping AI analysis also drops the now-meaningless intent steer.
			const { include_llm: _drop, intent: _dropIntent, ...rest } = brief;
			brief = rest;
		}
	}
	// Optional audience / goal steering the enriched recommendation prose + exec
	// summary. Only meaningful with include_llm, so the input is shown only then.
	const auditIntent = $derived(typeof brief.intent === 'string' ? brief.intent : '');
	function setAuditIntent(value: string) {
		const v = value.trim();
		if (v) {
			brief = { ...brief, intent: v };
		} else {
			const { intent: _drop, ...rest } = brief;
			brief = rest;
		}
	}
	const auditGenerateVideoEnabled = $derived(brief.generate_video === true);
	function setAuditGenerateVideo(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, generate_video: true };
		} else {
			const { generate_video: _drop, ...rest } = brief;
			brief = rest;
		}
	}
	// SEO-only: opt into the cross-page sitemap-crawl internal-linking audit (orphan /
	// broken-link / hub signals). Writes brief.cross_page_linking = true / drops the key.
	const showSeoCrossPage = $derived(type === 'seo_audit');
	const auditCrossPageEnabled = $derived(brief.cross_page_linking === true);
	function setAuditCrossPage(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, cross_page_linking: true };
		} else {
			const { cross_page_linking: _drop, ...rest } = brief;
			brief = rest;
		}
	}
</script>

<!-- Audit opt-ins (seo_audit / cro_audit / marketing_scorecard). Ride through
     briefFields (buildBrief spreads them). include_llm adds the AI review
     (recommendations, exec summary, per-type layers) and never a voice/video
     step; generate_video (seo/cro only) is the separate narrated-video opt-in. -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="audit-include-llm-toggle"
		checked={auditIncludeLlmEnabled}
		onchange={(e) => setAuditIncludeLlm((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]"> Add AI analysis </span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Adds an AI review on top of the automated checks: written fix advice for each finding, an
			executive summary, and analysis specific to this audit. The score stays the same, and no voice
			or video is made. If the AI review fails, you still get the report, and it says why.
		</span>
	</span>
</label>
{#if auditIncludeLlmEnabled}
	<label
		class="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
	>
		<span class="text-sm font-medium text-[var(--color-text-muted)]"
			>Audience / goal (optional)</span
		>
		<input
			type="text"
			data-testid="audit-intent-input"
			value={auditIntent}
			onchange={(e) => setAuditIntent((e.currentTarget as HTMLInputElement).value)}
			placeholder="e.g. B2B SaaS buyers evaluating pricing"
			class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:ring-2 focus:ring-[var(--color-accent)]"
		/>
		<span class="text-xs text-[var(--color-text-muted)]">
			Steers the recommendation prose + executive summary. Absent → generic recommendations.
		</span>
	</label>
{/if}
{#if showAuditVideoOption}
	<label
		class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
	>
		<input
			type="checkbox"
			data-testid="audit-generate-video-toggle"
			checked={auditGenerateVideoEnabled}
			onchange={(e) => setAuditGenerateVideo((e.currentTarget as HTMLInputElement).checked)}
			class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
		/>
		<span>
			<span class="block text-sm font-medium text-[var(--color-text-muted)]">
				Also generate a narrated video
			</span>
			<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
				Turn the scorecard into a short narrated walkthrough video. Off by default — the scored
				scorecard is the deliverable. When on, a video deliverable appears below and the narration
				voice is under Review → Advanced.
			</span>
		</span>
	</label>
{/if}
{#if showSeoCrossPage}
	<label
		class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
	>
		<input
			type="checkbox"
			data-testid="audit-cross-page-toggle"
			checked={auditCrossPageEnabled}
			onchange={(e) => setAuditCrossPage((e.currentTarget as HTMLInputElement).checked)}
			class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
		/>
		<span>
			<span class="block text-sm font-medium text-[var(--color-text-muted)]">
				Crawl linked pages
			</span>
			<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
				Crawl the site's sitemap for orphan-page, broken-link and hub signals across pages. Slower —
				off by default (a single-page audit otherwise).
			</span>
		</span>
	</label>
{/if}
