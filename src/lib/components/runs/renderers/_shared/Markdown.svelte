<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- markdown links come
	   from pipeline-generated text and are external/relative, never app routes. */
	// Minimal, dependency-free markdown renderer. Parses to a token tree and
	// renders REAL Svelte elements — deliberately NO {@html} (the repo avoids it;
	// it's an XSS footgun). Covers what the pipeline emits: headings, bullet/
	// ordered lists, paragraphs, and inline bold / italic / code / links
	// (http/https/relative only).
	let { text, class: className = '' }: { text: string | null | undefined; class?: string } =
		$props();

	type Seg =
		| { t: 'text'; v: string }
		| { t: 'strong'; v: string }
		| { t: 'em'; v: string }
		| { t: 'code'; v: string }
		| { t: 'link'; v: string; href: string };
	type Block =
		{ type: 'h1' | 'h2' | 'h3' | 'p'; segs: Seg[] } | { type: 'ul' | 'ol'; items: Seg[][] };

	const INLINE =
		/(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\))|(\*([^*]+)\*)/g;

	function parseInline(s: string): Seg[] {
		const segs: Seg[] = [];
		let last = 0;
		let m: RegExpExecArray | null;
		INLINE.lastIndex = 0;
		while ((m = INLINE.exec(s))) {
			if (m.index > last) segs.push({ t: 'text', v: s.slice(last, m.index) });
			if (m[2] != null) segs.push({ t: 'strong', v: m[2] });
			else if (m[4] != null) segs.push({ t: 'code', v: m[4] });
			else if (m[6] != null) segs.push({ t: 'link', v: m[6], href: m[7] });
			else if (m[9] != null) segs.push({ t: 'em', v: m[9] });
			last = m.index + m[0].length;
		}
		if (last < s.length) segs.push({ t: 'text', v: s.slice(last) });
		return segs;
	}

	const blocks = $derived.by((): Block[] => {
		const src = (text ?? '').trim();
		if (!src) return [];
		const out: Block[] = [];
		let list: { type: 'ul' | 'ol'; items: Seg[][] } | null = null;
		const flush = () => {
			if (list) {
				out.push(list);
				list = null;
			}
		};
		for (const raw of src.split(/\r?\n/)) {
			const line = raw.trim();
			if (!line) {
				flush();
				continue;
			}
			const h = /^(#{1,3})\s+(.*)$/.exec(line);
			if (h) {
				flush();
				out.push({ type: `h${h[1].length}` as 'h1' | 'h2' | 'h3', segs: parseInline(h[2]) });
				continue;
			}
			const ul = /^[-*]\s+(.*)$/.exec(line);
			const ol = /^\d+\.\s+(.*)$/.exec(line);
			if (ul) {
				if (list?.type !== 'ul') {
					flush();
					list = { type: 'ul', items: [] };
				}
				list.items.push(parseInline(ul[1]));
				continue;
			}
			if (ol) {
				if (list?.type !== 'ol') {
					flush();
					list = { type: 'ol', items: [] };
				}
				list.items.push(parseInline(ol[1]));
				continue;
			}
			flush();
			out.push({ type: 'p', segs: parseInline(line) });
		}
		flush();
		return out;
	});
</script>

{#snippet inline(segs: Seg[])}
	{#each segs as seg, i (i)}
		{#if seg.t === 'strong'}<strong>{seg.v}</strong>
		{:else if seg.t === 'em'}<em>{seg.v}</em>
		{:else if seg.t === 'code'}<code
				class="rounded bg-[var(--color-surface-strong)] px-1 py-0.5 text-[0.85em] font-mono"
			>
				{seg.v}
			</code>
		{:else if seg.t === 'link'}<a
				href={safeHref(seg.href)}
				target="_blank"
				rel="noopener noreferrer"
				class="text-[var(--color-accent)] hover:underline"
			>
				{seg.v}
			</a>
		{:else}{seg.v}{/if}
	{/each}
{/snippet}

{#if blocks.length}
	<div class={`space-y-2 text-sm leading-relaxed text-[var(--color-text)] ${className}`}>
		{#each blocks as b, i (i)}
			{#if b.type === 'h1'}<h1 class="text-lg font-semibold mt-2">{@render inline(b.segs)}</h1>
			{:else if b.type === 'h2'}<h2 class="text-base font-semibold mt-2">
					{@render inline(b.segs)}
				</h2>
			{:else if b.type === 'h3'}<h3 class="text-sm font-semibold mt-2">{@render inline(b.segs)}</h3>
			{:else if b.type === 'ul'}<ul class="list-disc pl-5 space-y-0.5">
					{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
				</ul>
			{:else if b.type === 'ol'}<ol class="list-decimal pl-5 space-y-0.5">
					{#each b.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
				</ol>
			{:else if b.type === 'p'}<p>{@render inline(b.segs)}</p>{/if}
		{/each}
	</div>
{/if}
