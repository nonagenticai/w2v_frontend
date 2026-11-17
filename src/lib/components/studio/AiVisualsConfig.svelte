<script lang="ts">
	import { Input } from '$lib/components/ui';
	import type { ProjectBrief } from '$lib/types';

	// Generic-blueprint-only opt-in for AI image/video generation. The
	// orchestrator lifts brief.ai_image_gen / brief.ai_video_gen into the
	// top-level run config the gen stages read, but ONLY when the block is
	// TRUTHY — run_setup.build_config_snapshot gates the lift on
	// `brief_cfg.get(vis_key)` and each gen stage skips on `if not cfg`, so an
	// empty {} is falsy → never lifted → the stage stays `skipped` and the
	// render falls back to text-card slides (the defect this opt-in exists to
	// avoid). The bare toggle therefore writes `{ enabled: true }`; the backend
	// still derives the prompt from title+angle when no prompts are given. Any
	// non-empty block produced by filling a field (e.g. { prompts: [...] }) is
	// likewise truthy, so the presence-based checkbox state below is correct.
	// Toggling a section off DELETES the key so the stage sees it as absent,
	// mirroring how BriefForm drops auth_info on "none".
	let {
		brief = $bindable<ProjectBrief>({})
	}: {
		brief?: ProjectBrief;
	} = $props();

	type Block = Record<string, unknown>;

	function imageBlock(): Block {
		const b = brief.ai_image_gen;
		return b && typeof b === 'object' ? (b as Block) : {};
	}
	function videoBlock(): Block {
		const b = brief.ai_video_gen;
		return b && typeof b === 'object' ? (b as Block) : {};
	}
	function motionBlock(): Block {
		const b = brief.motion_graphics;
		return b && typeof b === 'object' ? (b as Block) : {};
	}

	// Registered motion-graphics templates (video_production_service
	// templates/__init__.py). Kept in sync with the renderer's TEMPLATES dict.
	const MOTION_TEMPLATES = [
		{ id: 'pipeline_story', label: 'Pipeline story' },
		{ id: 'social_card', label: 'Social card' },
		{ id: 'animated_slide', label: 'Animated slide' },
		{ id: 'animated_title_card', label: 'Animated title card' },
		{ id: 'lower_third', label: 'Lower third' },
		{ id: 'data_viz', label: 'Data viz' },
		{ id: 'kinetic_typography', label: 'Kinetic typography' }
	] as const;
	const DEFAULT_MOTION_TEMPLATE = 'pipeline_story';

	const imageEnabled = $derived(
		brief.ai_image_gen != null && typeof brief.ai_image_gen === 'object'
	);
	const videoEnabled = $derived(
		brief.ai_video_gen != null && typeof brief.ai_video_gen === 'object'
	);
	const motionEnabled = $derived(
		brief.motion_graphics != null && typeof brief.motion_graphics === 'object'
	);

	// --- helpers: prompts textarea <-> string[] ---------------------------
	function promptsText(block: Block): string {
		return Array.isArray(block.prompts) ? (block.prompts as string[]).join('\n') : '';
	}
	function parseLines(raw: string): string[] {
		return raw
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
	}

	// Immutable reassign so Svelte 5 reactivity + parent $bindable propagate.
	function setImage(block: Block) {
		brief = { ...brief, ai_image_gen: block };
	}
	function setVideo(block: Block) {
		brief = { ...brief, ai_video_gen: block };
	}
	function setMotion(block: Block) {
		brief = { ...brief, motion_graphics: block };
	}

	function toggleImage(on: boolean) {
		if (on) {
			setImage({ enabled: true });
		} else {
			const { ai_image_gen: _drop, ...rest } = brief;
			brief = rest;
		}
	}
	function toggleVideo(on: boolean) {
		if (on) {
			setVideo({ enabled: true });
		} else {
			const { ai_video_gen: _drop, ...rest } = brief;
			brief = rest;
		}
	}
	function toggleMotion(on: boolean) {
		if (on) {
			// Seed a template so the stage has something to render — unlike
			// image/video (which auto-derive prompts), motion_graphics_gen skips
			// when neither template_id nor html is set.
			setMotion({ enabled: true, template_id: DEFAULT_MOTION_TEMPLATE });
		} else {
			const { motion_graphics: _drop, ...rest } = brief;
			brief = rest;
		}
	}

	// Set a string field; only include the key when non-empty (trimmed).
	function setImageStr(key: string, raw: string) {
		const block = { ...imageBlock() };
		const v = raw.trim();
		if (v) block[key] = v;
		else delete block[key];
		setImage(block);
	}
	function setVideoStr(key: string, raw: string) {
		const block = { ...videoBlock() };
		const v = raw.trim();
		if (v) block[key] = v;
		else delete block[key];
		setVideo(block);
	}

	function setImagePrompts(raw: string) {
		const block = { ...imageBlock() };
		const lines = parseLines(raw);
		if (lines.length) block.prompts = lines;
		else delete block.prompts;
		setImage(block);
	}
	function setVideoPrompts(raw: string) {
		const block = { ...videoBlock() };
		const lines = parseLines(raw);
		if (lines.length) block.prompts = lines;
		else delete block.prompts;
		setVideo(block);
	}

	// Number fields: include only when a finite number is entered.
	function setVideoNum(key: string, raw: string) {
		const block = { ...videoBlock() };
		const trimmed = raw.trim();
		const n = Number(trimmed);
		if (trimmed !== '' && Number.isFinite(n)) block[key] = n;
		else delete block[key];
		setVideo(block);
	}

	function setMotionStr(key: string, raw: string) {
		const block = { ...motionBlock() };
		const v = raw.trim();
		if (v) block[key] = v;
		else delete block[key];
		setMotion(block);
	}
	function setMotionNum(key: string, raw: string) {
		const block = { ...motionBlock() };
		const trimmed = raw.trim();
		const n = Number(trimmed);
		if (trimmed !== '' && Number.isFinite(n)) block[key] = n;
		else delete block[key];
		setMotion(block);
	}

	function numValue(block: Block, key: string): string {
		const v = block[key];
		return typeof v === 'number' ? String(v) : '';
	}
	function strValue(block: Block, key: string): string {
		return typeof block[key] === 'string' ? (block[key] as string) : '';
	}
