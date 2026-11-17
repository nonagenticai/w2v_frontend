<script lang="ts">
	import { Input } from '$lib/components/ui';
	import { Trash2, Plus } from '@lucide/svelte';
	import type { ProjectBrief } from '$lib/types';
	import type { BriefType, PickType } from '$lib/studio/project-request';

	let {
		type,
		brief = $bindable<ProjectBrief>({}),
		redesignEnabled = true
	}: {
		type: PickType;
		brief?: ProjectBrief;
		redesignEnabled?: boolean;
	} = $props();

	type FieldKind = 'text' | 'textarea' | 'list' | 'select';
	interface Field {
		key: string;
		label: string;
		kind: FieldKind;
		placeholder: string;
		hint?: string;
		/** kind 'select' only: the exact values the backend accepts; the first is the default. */
		options?: readonly { value: string; label: string }[];
	}

	// Each field maps to a brief key the type's blueprint actually reads — see
	// $lib/studio/project-request.ts for the per-type contract + citations.
	const FIELDS: Record<BriefType, Field[]> = {
		promo: [
			{
				key: 'audience',
				label: 'Audience',
				kind: 'textarea',
				placeholder: 'Who is this for? Their role, prior knowledge, motivation'
			},
			{
				key: 'value_proposition',
				label: 'Value proposition',
				kind: 'textarea',
				placeholder: 'The core offer and the pain it solves',
				hint: 'Drives the hook and pain points the script is built around.'
			},
			{
				key: 'call_to_action',
				label: 'Call to action',
				kind: 'text',
				placeholder: 'e.g. Start your free trial',
				hint: 'Spoken verbatim at the end of the promo.'
			},
			{
				// The one field here that does NOT satisfy the invariant above: no
				// orchestrator stage reads `brief["cta_url"]` (every `cta_url` in the
				// orchestrator is slide/snippet OUTPUT — the promo + growth-bundle
				// stages read `call_to_action` only). Kept rather than deleted because
				// the brief is `extra='allow'`, so saved values already exist and
				// dropping the control would strand them invisibly. Labelled instead,
				// so it stops reading as a generation input.
				key: 'cta_url',
				label: 'CTA link (optional)',
				kind: 'text',
				placeholder: 'https://…',
				hint: 'Stored on the brief for reference — not read by any generation stage, so it will not appear in the video. The spoken "Call to action" above is what the script uses.'
			},
			{
				key: 'instructions',
				label: 'Specific instructions (optional)',
				kind: 'textarea',
				placeholder:
					'Steer the script & visuals, e.g. "lead with the one-click onboarding, keep it punchy, mention the free tier"',
				hint: 'Passed verbatim to the script stage to guide tone, emphasis, and what to feature.'
			}
		],
		generic: [
			{
				key: 'angle',
				label: 'Angle',
				kind: 'text',
				placeholder: 'e.g. explainer, announcement, deep-dive tutorial'
			},
			{
				key: 'audience',
				label: 'Audience',
				kind: 'textarea',
				placeholder: 'Who is this for? Their role, prior knowledge, motivation'
			},
			{
				key: 'source_script',
				label: 'Source script (optional)',
				kind: 'textarea',
				placeholder:
					'Paste a script to narrate verbatim — one line per spoken line. Leave blank to let AI write it.',
				hint: 'If provided, the pipeline narrates this text exactly and skips AI script generation.'
			}
		],
		app_review: [
			{
				key: 'review_lens',
				label: 'Review lens',
				kind: 'text',
				placeholder: 'e.g. onboarding UX, performance, accessibility'
			},
			{
				key: 'audience',
				label: 'Audience',
				kind: 'textarea',
				placeholder: 'Who is the review for?'
			},
			{
				key: 'competitor_urls',
				label: 'Competitor URLs (optional)',
				kind: 'list',
				placeholder: 'https://competitor.example.com'
			}
		],
		website_review: [
			{
				key: 'redesign_style',
				label: 'Redesign style (optional)',
				kind: 'text',
				placeholder: 'e.g. modern, minimal, bold',
				hint: 'Style passed to the redesign engine. Defaults to "modern".'
			}
		],
		course: [
			{
				key: 'audience',
				label: 'Audience',
				kind: 'textarea',
				placeholder: 'Who is this course for? Their level and goals'
			},
			{
				key: 'outcome',
				label: 'Learning outcome',
				kind: 'textarea',
				placeholder: 'What should learners be able to do after the course?',
				hint: 'Frames the course outline and intro.'
			}
		],
		// Audiobook collects its manuscript + options in the Source step; the Brief
		// step only carries the title (rendered by the wizard, not here).
		audiobook: [],
		// action_reel uploads its clips in the Source step (per-project video-sources);
		// the reel's length comes from the deliverable (brief.target_duration_seconds).
		// These two optional keys are the only ones a human types — music_select reads
		// them to pick the bed.
		action_reel: [
			{
				key: 'goal',
				label: 'What the reel is for (optional)',
				kind: 'textarea',
				placeholder: 'e.g. a season highlight reel for the club Instagram',
				hint: 'Steers which music bed is chosen.'
			},
			{
				key: 'tone',
				label: 'Tone (optional)',
				kind: 'text',
				placeholder: 'e.g. energetic, cinematic, laid-back'
			}
		],
		// Audits take the target URL (Source step) + boolean toggles rendered below
		// (include_llm / generate_video). SEO additionally offers competitor URLs for
		// the content-gap analyzer (writes brief.competitor_urls: string[]). CRO has no
		// competitor concept, so it stays field-less.
		seo_audit: [
			{
				key: 'competitor_urls',
				label: 'Competitor URLs (optional)',
				kind: 'list',
				placeholder: 'https://competitor.example.com',
				hint: 'Compared against your page for content gaps. Requires "Add AI analysis" (below) to run.'
			}
		],
		cro_audit: [],
		// marketing_scorecard is scan-only (include_llm toggle only, no video variant).
		marketing_scorecard: [],
		web_design: [
			{
				key: 'description',
				label: 'Describe the design',
				kind: 'textarea',
				placeholder:
					'What is this page for? Brand & tone, audience, the key sections (hero, features, pricing, contact…), and any must-haves.',
				hint: 'The brief the page is generated from — the more specific, the better.'
			},
			{
				key: 'page_type',
				label: 'Page type',
				kind: 'text',
				placeholder: 'landing, homepage, product, portfolio…'
			},
			{
				key: 'audience',
				label: 'Audience (optional)',
				kind: 'textarea',
				placeholder: 'Who is it for? Their role, context, what they want.'
			},
			{
				key: 'redesign_style',
				label: 'Style (optional)',
				kind: 'text',
				placeholder: 'modern, minimal, bold, elegant',
				hint: 'Design direction. Defaults to "modern".'
			},
			{
				key: 'target_url',
				label: 'Reference URL (optional)',
				kind: 'text',
				placeholder: 'https://… a site whose look/brand to start from',
				hint: 'Optional — seeds the design from an existing site instead of pure greenfield.'
			}
		],
		// web_design_v2 (computed-assembly + verified). Mirrors web_design's brief
		// but the v2 blueprint reads `interactivity` (static|interactive) instead of
		// redesign_style, so the style field is dropped and an interactivity control
		// added. description → page plan; target_url seeds brand_extract.
		web_design_v2: [
			{
				key: 'description',
				label: 'Describe the design',
				kind: 'textarea',
				placeholder:
					'What is this page for? Brand & tone, audience, the key sections (hero, features, pricing, contact…), and any must-haves.',
				hint: 'The brief the page is assembled from — the more specific, the better.'
			},
			{
				key: 'page_type',
				label: 'Page type',
				kind: 'text',
				placeholder: 'landing, homepage, product, portfolio…'
			},
			{
				key: 'audience',
				label: 'Audience (optional)',
				kind: 'textarea',
				placeholder: 'Who is it for? Their role, context, what they want.'
			},
			{
				// web_design_v2/design.py accepts ONLY the exact strings "static" /
				// "interactive" — anything else silently became static, so this is a
				// select, never free text.
				key: 'interactivity',
				label: 'Interactivity',
				kind: 'select',
				placeholder: '',
				options: [
					{ value: 'static', label: 'Static' },
					{ value: 'interactive', label: 'Interactive (htmx/Alpine behaviours)' }
				],
				hint: 'Interactive emits htmx/Alpine behaviours; static is a plain page.'
			},
			{
				key: 'target_url',
				label: 'Reference URL (optional)',
				kind: 'text',
				placeholder: 'https://… a site whose look/brand to start from',
				hint: 'Optional — extracts brand (palette/fonts) from an existing site.'
			}
		],
		// The app/site URL is collected in the Source step (urlToTargetUrl →
		// brief.target_url). These steer scenario generation. Login-gated demos
		// set brief.auth_config (form login) via API for now — not yet a wizard control.
		demo_video: [
			{
				key: 'focus_areas',
				label: 'Focus areas (optional)',
				kind: 'list',
				placeholder: 'e.g. "complete the signup flow", "create and drag a card"',
				hint: 'Specific flows the demo should walk through. Steers which scenarios are generated.'
			},
			{
				key: 'max_scenarios_per_feature',
				label: 'Max scenarios (optional)',
				kind: 'text',
				placeholder: '5',
				hint: 'Caps how many demo scenarios are generated (and clips recorded). Defaults to 5.'
			}
		],
		// Showcase reuses demo_video's generated-mode steering fields (they only
		// apply when generating scenarios from the URL — in authored mode the
		// uploaded package supplies the walkthrough and these are ignored).
		showcase: [
			{
				key: 'focus_areas',
				label: 'Focus areas (optional)',
				kind: 'list',
				placeholder: 'e.g. "complete the signup flow", "create and drag a card"',
				hint: 'Generated mode only: flows the walkthrough should cover. Ignored when a package is uploaded.'
			},
			{
				key: 'max_scenarios_per_feature',
				label: 'Max scenarios (optional)',
				kind: 'text',
				placeholder: '5',
				hint: 'Generated mode only: caps how many scenarios are generated (and clips recorded). Defaults to 5.'
			}
		],
		// Not creatable from the wizard, but an API-created growth_bundle opens a
		// workspace with this form. The copywriter (growth_bundle/handler.py
		// _PROMPT_BRIEF_FIELDS) reads both keys as plain text.
		growth_bundle: [
			{
				key: 'call_to_action',
				label: 'Call to action',
				kind: 'text',
				placeholder: 'e.g. Start your free trial',
				hint: 'Used by the social / email copy the bundle writes.'
			},
			{
				key: 'cta_url',
				label: 'CTA link (optional)',
				kind: 'text',
				placeholder: 'https://…',
				hint: 'The link the generated posts point readers to.'
			}
		]
	};

	// website_review's only brief field (redesign_style) is redesign-only — drop it
	// when no redesign/video is requested. Auth (below) is rendered separately and
	// stays. Other types are unaffected (redesignEnabled defaults true).
	let fields = $derived(
		type === 'website_review' && !redesignEnabled
			? []
			: ((FIELDS as Partial<Record<string, Field[]>>)[type] ?? [])
	);

	function setValue(key: string, value: string) {
		brief = { ...brief, [key]: value };
	}
	function strValue(key: string): string {
		return typeof brief[key] === 'string' ? (brief[key] as string) : '';
	}

	function listValue(key: string): string[] {
		return Array.isArray(brief[key]) ? (brief[key] as string[]) : [];
	}
	function setListItem(key: string, index: number, value: string) {
		const list = [...listValue(key)];
		list[index] = value;
		brief = { ...brief, [key]: list };
	}
	function addListItem(key: string) {
		brief = { ...brief, [key]: [...listValue(key), ''] };
	}
	function removeListItem(key: string, index: number) {
		const list = [...listValue(key)];
		list.splice(index, 1);
		brief = { ...brief, [key]: list };
	}
