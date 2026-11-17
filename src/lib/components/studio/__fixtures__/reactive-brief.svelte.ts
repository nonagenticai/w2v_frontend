import type { ProjectBrief } from '$lib/types';

// Wraps a brief in a $state container so tests can pass a deep-reactive
// proxy (identical to how projects.svelte.ts byId hands briefs to
// CourseProjectHome → SyllabusEditor in production). Lives in a .svelte.ts
// module so the $state rune resolves at compile time.
export function createReactiveBriefStore(initial: ProjectBrief): { brief: ProjectBrief } {
	const inner = $state<{ brief: ProjectBrief }>({ brief: initial });
	return inner;
}
