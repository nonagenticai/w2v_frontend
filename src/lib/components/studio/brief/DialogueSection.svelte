<script lang="ts">
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// course-only: two-voice Socratic lesson narration. The toggle lives on the
	// course brief; project-request.buildLessonChildren propagates the flag onto
	// each lesson child's brief (the orchestrator does not inherit course→lesson
	// config, so the propagation is explicit). Off → drop the key entirely so the
	// orchestrator's `if brief.dialogue.enabled` check sees it absent.
	const twoVoiceEnabled = $derived(
		!!(brief.dialogue && typeof brief.dialogue === 'object' && brief.dialogue.enabled)
	);
	function setTwoVoice(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, dialogue: { enabled: true } };
		} else {
			const { dialogue: _unused, ...rest } = brief;
			brief = rest;
		}
	}
</script>

<!-- Two-voice Socratic narration opt-in. Writes brief.dialogue.enabled on the
     course; buildLessonChildren copies it onto each lesson child so the
     orchestrator's lesson_script/lesson_narrate stages render the lesson as a
     student↔instructor dialogue in two distinct voices. -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="two-voice-toggle"
		checked={twoVoiceEnabled}
		onchange={(e) => setTwoVoice((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]">
			Two-voice lessons (instructor + student)
		</span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Each lesson is narrated as a Socratic dialogue — a curious student asks short questions and an
			instructor answers — in two distinct voices, instead of a single narrator. Applies to every
			lesson in this course.
		</span>
	</span>
</label>