</script>

{#each fields as field (field.key)}
	{#if field.kind === 'textarea'}
		<div>
			<label
				for={`brief-${field.key}`}
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				{field.label}
			</label>
			<textarea
				id={`brief-${field.key}`}
				rows="2"
				placeholder={field.placeholder}
				value={strValue(field.key)}
				oninput={(e) => setValue(field.key, (e.currentTarget as HTMLTextAreaElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			></textarea>
			{#if field.hint}
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">{field.hint}</p>
			{/if}
		</div>
	{:else if field.kind === 'select'}
		<div>
			<label
				for={`brief-${field.key}`}
				class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
			>
				{field.label}
			</label>
			<select
				id={`brief-${field.key}`}
				name={`brief-${field.key}`}
				value={strValue(field.key) || field.options?.[0]?.value}
				onchange={(e) => setValue(field.key, (e.currentTarget as HTMLSelectElement).value)}
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			>
				{#each field.options ?? [] as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			{#if field.hint}
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">{field.hint}</p>
			{/if}
		</div>
	{:else if field.kind === 'text'}
		<div>
			<Input
				name={`brief-${field.key}`}
				label={field.label}
				placeholder={field.placeholder}
				value={strValue(field.key)}
				oninput={(e) => setValue(field.key, (e.currentTarget as HTMLInputElement).value)}
			/>
			{#if field.hint}
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">{field.hint}</p>
			{/if}
		</div>
	{:else}
		<div role="group" aria-label={field.label}>
			<div class="flex items-center justify-between mb-1.5">
				<p class="block text-sm font-medium text-[var(--color-text-muted)]">{field.label}</p>
				<button
					type="button"
					onclick={() => addListItem(field.key)}
					class="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent)]"
				>
					<Plus class="h-3.5 w-3.5" /> Add
				</button>
			</div>
			{#if listValue(field.key).length === 0}
				<p class="text-xs text-[var(--color-text-muted)]">None yet. Add one above.</p>
			{:else}
				<div class="space-y-2">
					{#each listValue(field.key) as item, i (i)}
						<div class="flex items-start gap-2">
							<Input
								name={`${field.key}-${i}`}
								placeholder={field.placeholder}
								value={item}
								oninput={(e) =>
									setListItem(field.key, i, (e.currentTarget as HTMLInputElement).value)}
								class="flex-1"
							/>
							<button
								type="button"
								onclick={() => removeListItem(field.key, i)}
								aria-label={`Remove ${field.label}`}
								class="mt-1.5 p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/each}
