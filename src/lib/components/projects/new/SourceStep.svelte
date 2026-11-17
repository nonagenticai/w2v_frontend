<script lang="ts">
	import { Button, Input } from '$lib/components/ui';
	import {
		AudiobookSource,
		RecordingPackageSource,
		VideoSourcesUpload
	} from '$lib/components/studio';
	import { wizard } from '$lib/stores/wizard.svelte.js';
	import { isValidUrl } from '$lib/utils/validation';
	import { createWizard as cw } from './create-wizard.svelte.js';

	// action_reel's uploader is PROJECT-scoped (POST /projects/{id}/video-sources),
	// so the project must exist before the first byte moves. Same pre-create the
	// storyboard step uses (StoryboardStep.svelte); `ensureDraftProject` no-ops once
	// a draft exists, so this fires exactly once.
	//
	// A FAILED pre-create leaves `projectId` null, so this effect's dependencies
	// never change and it never re-fires — which is why the failure needs an
	// explicit Retry button below rather than an automatic re-run. `draftError`
	// is in the dependency set purely to keep the effect from re-firing into the
	// same failure; the retry path is the user's click.
	$effect(() => {
		if (cw.usesVideoSources && !cw.projectId && !cw.draftError) void cw.ensureDraftProject();
	});
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">
			{cw.usesVideoSources ? 'Footage' : cw.isAudiobook ? 'Manuscript' : 'Source'}
		</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			{cw.usesVideoSources
				? 'Upload the clips to cut from (.mp4, .mov, or .m4v). This is the only project type that uses your own footage — the pipeline probes each clip and cuts them to the beat of the music.'
				: cw.isAudiobook
					? 'Upload the text to narrate (.txt, .docx, or .epub) and choose how it is chaptered.'
					: cw.projectType === 'app_review'
						? 'The app/site to inspect. Stored as the review target.'
						: cw.projectType === 'demo_video'
							? 'The web app to demo. The pipeline auto-generates a Playwright walkthrough, records the real interactions, and narrates them into a video.'
							: cw.projectType === 'showcase'
								? 'The web app to showcase. Generate the walkthrough from this URL, or switch to Authored below to upload a hand-crafted recording package.'
								: cw.projectType === 'seo_audit'
									? 'The site to audit for SEO discoverability. You get a scored SEO scorecard; turn on the narrated video in the Brief step to also produce a walkthrough.'
									: cw.projectType === 'cro_audit'
										? 'The page to audit for conversion (CRO). You get a scored conversion scorecard; turn on the narrated video in the Brief step to also produce a walkthrough.'
										: cw.projectType === 'marketing_scorecard'
											? 'The page to score across the marketing dimensions (positioning, brand, growth, and more). You get a scored marketing scorecard.'
											: cw.projectType === 'website_review'
												? 'The website to critique. You get a critique report (PDF) by default; turn on the review video below to also redesign it and narrate a walkthrough.'
												: cw.sourceOptional
													? 'Optional. The live site to feature: it is recorded as on-screen background footage and scraped to ground the script. Toggle recording + sign-in below in the Brief step. Leave blank to skip.'
													: 'The page the pipeline reads to ground the script. Stored on the brief.'}
		</p>
	</div>
	{#if cw.usesVideoSources}
		{#if !cw.projectId && cw.draftError}
			<div
				role="alert"
				data-testid="draft-create-error"
				class="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger)]/5 p-4 space-y-2"
			>
				<p class="text-sm font-medium text-[var(--color-danger)]">
					Could not prepare your project: {cw.draftError}
				</p>
				<p class="text-xs text-[var(--color-text-muted)]">
					Your clips upload into the project, so it has to exist before the first byte moves.
					Nothing has been uploaded yet — retry to continue where you left off.
				</p>
				<Button
					variant="secondary"
					size="sm"
					disabled={cw.draftPending}
					loading={cw.draftPending}
					onclick={() => void cw.ensureDraftProject()}
				>
					Retry
				</Button>
			</div>
		{/if}
		<VideoSourcesUpload
			projectId={cw.projectId}
			bind:sources={cw.videoSources}
			disabledReason={cw.projectId ? '' : cw.draftError}
		/>
	{:else if cw.isAudiobook}
		<AudiobookSource bind:brief={cw.brief} />
	{:else}
		<div>
			<Input
				name="source-url"
				label={cw.sourceLabel}
				placeholder="https://example.com"
				bind:value={wizard.url}
			/>
			{#if wizard.url.trim().length > 0 && !isValidUrl(wizard.url.trim())}
				<p class="mt-1 text-xs text-[var(--color-danger)]">
					Enter a valid URL (including https://).
				</p>
			{/if}
		</div>
		{#if cw.isShowcase}
			<fieldset class="space-y-2 pt-1">
				<legend class="text-sm font-medium text-[var(--color-text)]">Walkthrough</legend>
				<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
					<input
						type="radio"
						name="showcase-mode"
						data-testid="showcase-mode-generated"
						checked={cw.showcaseMode === 'generated'}
						onchange={() => cw.setShowcaseMode('generated')}
						class="mt-0.5 h-4 w-4 border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
					/>
					<span>
						Generate from URL
						<span class="block text-xs text-[var(--color-text-muted)]">
							Auto-generate a Playwright walkthrough of the app and narrate it. Steer it with focus
							areas in the Brief step.
						</span>
					</span>
				</label>
				<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
					<input
						type="radio"
						name="showcase-mode"
						data-testid="showcase-mode-authored"
						checked={cw.showcaseMode === 'authored'}
						onchange={() => cw.setShowcaseMode('authored')}
						class="mt-0.5 h-4 w-4 border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
					/>
					<span>
						Upload a recording package
						<span class="block text-xs text-[var(--color-text-muted)]">
							Supply a hand-authored walkthrough (.zip) — full control of steps, order, and
							narration. The recorder re-runs it live.
						</span>
					</span>
				</label>
			</fieldset>
			{#if cw.showcaseMode === 'authored'}
				<RecordingPackageSource bind:brief={cw.brief} bind:clipRoster={cw.clipRoster} />
			{/if}
		{/if}
	{/if}
	{#if cw.usesVideoOptIn}
		<fieldset class="space-y-2 pt-1">
			<legend class="text-sm font-medium text-[var(--color-text)]">
				Outputs — pick at least one
			</legend>
			<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
				<input
					type="checkbox"
					data-testid="generate-critique-toggle"
					bind:checked={cw.generateCritique}
					class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
				/>
				<span>
					Critique report
					<span class="block text-xs text-[var(--color-text-muted)]">
						Findings, scores, and a downloadable PDF. The fast path.
					</span>
				</span>
			</label>
			<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
				<input
					type="checkbox"
					data-testid="generate-redesign-toggle"
					checked={cw.generateRedesign || cw.generateVideo}
					disabled={cw.generateVideo}
					onchange={(e) => (cw.generateRedesign = (e.currentTarget as HTMLInputElement).checked)}
					class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] disabled:opacity-50"
				/>
				<span>
					Redesign
					<span class="block text-xs text-[var(--color-text-muted)]">
						A redesigned HTML page + before/after visuals you can download.{#if cw.generateVideo}
							Included automatically with the video.{/if}
					</span>
				</span>
			</label>
			<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
				<input
					type="checkbox"
					data-testid="generate-video-toggle"
					bind:checked={cw.generateVideo}
					class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
				/>
				<span>
					Narrated review video
					<span class="block text-xs text-[var(--color-text-muted)]">
						A before/after walkthrough video (includes the redesign; slower + voice settings apply).
					</span>
				</span>
			</label>
			{#if !cw.hasOutput}
				<p class="text-xs text-[var(--color-danger)]">Select at least one output.</p>
			{/if}
		</fieldset>
	{/if}
</section>
