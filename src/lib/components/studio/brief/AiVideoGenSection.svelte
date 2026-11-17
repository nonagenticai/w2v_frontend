<script lang="ts">
	import type { ProjectBrief } from '$lib/types';

	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	// course-only: AI-generated video clips in lessons. Same propagation story as
	// two-voice — the orchestrator does not inherit course→lesson config, so
	// buildLessonChildren copies this block onto each lesson child's brief, where
	// the lesson's opt-in ai_video_gen stage renders short generative B-roll
	// (lesson `ai_image_gen` is already default-on, so only video needs opting in).
	// The block must be TRUTHY: run_setup lifts `brief.ai_video_gen` only when
	// truthy and the stage skips on a falsy config, so write `{ enabled: true }`,
	// NOT `{}` (which would be a silent no-op). Prompts are derived per-lesson.
	const aiVideoEnabled = $derived(
		!!(
			brief.ai_video_gen &&
			typeof brief.ai_video_gen === 'object' &&
			(brief.ai_video_gen as Record<string, unknown>).enabled
		)
	);
	function setAiVideo(enabled: boolean) {
		if (enabled) {
			brief = { ...brief, ai_video_gen: { enabled: true } };
		} else {
			const { ai_video_gen: _drop, ...rest } = brief;
			brief = rest;
		}
	}
</script>

<!-- AI-video opt-in for lessons. Writes brief.ai_video_gen = { enabled: true }
     on the course; buildLessonChildren copies it onto each lesson child so the
     lesson's ai_video_gen stage renders short generative B-roll cutaways. Lesson
     AI images are already default-on, so only video is opt-in. MUST be a truthy
     block ({ enabled: true }) — an empty {} is lifted as falsy and skipped. -->
<label
	class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 cursor-pointer"
>
	<input
		type="checkbox"
		data-testid="ai-video-toggle"
		checked={aiVideoEnabled}
		onchange={(e) => setAiVideo((e.currentTarget as HTMLInputElement).checked)}
		class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
	/>
	<span>
		<span class="block text-sm font-medium text-[var(--color-text-muted)]">
			Generate AI video clips in lessons
		</span>
		<span class="mt-1 block text-xs text-[var(--color-text-muted)]">
			Each lesson gets short AI-generated B-roll cutaways woven into the timeline, in addition to
			its slides and AI imagery. Clip topics are derived per lesson. Applies to every lesson in this
			course.
		</span>
	</span>
</label>
