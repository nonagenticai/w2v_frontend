<script lang="ts">
	import { Trash2, ChevronUp, ChevronDown, Link as LinkIcon, LayoutTemplate } from '@lucide/svelte';
	import type { Shot, UrlShot, SlideShot, ShotViewport } from '$lib/types';

	// Ordered shotlist authored by the operator. Bindable so the wizard owns the
	// array and reads it back for buildInput. Add/remove/move reassign the array
	// (so $bindable propagates); field edits mutate the proxied entries in place.
	let { shotlist = $bindable<Shot[]>([]) }: { shotlist?: Shot[] } = $props();

	const VIEWPORTS: ShotViewport[] = ['desktop', 'tablet', 'mobile'];

	function newUrlShot(): UrlShot {
		return {
			kind: 'url',
			url: '',
			narration: '',
			directives: { hold_ms: 3000, viewport: 'desktop' }
		};
	}
	function newSlideShot(): SlideShot {
		return { kind: 'slide', narration: '', slide: { template: 'title' } };
	}

	function addUrl() {
		shotlist = [...shotlist, newUrlShot()];
	}
	function addSlide() {
		shotlist = [...shotlist, newSlideShot()];
	}
	function remove(i: number) {
		shotlist = shotlist.filter((_, j) => j !== i);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= shotlist.length) return;
		const next = [...shotlist];
		[next[i], next[j]] = [next[j], next[i]];
		shotlist = next;
	}
	// Flip a row's kind, preserving the narration the operator already typed.
	function switchKind(i: number, kind: 'url' | 'slide') {
		const cur = shotlist[i];
		if (cur.kind === kind) return;
		const narration = cur.narration;
		const replacement = kind === 'url' ? newUrlShot() : newSlideShot();
		replacement.narration = narration;
		shotlist = shotlist.map((s, j) => (j === i ? replacement : s));
	}

	// bullets are stored as string[]; edited as one-per-line text.
	function bulletsText(s: SlideShot): string {
		return (s.slide.bullets ?? []).join('\n');
	}
	function setBullets(i: number, raw: string) {
		const bullets = raw
			.split('\n')
			.map((b) => b.trim())
			.filter((b) => b.length > 0);
		const cur = shotlist[i];
		if (cur.kind !== 'slide') return;
		cur.slide.bullets = bullets;
		shotlist = [...shotlist];
	}

	function summary(s: Shot): string {
		if (s.kind === 'url') {
			return `URL · ${s.directives.viewport} · ${Math.round((s.directives.hold_ms ?? 0) / 1000)}s`;
		}
		return `Slide · ${s.slide.template}`;
	}

	const textareaClass =
		'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]';
	const inputClass = textareaClass;
	const selectClass =
		'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
	const iconBtn =
		'p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed';
	const labelClass = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1';
	// Placeholders with embedded quotes / newlines live here so the markup uses a
	// plain {expr} (svelte/no-useless-mustaches forbids a literal in a mustache).
	const clickPlaceholder = 'e.g. "Pricing" button';
	const bulletsPlaceholder = 'Fast to set up\nNo migration\nWorks with your stack';
</script>

