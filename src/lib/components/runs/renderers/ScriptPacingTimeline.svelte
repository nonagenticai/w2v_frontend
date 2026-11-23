<script lang="ts">
	// Annotated script (retention_plan / cold_open / script_doctor re-emit the SAME
	// lines[] shape, decorated with beat/hook roles, cold-open anchors and doctor
	// notes) → a vertical PACING timeline: each line is a proportional runtime bar
	// carrying its decision annotations. Wins over ScriptDialogue only when some
	// line carries an annotation (see registry.ts matcher); plain scripts fall
	// through to the chat transcript unchanged.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import type { RendererProps } from './registry';
	import type { ScriptOutput, ScriptLine } from './stage-outputs';

	let { output, dense = false }: RendererProps = $props();

	const data = $derived(output as unknown as ScriptOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const lines = $derived<ScriptLine[]>(
		Array.isArray(data.lines) ? data.lines : Array.isArray(data.paragraphs) ? data.paragraphs : []
	);
	const totalSeconds = $derived(
		num(data.total_seconds) ?? lines.reduce((acc, l) => acc + (num(l.seconds) ?? 0), 0)
	);
	// Proportional bar denominator: the longest single line (never 0 → no /0).
	const maxLineSeconds = $derived(Math.max(1, ...lines.map((l) => num(l.seconds) ?? 0)));

	const coldOpenLabel = (line: ScriptLine): string => {
		const anchor = str(line.clip_anchor);
		if (anchor) return `Cold open · anchored to ${anchor}`;
		const pin = line.pin_position;
		if (pin != null && pin !== '') return `Cold open · pin ${pin}`;
		return 'Cold open';
	};
	const isColdOpen = (line: ScriptLine): boolean =>
		str(line.clip_anchor) != null || (line.pin_position != null && line.pin_position !== '');
</script>

<div class="space-y-3" data-testid="script-pacing-timeline">
	<div class="flex flex-wrap items-center gap-2">
		{#if totalSeconds > 0}
			<Pill tone="accent"><Duration seconds={totalSeconds} /> runtime</Pill>
		{/if}
		<span class="text-kicker text-[var(--color-text-muted)]">
			{lines.length} line{lines.length === 1 ? '' : 's'}
		</span>
	</div>

	<ol class="space-y-2">
		{#each lines as line, i (str(line.id) ?? str(line.line_id) ?? i)}
			{@const seconds = num(line.seconds)}
			{@const text = str(line.text) ?? ''}
			{@const speaker = str(line.speaker)}
			{@const beat = str(line.beat_role)}
			{@const hook = str(line.hook_role)}
			{@const note = str(line.doctor_note)}
			{@const coldOpen = isColdOpen(line)}
			{@const widthPct = seconds != null ? Math.round((seconds / maxLineSeconds) * 100) : 0}
			<li
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-1.5"
				data-testid="pacing-line"
				data-line-id={str(line.id) ?? str(line.line_id) ?? undefined}
			>
				<div class="flex flex-wrap items-center gap-2 text-[var(--color-text-muted)]">
					<span class="text-[10px] uppercase tracking-wide tabular-nums">
						{#if speaker}Speaker {speaker.toUpperCase()}{:else}Line {i + 1}{/if}
					</span>
					{#if seconds != null}<Duration {seconds} class="text-[10px]" />{/if}
					{#if beat}<Pill tone="neutral">{beat}</Pill>{/if}
					{#if hook}<Pill tone="accent">{hook}</Pill>{/if}
					{#if coldOpen}
						<span
							class="inline-flex items-center rounded-full border border-[var(--color-secondary-border)] bg-[var(--color-secondary-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-secondary-text)]"
							data-testid="cold-open-marker"
						>
							{coldOpenLabel(line)}
						</span>
					{/if}
				</div>

				<!-- proportional runtime bar -->
				<span class="block h-1.5 rounded-full bg-[var(--color-surface-strong)] overflow-hidden">
					<span
						class="block h-full rounded-full bg-[var(--color-accent)]"
						style={`width:${widthPct}%`}
					></span>
				</span>

				<p class="text-sm leading-relaxed text-[var(--color-text)] {dense ? 'line-clamp-2' : ''}">
					{text}
				</p>

				{#if note}
					<p
						class="rounded-[var(--radius-sm)] border-l-2 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2 py-1 text-xs text-[var(--color-warning-text)]"
						data-testid="doctor-note"
					>
						<span class="font-medium">Script doctor:</span>
						{note}
					</p>
				{/if}
			</li>
		{/each}
	</ol>
</div>
