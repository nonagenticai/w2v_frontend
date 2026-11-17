<script lang="ts">
	import { Input } from '$lib/components/ui';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Lessons</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				Each lesson becomes a child project with its own video. The course needs at least one.
			</p>
		</div>
		<button
			type="button"
			onclick={() => cw.addLesson()}
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
		>
			<Plus class="h-3.5 w-3.5" /> Add lesson
		</button>
	</div>
	<div class="space-y-4">
		{#each cw.lessons as _lesson, i (i)}
			<div
				class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
			>
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold text-[var(--color-text-muted)]">Lesson {i + 1}</p>
					{#if cw.lessons.length > 1}
						<button
							type="button"
							onclick={() => cw.removeLesson(i)}
							aria-label="Remove lesson"
							class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					{/if}
				</div>
				<Input
					name={`lesson-title-${i}`}
					label="Title"
					placeholder="e.g. Indexing strategies"
					bind:value={cw.lessons[i].title}
				/>
				<div>
					<label
						for={`lesson-objective-${i}`}
						class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
					>
						Learning objective
					</label>
					<textarea
						id={`lesson-objective-${i}`}
						rows="2"
						placeholder="What should the learner be able to do after this lesson?"
						bind:value={cw.lessons[i].learning_objective}
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
					></textarea>
				</div>
				<label class="block space-y-1">
					<span class="text-sm font-medium text-[var(--color-text-muted)]">Duration (minutes)</span>
					<input
						type="number"
						min="1"
						max="60"
						bind:value={cw.lessons[i].duration_minutes}
						aria-invalid={!cw.lessonDurationValid(cw.lessons[i])}
						class="w-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
					/>
					{#if cw.lessons[i].title.trim() && !cw.lessonDurationValid(cw.lessons[i])}
						<span
							class="block text-xs text-[var(--color-danger)]"
							data-testid={`lesson-duration-error-${i}`}
						>
							Enter a duration between 1 and 60 minutes.
						</span>
					{/if}
				</label>
				<div>
					<label
						for={`lesson-source-script-${i}`}
						class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
					>
						Source script (optional)
					</label>
					<textarea
						id={`lesson-source-script-${i}`}
						rows="3"
						placeholder="Paste a script to narrate verbatim. Leave blank to let AI write it."
						bind:value={cw.lessons[i].source_script}
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
					></textarea>
					<p class="mt-1 text-xs text-[var(--color-text-muted)]">
						If provided, this lesson narrates the text exactly and skips AI script generation.
					</p>
				</div>
			</div>
		{/each}
	</div>
</section>
