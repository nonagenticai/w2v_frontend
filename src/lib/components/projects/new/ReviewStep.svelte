<script lang="ts">
	import { PROJECT_TYPE_LABELS, DELIVERABLE_FORMAT_LABELS } from '$lib/types';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import SettingsPage from '$lib/components/wizard/SettingsPage.svelte';
	import { wizard } from '$lib/stores/wizard.svelte.js';
	import { createWizard as cw } from './create-wizard.svelte.js';
	import { thumbnailSrc } from '$lib/api/client.js';
	import { typeIsScanOnlyAudit } from '$lib/studio/project-request';
	import { plural } from '$lib/utils/format';

	const auditIntent = $derived(
		typeof cw.brief.intent === 'string' ? (cw.brief.intent as string).trim() : ''
	);
	// website_review's independent output opt-ins (Source step). The video implies
	// the redesign — the Source step shows Redesign checked + locked in that case —
	// so read back the EFFECTIVE set, not the raw `generateRedesign` flag.
	const chosenOutputs = $derived(
		[
			cw.generateCritique && 'Critique report',
			(cw.generateRedesign || cw.generateVideo) && 'Redesign',
			cw.generateVideo && 'Narrated review video'
		].filter((o): o is string => Boolean(o))
	);
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<h2 class="text-base font-semibold text-[var(--color-text)]">Review</h2>
	<dl class="grid grid-cols-2 gap-3 text-sm">
		<div>
			<dt class="text-xs text-[var(--color-text-muted)]">Type</dt>
			<dd class="text-[var(--color-text)] font-medium">
				{PROJECT_TYPE_LABELS[cw.projectType]}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-[var(--color-text-muted)]">Title</dt>
			<dd class="text-[var(--color-text)] font-medium break-all">
				{cw.title.trim() || cw.titleHint || '—'}
			</dd>
		</div>
		{#if cw.isAudiobook}
			<div class="col-span-2">
				<dt class="text-xs text-[var(--color-text-muted)]">Manuscript</dt>
				<dd class="text-[var(--color-text)] break-all">
					{(cw.brief.manuscript_name as string) || '—'}
					<span class="text-[var(--color-text-muted)]">
						· {(cw.brief.chapter_mode as string) ?? 'auto'} chapters ·
						{cw.brief.audiobook?.output_format ?? 'mp3'}
					</span>
				</dd>
			</div>
		{:else}
			{#if cw.usesVideoSources}
				<!-- action_reel has no URL: summarise the footage the Footage step uploaded. -->
				<div class="col-span-2">
					<dt class="text-xs text-[var(--color-text-muted)]">Footage</dt>
					<dd class="text-[var(--color-text)] break-all" data-testid="review-footage">
						{cw.videoSources.length}
						{cw.videoSources.length === 1 ? 'clip' : 'clips'}{#if cw.videoSources.length > 0}:
							{cw.videoSources.map((v) => v.filename).join(', ')}{/if}
					</dd>
				</div>
			{:else if cw.usesSingleSource}
				<div class="col-span-2">
					<dt class="text-xs text-[var(--color-text-muted)]">{cw.sourceLabel}</dt>
					<dd class="text-[var(--color-text)] font-mono break-all">{cw.sourceValue || '—'}</dd>
				</div>
			{/if}
			{#if cw.usesVideoOptIn}
				<div class="col-span-2">
					<dt class="text-xs text-[var(--color-text-muted)]">Outputs</dt>
					<dd class="text-[var(--color-text)] font-medium" data-testid="review-outputs">
						{chosenOutputs.join(' · ') || '—'}
					</dd>
				</div>
			{/if}
			{#if cw.isAudit}
				<div>
					<dt class="text-xs text-[var(--color-text-muted)]">AI analysis</dt>
					<dd class="text-[var(--color-text)] font-medium" data-testid="review-ai-analysis">
						{cw.brief.include_llm === true ? 'On' : 'Off'}
					</dd>
				</div>
				{#if !typeIsScanOnlyAudit(cw.pickType)}
					<div>
						<dt class="text-xs text-[var(--color-text-muted)]">Narrated video</dt>
						<dd class="text-[var(--color-text)] font-medium" data-testid="review-audit-video">
							{cw.brief.generate_video === true ? 'On' : 'Off'}
						</dd>
					</div>
				{/if}
				{#if cw.brief.include_llm === true && auditIntent}
					<div class="col-span-2">
						<dt class="text-xs text-[var(--color-text-muted)]">Intent</dt>
						<dd class="text-[var(--color-text)] break-words" data-testid="review-audit-intent">
							{auditIntent}
						</dd>
					</div>
				{/if}
			{/if}
			{#if cw.usesShotlist && cw.shotlist.length > 0}
				<div class="col-span-2">
					<dt class="text-xs text-[var(--color-text-muted)]">Shotlist</dt>
					<dd class="text-[var(--color-text)]" data-testid="review-shotlist">
						{plural(cw.shotlist.length, 'shot')} ·
						{plural(cw.shotlist.filter((s) => s.kind === 'url').length, 'URL')} ·
						{plural(cw.shotlist.filter((s) => s.kind === 'slide').length, 'slide')}
					</dd>
				</div>
			{/if}
			{#if cw.usesMultiSource}
				<div class="col-span-2">
					<dt class="text-xs text-[var(--color-text-muted)]">{cw.sourcesStepLabel}</dt>
					<dd class="text-[var(--color-text)]">
						{#if cw.sources.filter((s) => s.ref.trim()).length === 0}
							<span class="text-[var(--color-text-muted)]">None — brief only</span>
						{:else}
							{#each cw.sources.filter((s) => s.ref.trim()) as s, i (i)}
								<span class="mr-2 inline-block capitalize">{s.kind}: {s.label || s.ref}</span>
							{/each}
							{#if cw.mediaDiscovery}
								<span class="text-[var(--color-text-muted)]">· + auto media discovery</span>
							{/if}
						{/if}
					</dd>
				</div>
				{#if cw.sources.some((s) => s.kind === 'media' && s.ref.trim())}
					<div class="col-span-2">
						<dt class="text-xs text-[var(--color-text-muted)]">Pinned media</dt>
						<dd
							class="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4"
							data-testid="review-pinned-media"
						>
							{#each cw.sources.filter((s) => s.kind === 'media' && s.ref.trim()) as s, i (i)}
								<div
									class="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
									data-testid="review-pinned-media-thumbnail"
									title={s.label || s.ref}
								>
									<!-- Pinned media is a mix of our own uploads and third-party stock
									     refs; thumbnailSrc proxies the external ones (CSP img-src 'self')
									     and tenant-scopes the `/api/…` ones. -->
									{#if s.thumbnail_url || s.media_type !== 'video'}
										<img
											src={thumbnailSrc(s.thumbnail_url || s.ref)}
											alt={s.label || 'Pinned media'}
											loading="lazy"
											class="block aspect-video w-full overflow-hidden bg-[var(--color-surface-strong)] object-cover text-[0px] text-transparent"
										/>
									{:else}
										<div
											class="flex aspect-video w-full items-center justify-center bg-[var(--color-surface-strong)] text-[10px] text-[var(--color-text-muted)]"
										>
											clip
										</div>
									{/if}
									{#if s.media_type === 'video'}
										<span
											class="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] font-medium text-white"
										>
											clip
										</span>
									{/if}
								</div>
							{/each}
						</dd>
					</div>
				{/if}
			{/if}
		{/if}
		{#each cw.requiredKeys as key (key)}
			<div class="col-span-2">
				<dt class="text-xs text-[var(--color-text-muted)] capitalize">
					{key.replace(/_/g, ' ')}
				</dt>
				<dd class="text-[var(--color-text)] break-words">
					{typeof cw.brief[key] === 'string' && (cw.brief[key] as string).trim()
						? (cw.brief[key] as string)
						: '—'}
				</dd>
			</div>
		{/each}
		{#if cw.isCourse}
			<div class="col-span-2">
				<dt class="text-xs text-[var(--color-text-muted)]">Lessons</dt>
				<dd class="text-[var(--color-text)]">
					{plural(cw.lessons.filter((l) => l.title.trim()).length, 'lesson')}:
					{cw.lessons
						.filter((l) => l.title.trim())
						.map((l) => l.title.trim())
						.join(', ') || '—'}
				</dd>
			</div>
		{/if}
		{#if cw.needsDeliverables}
			<div class="col-span-2">
				<dt class="text-xs text-[var(--color-text-muted)]">Deliverables</dt>
				<dd class="text-[var(--color-text)]">
					{#each cw.deliverables as d, i (i)}
						<span class="inline-block mr-2">
							{d.name || `Deliverable ${i + 1}`} ({DELIVERABLE_FORMAT_LABELS[d.format]}{cw.controls
								.deliverableDuration && d.target_duration_seconds
								? ` · ${d.target_duration_seconds}s`
								: ''})
						</span>
					{/each}
				</dd>
			</div>
		{/if}
		{#if cw.producesVideo}
			<div>
				<dt class="text-xs text-[var(--color-text-muted)]">Narration</dt>
				<dd class="text-[var(--color-text)] font-medium">
					{wizard.ttsProvider} · {wizard.voice}
				</dd>
			</div>
			{#if cw.controls.look}
				<div>
					<dt class="text-xs text-[var(--color-text-muted)]">Look</dt>
					<dd class="text-[var(--color-text)] font-medium" data-testid="review-look">
						{wizard.theme} · {wizard.resolution}
					</dd>
				</div>
			{/if}
		{/if}
	</dl>
</section>

{#if cw.producesVideo}
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden"
	>
		<button
			type="button"
			onclick={() => (cw.showAdvanced = !cw.showAdvanced)}
			class="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-[var(--color-surface-strong)] transition-colors"
		>
			<div>
				<h2 class="text-base font-semibold text-[var(--color-text)]">
					Advanced — look &amp; voice
				</h2>
				<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
					{cw.controls.look ? 'Narration voice, theme, and video options' : 'Narration voice'}.
					Saved on the project; defaults come from Settings.
				</p>
			</div>
			{#if cw.showAdvanced}
				<ChevronUp class="h-4 w-4 text-[var(--color-text-muted)]" />
			{:else}
				<ChevronDown class="h-4 w-4 text-[var(--color-text-muted)]" />
			{/if}
		</button>
		{#if cw.showAdvanced}
			<div class="border-t border-[var(--color-border)] px-6 py-5">
				<SettingsPage showLlm={false} isMobilePlatform={false} showLook={cw.controls.look} />
			</div>
		{/if}
	</section>
{/if}

{#if cw.submitError}
	<div
		class="rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3"
	>
		<p class="text-sm text-[var(--color-danger)]">{cw.submitError}</p>
	</div>
{/if}
