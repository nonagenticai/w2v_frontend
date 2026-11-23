<script lang="ts">
	// One run's output. Renders by the run's OWN `output_kind` (the frozen
	// contract field), falling back to text when the server sends none — never by
	// what the slot expected, so a provider that returns something else still
	// shows truthfully.
	//
	// The provider truth line is part of the result, not decoration: the video
	// path currently answers from a STUB renderer (`VIDEO_PROVIDER=stub`), and a
	// placeholder clip must never read as a generated one.
	import {
		isStubProvider,
		providerLabel,
		runMediaUrl,
		type ServiceRun
	} from '$lib/api/serviceLab.js';

	let { run }: { run: ServiceRun } = $props();

	const mediaUrl = $derived(runMediaUrl(run));
	const outputKind = $derived(run.output_kind ?? 'text');
	const promptText = $derived(typeof run.request?.prompt === 'string' ? run.request.prompt : '');
	const segments = $derived(run.segments ?? []);
	// The platform's video path registers the `stub` provider today: a clip comes
	// back, but it is a placeholder render. Say exactly that, for the slot that is
	// actually stubbed, and never dress a placeholder up as a generation.
	const stubNote = $derived(
		run.slot === 'video'
			? "This deployment's video renderer is a stub — the clip is a placeholder, not a generated video."
			: `This deployment's ${run.slot.toUpperCase()} service is a stub — the output is a placeholder, not a real model result.`
	);
</script>

<div class="flex flex-col gap-3" data-testid="run-result" data-kind={outputKind}>
	{#if run.status === 'failed'}
		<div
			role="alert"
			data-testid="result-error"
			class="rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-4 text-sm"
		>
			<p class="font-semibold text-[var(--color-danger)]">
				The run failed{run.error ? ` (${run.error.code})` : ''}
			</p>
			<p class="mt-1 text-[var(--color-text)]">
				{run.error?.message ?? 'The provider reported a failure without a message.'}
			</p>
		</div>
	{:else if outputKind === 'image' && mediaUrl}
		<img
			data-testid="result-image"
			class="max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)]"
			src={mediaUrl}
			alt={promptText ? `Generated image: ${promptText}` : 'Generated image'}
		/>
	{:else if outputKind === 'audio' && mediaUrl}
		<audio data-testid="result-audio" class="w-full" controls preload="none" src={mediaUrl}>
			<track kind="captions" />
		</audio>
	{:else if outputKind === 'video' && mediaUrl}
		<video
			data-testid="result-video"
			class="max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)]"
			controls
			preload="none"
			src={mediaUrl}
		>
			<track kind="captions" />
		</video>
	{:else if outputKind === 'transcript'}
		<div data-testid="result-transcript" class="flex flex-col gap-2">
			{#if segments.length > 0}
				<ol class="flex flex-col gap-1 text-sm">
					{#each segments as segment, i (`${i}-${segment.start}`)}
						<li class="flex gap-2">
							<span class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
								{segment.start.toFixed(1)}s
							</span>
							<span>{segment.text}</span>
						</li>
					{/each}
				</ol>
			{/if}
			<pre
				class="max-h-96 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-strong)] p-3 text-sm whitespace-pre-wrap text-[var(--color-text)]">{run.text ??
					'The run returned no transcript.'}</pre>
		</div>
	{:else}
		<pre
			data-testid="result-text"
			class="max-h-96 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-strong)] p-3 text-sm whitespace-pre-wrap text-[var(--color-text)]">{run.text ??
				'The run returned no text.'}</pre>
	{/if}

	<p class="text-xs text-[var(--color-text-muted)]" data-testid="result-provider">
		Served by {providerLabel(run.provider)}
	</p>

	{#if isStubProvider(run.provider)}
		<p
			class="rounded-[var(--radius-md)] border border-status-pending/40 bg-status-pending/10 p-3 text-xs text-[var(--color-text)]"
			data-testid="result-stub"
		>
			{stubNote}
		</p>
	{/if}
</div>
