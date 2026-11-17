<script lang="ts">
	// ShieldCheck dropped with the dormant app_review option below — re-add it
	// when app_review is brought back.
	import {
		Sparkles,
		GraduationCap,
		Box,
		Globe,
		Headphones,
		PenTool,
		Layers,
		MousePointerClick,
		Clapperboard,
		Film,
		Search,
		Gauge,
		BarChart3
	} from '@lucide/svelte';
	import { PROJECT_TYPE_LABELS, type ProjectType } from '$lib/types';
	import { CREATABLE_PROJECT_TYPES, type PickType } from '$lib/studio/project-request';

	interface Props {
		value: ProjectType;
	}

	let { value = $bindable<ProjectType>('promo') }: Props = $props();

	// Match the codebase pattern from wizard/DeliverableCard.svelte: type via
	// `typeof <some lucide icon>` since lucide-svelte's exports are all
	// structurally compatible.
	type LucideIcon = typeof Sparkles;

	// Per-type icon + blurb. The createable type SET + ORDER live in
	// CREATABLE_PROJECT_TYPES (shared with the /projects filter so they can't
	// drift); this map only supplies presentation. `app_review` is dormant and
	// `lesson` is child-only, so neither is in the shared list — re-add the
	// ShieldCheck import + an `app_review` entry here when it's revived.
	const meta: Record<PickType, { icon: LucideIcon; blurb: string }> = {
		promo: {
			icon: Sparkles,
			blurb: 'Short-form marketing video. Aspect variants as deliverables.'
		},
		course: {
			icon: GraduationCap,
			blurb: 'Course of multiple lessons, each a child project.'
		},
		website_review: {
			icon: Globe,
			blurb: 'Critique a website (PDF report) — optionally turn it into a narrated review video.'
		},
		web_design: {
			icon: PenTool,
			blurb: 'Describe a design → get a self-contained HTML page (with screenshot + PDF).'
		},
		web_design_v2: {
			icon: Layers,
			blurb:
				'Assembled from vetted components, interactive, and auto-verified (renders, a11y, no JS errors) before it completes.'
		},
		demo_video: {
			icon: MousePointerClick,
			blurb: 'Auto-generate a narrated, real-interaction (click/type/drag) demo of a web app.'
		},
		showcase: {
			icon: Clapperboard,
			blurb:
				'A narrated, multi-step live walkthrough — generate one from a URL, or upload a hand-authored recording package.'
		},
		action_reel: {
			icon: Film,
			blurb:
				'Cut your own footage to the beat of a music bed — upload clips, review the picks, get a reel.'
		},
		seo_audit: {
			icon: Search,
			blurb:
				'Score a site for SEO discoverability — a graded scorecard with prioritized fixes (optional narrated video).'
		},
		cro_audit: {
			icon: Gauge,
			blurb:
				'Score a page for conversion (CRO) — a graded scorecard with quick-wins & strategic fixes (optional narrated video).'
		},
		marketing_scorecard: {
			icon: BarChart3,
			blurb:
				'Grade a page as a marketing asset across 6 dimensions (content, conversion, SEO, competitive, brand, growth) — one composite scorecard.'
		},
		generic: {
			icon: Box,
			blurb: 'Long-form narrative. Default DAG, no extra structure.'
		},
		audiobook: {
			icon: Headphones,
			blurb: 'Narrate an uploaded manuscript into per-chapter + combined audio.'
		},
		app_review: {
			icon: Globe,
			blurb: 'Critique-driven review of a target app.'
		}
	};

	const options = CREATABLE_PROJECT_TYPES.map((t) => ({ value: t, ...meta[t] }));
</script>

<!-- `data-project-type` mirrors the option value onto the element (same pattern as
     the gallery's `data-project-*` hooks). The button's ACCESSIBLE NAME is the
     label AND the blurb joined — "Promo video Short-form marketing video. …" —
     because the name is computed from contents and there is no aria-label, so
     `getByRole('button', { name: label, exact: true })` can never match. An
     anchored regex is not a fix either: "Web design" is a strict prefix of
     "Web design (interactive)". Select on the attribute or the label <p>.

     `data-type-label` marks the LABEL paragraph specifically. Matching label text
     against the whole button is unsafe: the button's text also carries the blurb
     and Playwright's `hasText` is a case-insensitive substring, so "Lesson"
     matches the Course blurb ("…of multiple lessons…") and an absence assertion
     goes red for the wrong reason. -->
<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-type-picker">
	{#each options as opt (opt.value)}
		<button
			type="button"
			data-project-type={opt.value}
			class="rounded-xl border p-4 text-left transition
        {value === opt.value
				? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] shadow-soft'
				: 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-strong)]'}"
			onclick={() => (value = opt.value)}
			aria-pressed={value === opt.value}
		>
			<opt.icon class="h-5 w-5 text-[var(--color-accent)] mb-2" />
			<p data-type-label class="text-sm font-semibold text-[var(--color-text)]">
				{PROJECT_TYPE_LABELS[opt.value]}
			</p>
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">{opt.blurb}</p>
		</button>
	{/each}
</div>
