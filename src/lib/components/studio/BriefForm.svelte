<script lang="ts">
	import type { ProjectBrief } from '$lib/types';
	import type { PickType } from '$lib/studio/project-request';
	import { typeIsAudit } from '$lib/studio/project-request';
	import { wizardControls } from '$lib/studio/create-wizard-controls';
	import AiVisualsConfig from './AiVisualsConfig.svelte';
	import SiteCaptureConfig from './SiteCaptureConfig.svelte';
	import FieldsSection from './brief/FieldsSection.svelte';
	import DialogueSection from './brief/DialogueSection.svelte';
	import AiVideoGenSection from './brief/AiVideoGenSection.svelte';
	import HeroSection from './brief/HeroSection.svelte';
	import AuditsSection from './brief/AuditsSection.svelte';
	import TitleCardSection from './brief/TitleCardSection.svelte';
	import KenBurnsSection from './brief/KenBurnsSection.svelte';
	import VerbatimSection from './brief/VerbatimSection.svelte';
	import AuthSection from './brief/AuthSection.svelte';
	import DemoAuthSection from './brief/DemoAuthSection.svelte';

	let {
		type,
		brief = $bindable<ProjectBrief>({}),
		redesignEnabled = true
	}: {
		type: PickType;
		brief?: ProjectBrief;
		/** website_review: false when no redesign/video is requested → hide the
		 *  redesign-only brief field (redesign style). Auth stays (the critique needs
		 *  it for gated sites). Default true so every other type is unchanged. */
		redesignEnabled?: boolean;
	} = $props();

	// website_review / web_design: opt-in animated hero. Shown only when a redesign
	// will actually run: web_design always generates a page; website_review only
	// when a redesign/video output is requested.
	const showRedesignMotion = $derived(
		type === 'web_design' || (type === 'website_review' && redesignEnabled)
	);

	// seo_audit / cro_audit / marketing_scorecard: the audit opt-in group.
	const showAuditOptions = $derived(typeIsAudit(type));

	// Animated title card — shown for the narrated-video types whose compile
	// produces a final video: promo / generic / course / demo_video / showcase
	// always; website_review only when a video is produced. demo_video runs through
	// the same CompileStageBase tail, so the intro/outro card brackets the recorded
	// demo just like any other type.
	const showTitleCard = $derived(
		type === 'promo' ||
			type === 'generic' ||
			type === 'course' ||
			type === 'demo_video' ||
			type === 'showcase' ||
			(type === 'website_review' && redesignEnabled)
	);

	// Ken Burns / Verbatim — per-type visibility lives in ONE table
	// ($lib/studio/create-wizard-controls). Ken Burns is promo + generic only: the
	// course stitch never reads brief.ken_burns and lessons don't inherit it.
	const controls = $derived(wizardControls(type));
</script>

<div class="space-y-5">
	<FieldsSection {type} {redesignEnabled} bind:brief />

	{#if type === 'course'}
		<DialogueSection bind:brief />
		<AiVideoGenSection bind:brief />
	{/if}

	{#if showRedesignMotion}
		<HeroSection bind:brief />
	{/if}

	{#if showAuditOptions}
		<AuditsSection {type} bind:brief />
	{/if}

	{#if showTitleCard}
		<TitleCardSection bind:brief />
	{/if}

	{#if controls.kenBurns}
		<KenBurnsSection bind:brief />
	{/if}

	{#if type === 'generic' || type === 'promo'}
		<!-- AI-visuals opt-in. Generic + promo are the wizard-selectable PickTypes
		     whose blueprints wire ``ai_image_gen`` / ``ai_video_gen`` into the DAG;
		     the stage handlers raise StageSkippedError when the corresponding brief
		     block is absent, so the user has to opt in here to get real imagery
		     (otherwise the render falls back to text-card slides). website_review /
		     app_review don't read these blocks; lesson/course are not directly
		     pickable (lessons live as course children with their own LessonDraft
		     schema, a separate widening). -->
		<AiVisualsConfig bind:brief />
	{/if}

	{#if type === 'promo'}
		<!-- Recording options for the live source site (the first website in
		     Sources → brief.source_url). The site_capture stage records whenever
		     that URL exists; brief.site_capture only tunes it. -->
		<SiteCaptureConfig bind:brief />
	{/if}

	{#if controls.verbatim}
		<VerbatimSection />
	{/if}

	{#if type === 'website_review' || type === 'promo'}
		<AuthSection {type} bind:brief />
	{/if}

	{#if type === 'demo_video' || type === 'showcase'}
		<DemoAuthSection bind:brief />
	{/if}
</div>
