<script lang="ts">
	import type { ProjectDetailResponse } from '$lib/types';
	// Dependency-free stand-in for the heavy workspace StoryboardSection so the
	// wizard tests assert only the wiring (draft pre-create + this section
	// rendering), not the section's storyboard-store/network internals.
	let { project }: { project: ProjectDetailResponse } = $props();
</script>

<div data-testid="storyboard-section-stub" data-project-id={project?.id}></div>