<div class="space-y-3" data-testid="shotlist-editor">
	{#if shotlist.length === 0}
		<div
			class="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center space-y-1"
		>
			<p class="text-sm text-[var(--color-text)]">No shots yet</p>
			<p class="text-xs text-[var(--color-text-muted)]">
				Direct the video shot by shot — add a URL shot to film part of a live page, or a slide to
				say something to camera. Leave empty to let the pipeline auto-direct.
			</p>
		</div>
	{/if}

	{#each shotlist as shot, i (i)}
		<div
			class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
			data-testid={`shot-${i}`}
		>
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold tabular-nums text-[var(--color-text-muted)]">
						#{i + 1}
					</span>
					<select
						class={selectClass}
						value={shot.kind}
						onchange={(e) =>
							switchKind(i, (e.currentTarget as HTMLSelectElement).value as 'url' | 'slide')}
						data-testid={`shot-${i}-kind`}
						aria-label="Shot type"
					>
						<option value="url">URL shot</option>
						<option value="slide">Slide</option>
					</select>
					<span class="text-xs text-[var(--color-text-muted)]">{summary(shot)}</span>
				</div>
				<div class="flex items-center gap-0.5">
					<button
						type="button"
						class={iconBtn}
						onclick={() => move(i, -1)}
						disabled={i === 0}
						aria-label="Move shot up"
						data-testid={`shot-${i}-move-up`}
					>
						<ChevronUp class="h-4 w-4" />
					</button>
					<button
						type="button"
						class={iconBtn}
						onclick={() => move(i, 1)}
						disabled={i === shotlist.length - 1}
						aria-label="Move shot down"
						data-testid={`shot-${i}-move-down`}
					>
						<ChevronDown class="h-4 w-4" />
					</button>
					<button
						type="button"
						class="{iconBtn} hover:text-[var(--color-danger)]"
						onclick={() => remove(i)}
						aria-label="Remove shot"
						data-testid={`shot-${i}-remove`}
					>
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			</div>

			{#if shot.kind === 'url'}
				<div>
					<label class={labelClass} for={`shot-${i}-url`}>URL or path</label>
					<input
						id={`shot-${i}-url`}
						type="text"
						class={inputClass}
						placeholder="https://example.com/pricing (or /pricing)"
						bind:value={shot.url}
						data-testid={`shot-${i}-url`}
					/>
				</div>
				<div>
					<label class={labelClass} for={`shot-${i}-narration`}>Narration (verbatim)</label>
					<textarea
						id={`shot-${i}-narration`}
						rows="2"
						class={textareaClass}
						placeholder="What the voiceover says over this shot, word for word."
						bind:value={shot.narration}
						data-testid={`shot-${i}-narration`}></textarea>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class={labelClass} for={`shot-${i}-click`}>Click (optional)</label>
						<input
							id={`shot-${i}-click`}
							type="text"
							class={inputClass}
							placeholder={clickPlaceholder}
							bind:value={shot.directives.click}
							data-testid={`shot-${i}-click`}
						/>
					</div>
					<div>
						<label class={labelClass} for={`shot-${i}-scroll`}>Scroll to (optional)</label>
						<input
							id={`shot-${i}-scroll`}
							type="text"
							class={inputClass}
							placeholder="e.g. #pricing"
							bind:value={shot.directives.scroll_to}
							data-testid={`shot-${i}-scroll`}
						/>
					</div>
					<div>
						<label class={labelClass} for={`shot-${i}-hold`}>Hold (ms)</label>
						<input
							id={`shot-${i}-hold`}
							type="number"
							min="500"
							step="500"
							class={inputClass}
							bind:value={shot.directives.hold_ms}
							data-testid={`shot-${i}-hold`}
						/>
						<p class="mt-1 text-[11px] text-[var(--color-text-muted)]">
							Pause so viewers can read — ~3000 for a sentence.
						</p>
					</div>
					<div>
						<label class={labelClass} for={`shot-${i}-viewport`}>Viewport</label>
						<select
							id={`shot-${i}-viewport`}
							class="{selectClass} w-full"
							bind:value={shot.directives.viewport}
							data-testid={`shot-${i}-viewport`}
						>
							{#each VIEWPORTS as vp (vp)}
								<option value={vp}>{vp}</option>
							{/each}
						</select>
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class={labelClass} for={`shot-${i}-template`}>Template</label>
						<select
							id={`shot-${i}-template`}
							class="{selectClass} w-full"
							bind:value={shot.slide.template}
							data-testid={`shot-${i}-template`}
						>
							<option value="title">Title</option>
							<option value="bullets">Bullets</option>
							<option value="cta">Call to action</option>
						</select>
					</div>
					<div>
						<label class={labelClass} for={`shot-${i}-eyebrow`}>Eyebrow (optional)</label>
						<input
							id={`shot-${i}-eyebrow`}
							type="text"
							class={inputClass}
							placeholder="e.g. Why teams switch"
							bind:value={shot.slide.eyebrow}
							data-testid={`shot-${i}-eyebrow`}
						/>
					</div>
				</div>
				<div>
					<label class={labelClass} for={`shot-${i}-title`}>Title</label>
					<input
						id={`shot-${i}-title`}
						type="text"
						class={inputClass}
						placeholder="e.g. Three reasons teams switch"
						bind:value={shot.slide.title}
						data-testid={`shot-${i}-title`}
					/>
				</div>
				{#if shot.slide.template === 'bullets'}
					<div>
						<label class={labelClass} for={`shot-${i}-bullets`}>Bullets (one per line)</label>
						<textarea
							id={`shot-${i}-bullets`}
							rows="3"
							class={textareaClass}
							placeholder={bulletsPlaceholder}
							value={bulletsText(shot)}
							oninput={(e) => setBullets(i, (e.currentTarget as HTMLTextAreaElement).value)}
							data-testid={`shot-${i}-bullets`}></textarea>
					</div>
				{:else if shot.slide.template === 'cta'}
					<div>
						<label class={labelClass} for={`shot-${i}-cta-url`}>CTA URL (optional)</label>
						<input
							id={`shot-${i}-cta-url`}
							type="text"
							class={inputClass}
							placeholder="https://example.com/signup"
							bind:value={shot.slide.cta_url}
							data-testid={`shot-${i}-cta-url`}
						/>
					</div>
				{:else}
					<div>
						<label class={labelClass} for={`shot-${i}-body`}>Body (optional)</label>
						<textarea
							id={`shot-${i}-body`}
							rows="2"
							class={textareaClass}
							placeholder="Supporting line under the title."
							bind:value={shot.slide.body}
							data-testid={`shot-${i}-body`}></textarea>
					</div>
				{/if}
				<div>
					<label class={labelClass} for={`shot-${i}-narration`}>Narration (verbatim)</label>
					<textarea
						id={`shot-${i}-narration`}
						rows="2"
						class={textareaClass}
						placeholder="What the voiceover says over this slide, word for word."
						bind:value={shot.narration}
						data-testid={`shot-${i}-narration`}></textarea>
				</div>
			{/if}
		</div>
	{/each}

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={addUrl}
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
			data-testid="add-url-shot"
		>
			<LinkIcon class="h-3.5 w-3.5" /> Add URL shot
		</button>
		<button
			type="button"
			onclick={addSlide}
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
			data-testid="add-slide-shot"
		>
			<LayoutTemplate class="h-3.5 w-3.5" /> Add slide
		</button>
	</div>
</div>
