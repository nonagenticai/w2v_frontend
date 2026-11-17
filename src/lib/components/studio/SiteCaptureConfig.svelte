<script lang="ts">
	import { Input } from '$lib/components/ui';
	import type { ProjectBrief } from '$lib/types';

	// promo-only tuning for recording the live source site as background footage.
	// The orchestrator's site_capture stage gates ONLY on brief.source_url
	// (site_capture.py: no URL ⇒ skipped, a URL ⇒ recorded) — brief.site_capture
	// is not an opt-in, just optional paths / max_clips / viewport. So there is no
	// on/off toggle here: it promised a gate the stage does not implement
	// (ui-review X5). For promo, source_url is the first website in Sources.
	// An all-empty block is dropped so the brief carries no meaningless `{}`.
	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	type Block = Record<string, unknown>;

	function block(): Block {
		const b = brief.site_capture;
		return b && typeof b === 'object' ? (b as Block) : {};
	}
	function viewport(): Block {
		const v = block().viewport;
		return v && typeof v === 'object' ? (v as Block) : {};
	}

	function setBlock(next: Block) {
		if (Object.keys(next).length > 0) {
			brief = { ...brief, site_capture: next };
		} else {
			const { site_capture: _drop, ...rest } = brief;
			brief = rest;
		}
	}

	function pathsText(): string {
		const p = block().paths;
		return Array.isArray(p) ? (p as string[]).join('\n') : '';
	}
	function setPaths(raw: string) {
		const next = { ...block() };
		const lines = raw
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
		if (lines.length) next.paths = lines;
		else delete next.paths;
		setBlock(next);
	}

	function setMaxClips(raw: string) {
		const next = { ...block() };
		const n = Number(raw.trim());
		if (raw.trim() !== '' && Number.isFinite(n) && n > 0) next.max_clips = Math.floor(n);
		else delete next.max_clips;
		setBlock(next);
	}
	function maxClipsValue(): string {
		const v = block().max_clips;
		return typeof v === 'number' ? String(v) : '';
	}

	function setViewport(key: string, raw: string) {
		const vp = { ...viewport() };
		const n = Number(raw.trim());
		if (raw.trim() !== '' && Number.isFinite(n) && n > 0) vp[key] = Math.floor(n);
		else delete vp[key];
		const next = { ...block() };
		if (Object.keys(vp).length) next.viewport = vp;
		else delete next.viewport;
		setBlock(next);
	}
	function viewportValue(key: string): string {
		const v = viewport()[key];
		return typeof v === 'number' ? String(v) : '';
	}
</script>

<fieldset
	class="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
	data-testid="site-capture-config"
>
	<legend class="px-2 text-sm font-medium text-[var(--color-text-muted)]">
		Source website recording (optional settings)
	</legend>
	<p class="text-xs text-[var(--color-text-muted)]">
		When your Sources include a website, the first one is recorded in a real browser and the footage
		is used as on-screen background. No website in Sources ⇒ nothing is recorded. For a site behind
		a login, fill in the sign-in details below.
	</p>

	<div>
		<label
			for="site-capture-paths"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Paths to record (optional)
		</label>
		<textarea
			id="site-capture-paths"
			name="site-capture-paths"
			rows="3"
			placeholder="One path per line, e.g. /&#10;/projects&#10;/pricing. Blank = just the source URL."
			value={pathsText()}
			oninput={(e) => setPaths((e.currentTarget as HTMLTextAreaElement).value)}
			class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		></textarea>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Each path becomes one background clip (relative to the recorded website).
		</p>
	</div>

	<Input
		name="site-capture-max-clips"
		type="number"
		label="Max clips (optional)"
		placeholder="e.g. 4"
		value={maxClipsValue()}
		oninput={(e) => setMaxClips((e.currentTarget as HTMLInputElement).value)}
	/>

	<div class="grid grid-cols-2 gap-3">
		<Input
			name="site-capture-viewport-width"
			type="number"
			label="Viewport width (px, optional)"
			placeholder="e.g. 1920"
			value={viewportValue('width')}
			oninput={(e) => setViewport('width', (e.currentTarget as HTMLInputElement).value)}
		/>
		<Input
			name="site-capture-viewport-height"
			type="number"
			label="Viewport height (px, optional)"
			placeholder="e.g. 1080"
			value={viewportValue('height')}
			oninput={(e) => setViewport('height', (e.currentTarget as HTMLInputElement).value)}
		/>
	</div>
</fieldset>