</script>

<div class="space-y-5" data-testid="ai-visuals-config">
	<!-- AI images -->
	<fieldset class="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
		<legend class="px-2">
			<label
				class="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)]"
			>
				<input
					type="checkbox"
					name="ai-image-enabled"
					checked={imageEnabled}
					onchange={(e) => toggleImage((e.currentTarget as HTMLInputElement).checked)}
					class="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
				/>
				Generate AI images
			</label>
		</legend>
		<p class="text-xs text-[var(--color-text-muted)]">
			Opt this project into AI-generated images. Leave the fields blank to let the pipeline derive
			prompts from the title and angle.
		</p>

		{#if imageEnabled}
			<div>
				<label
					for="ai-image-prompts"
					class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
				>
					Prompts (optional)
				</label>
				<textarea
					id="ai-image-prompts"
					name="ai-image-prompts"
					rows="3"
					placeholder="One prompt per line. Leave blank to auto-derive."
					value={promptsText(imageBlock())}
					oninput={(e) => setImagePrompts((e.currentTarget as HTMLTextAreaElement).value)}
					class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
				></textarea>
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">One prompt per line.</p>
			</div>

			<Input
				name="ai-image-provider"
				label="Provider (optional)"
				placeholder="e.g. openai, flux"
				value={strValue(imageBlock(), 'provider')}
				oninput={(e) => setImageStr('provider', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="ai-image-size"
				label="Size (optional)"
				placeholder="e.g. 1024x1024"
				value={strValue(imageBlock(), 'size')}
				oninput={(e) => setImageStr('size', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="ai-image-style"
				label="Style (optional)"
				placeholder="e.g. photorealistic, flat illustration"
				value={strValue(imageBlock(), 'style')}
				oninput={(e) => setImageStr('style', (e.currentTarget as HTMLInputElement).value)}
			/>

			<div>
				<label
					for="ai-image-negative-prompt"
					class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
				>
					Negative prompt (optional)
				</label>
				<textarea
					id="ai-image-negative-prompt"
					name="ai-image-negative-prompt"
					rows="2"
					placeholder="Things to avoid in the image"
					value={strValue(imageBlock(), 'negative_prompt')}
					oninput={(e) =>
						setImageStr('negative_prompt', (e.currentTarget as HTMLTextAreaElement).value)}
					class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
				></textarea>
			</div>
		{/if}
	</fieldset>

	<!-- AI video -->
	<fieldset class="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
		<legend class="px-2">
			<label
				class="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)]"
			>
				<input
					type="checkbox"
					name="ai-video-enabled"
					checked={videoEnabled}
					onchange={(e) => toggleVideo((e.currentTarget as HTMLInputElement).checked)}
					class="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
				/>
				Generate AI video
			</label>
		</legend>
		<p class="text-xs text-[var(--color-text-muted)]">
			Opt this project into AI-generated video. Leave the fields blank to let the pipeline derive
			prompts from the title and angle.
		</p>

		{#if videoEnabled}
			<div>
				<label
					for="ai-video-prompts"
					class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
				>
					Prompts (optional)
				</label>
				<textarea
					id="ai-video-prompts"
					name="ai-video-prompts"
					rows="3"
					placeholder="One prompt per line. Leave blank to auto-derive."
					value={promptsText(videoBlock())}
					oninput={(e) => setVideoPrompts((e.currentTarget as HTMLTextAreaElement).value)}
					class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
				></textarea>
				<p class="mt-1 text-xs text-[var(--color-text-muted)]">One prompt per line.</p>
			</div>

			<Input
				name="ai-video-provider"
				label="Provider (optional)"
				placeholder="e.g. runway, luma"
				value={strValue(videoBlock(), 'provider')}
				oninput={(e) => setVideoStr('provider', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="ai-video-duration"
				type="number"
				label="Duration (seconds, optional)"
				placeholder="e.g. 5"
				value={numValue(videoBlock(), 'duration_s')}
				oninput={(e) => setVideoNum('duration_s', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="ai-video-width"
				type="number"
				label="Width (px, optional)"
				placeholder="e.g. 1280"
				value={numValue(videoBlock(), 'width')}
				oninput={(e) => setVideoNum('width', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="ai-video-height"
				type="number"
				label="Height (px, optional)"
				placeholder="e.g. 720"
				value={numValue(videoBlock(), 'height')}
				oninput={(e) => setVideoNum('height', (e.currentTarget as HTMLInputElement).value)}
			/>
		{/if}
	</fieldset>

	<!-- Branded motion graphics -->
	<fieldset class="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
		<legend class="px-2">
			<label
				class="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)]"
			>
				<input
					type="checkbox"
					name="motion-graphics-enabled"
					checked={motionEnabled}
					onchange={(e) => toggleMotion((e.currentTarget as HTMLInputElement).checked)}
					class="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
				/>
				Branded motion graphics
			</label>
		</legend>
		<p class="text-xs text-[var(--color-text-muted)]">
			Opt this project into deterministic, on-brand animated clips rendered from an HTML/CSS motion
			template — a zero-cost, reproducible alternative to AI video.
		</p>

		{#if motionEnabled}
			<div>
				<label
					for="motion-graphics-template"
					class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
				>
					Template
				</label>
				<select
					id="motion-graphics-template"
					name="motion-graphics-template"
					value={strValue(motionBlock(), 'template_id') || DEFAULT_MOTION_TEMPLATE}
					onchange={(e) =>
						setMotionStr('template_id', (e.currentTarget as HTMLSelectElement).value)}
					class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
				>
					{#each MOTION_TEMPLATES as tpl (tpl.id)}
						<option value={tpl.id}>{tpl.label}</option>
					{/each}
				</select>
			</div>

			<Input
				name="motion-graphics-width"
				type="number"
				label="Width (px, optional)"
				placeholder="e.g. 1920"
				value={numValue(motionBlock(), 'width')}
				oninput={(e) => setMotionNum('width', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="motion-graphics-height"
				type="number"
				label="Height (px, optional)"
				placeholder="e.g. 1080"
				value={numValue(motionBlock(), 'height')}
				oninput={(e) => setMotionNum('height', (e.currentTarget as HTMLInputElement).value)}
			/>

			<Input
				name="motion-graphics-fps"
				type="number"
				label="FPS (optional)"
				placeholder="e.g. 30"
				value={numValue(motionBlock(), 'fps')}
				oninput={(e) => setMotionNum('fps', (e.currentTarget as HTMLInputElement).value)}
			/>
		{/if}
	</fieldset>
</div>
