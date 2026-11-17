<script lang="ts">
	// Course outline (CourseOutlineOutput: intro_summary, sections[]{title,
	// objective, lesson_project_id}) → a numbered lesson plan.
	import { Pill } from '$lib/components/ui';
	import type { RendererProps } from './registry';
	import type { CourseOutlineOutput, CourseSection } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as CourseOutlineOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const sections = $derived<CourseSection[]>(Array.isArray(data.sections) ? data.sections : []);
	const intro = $derived(str(data.intro_summary));
</script>

<div class="space-y-3" data-testid="course-outline">
	{#if intro}<p class="text-sm text-[var(--color-text-muted)]">{intro}</p>{/if}
	<ol class="space-y-2">
		{#each sections as s, i (str(s.id) ?? i)}
			<li
				class="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
			>
				<span
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-bg)] text-xs font-semibold text-[var(--color-accent-text)] tabular-nums"
					>{i + 1}</span
				>
				<div class="min-w-0 space-y-0.5">
					<p class="text-sm font-semibold text-[var(--color-text)]">
						{str(s.title) ?? `Lesson ${i + 1}`}
					</p>
					{#if str(s.objective)}<p class="text-sm text-[var(--color-text-muted)]">
							{s.objective}
						</p>{/if}
					{#if str(s.lesson_project_id)}<Pill tone="neutral"
							>Lesson {str(s.lesson_project_id)?.slice(0, 8)}</Pill
						>{/if}
				</div>
			</li>
		{/each}
	</ol>
</div>
