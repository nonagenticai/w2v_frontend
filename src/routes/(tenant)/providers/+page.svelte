<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Providers (P3 WP5, P8) — GET /api/tenant/connections (the tenant's state, one card
	// per registry slot) + GET /api/provider-requirements (the manifest every form is
	// rendered from: labels, kinds, fields, required rules, secret labels).
	// Writes are tenant_admin only (the server 403s independently). A member reaches
	// this page from a `byo_provider_required` notice, so the (tenant) layout lets
	// /providers through: a member gets a read-only view built from the static
	// manifest (GET /tenant/connections is tenant_admin-only), every control disabled. Saving stays per slot (PUT /tenant/connections/{slot}); the bulk
	// PUT is for API clients, not this screen.
	import { tick } from 'svelte';
	import {
		providers,
		type ProviderSlot,
		type SlotView,
		type TenantLlmAccessView
	} from '$lib/api/providers.js';
	import {
		providerRequirements,
		type PlatformDependency,
		type SlotRequirement
	} from '$lib/api/provider-requirements.js';
	import { youtubeGrantWritability } from '$lib/utils/youtube-status';
	import ProviderSlotCard from '$lib/components/providers/ProviderSlotCard.svelte';
	import YouTubeGrantCard from '$lib/components/providers/YouTubeGrantCard.svelte';
	import { Card, ErrorState, Skeleton } from '$lib/components/ui';
	import { isTenantAdmin } from '$lib/stores/auth.svelte.js';
	import {
		PROBE_CAVEAT,
		slotsFromManifest,
		splitSlots,
		summaryRow
	} from '$lib/components/providers/provider-groups.js';
	import { MISSING_SLOTS_QUERY, parseSlotList, providerSlotAnchor } from '$lib/api/byo-provider.js';
	import { llmAccessBanner } from '$lib/components/providers/llm-access.js';
	import { PLATFORM_GATEWAY_BASE } from '$lib/components/providers/slot-api-shapes.js';

	const canWrite = isTenantAdmin();

	let slots = $state<ProviderSlot[]>([]);
	/** `llm_access` from GET /tenant/connections; null for a member (no tenant state read). */
	let llmAccess = $state<TenantLlmAccessView | null>(null);
	let requirements = $state<Record<string, SlotRequirement>>({});
	let dependencies = $state<PlatformDependency[]>([]);
	let loading = $state(true);
	let error = $state<unknown>(null);
	/** Per-slot message shown after a reload the user did not ask for (VERSION_CONFLICT). */
	let notices = $state<Record<string, string>>({});

	async function load(): Promise<void> {
		error = null;
		try {
			const [list, manifest] = await Promise.all([
				canWrite ? providers.list() : Promise.resolve(null),
				providerRequirements.get()
			]);
			slots = list ? list.items : slotsFromManifest(manifest);
			llmAccess = list?.llm_access ?? null;
			requirements = Object.fromEntries(manifest.slots.map((r) => [r.slot, r]));
			dependencies = manifest.dependencies;
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		void load().then(scrollToLinkedSlot);
	});

	// A `byo_provider_required` notice links here as `/providers#provider-slot-<slot>`.
	// The cards only exist once `load()` has resolved, after the router's own
	// scroll-to-hash already ran and found nothing — so bring the slot into view here.
	async function scrollToLinkedSlot(): Promise<void> {
		const hash = typeof location === 'undefined' ? '' : location.hash.slice(1);
		if (!hash) return;
		await tick();
		document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ block: 'start' });
	}

	// A refused run start links here as `/providers?missing=llm,tts,image#…` (#1150):
	// every slot it named is highlighted, and listed above the cards. Read once —
	// the page is (re)mounted by that navigation.
	const missingSlots: string[] = parseSlotList(
		typeof location === 'undefined'
			? null
			: new URLSearchParams(location.search).get(MISSING_SLOTS_QUERY)
	);
	/** Missing slots that still have no own connection — a saved one drops off the list. */
	const stillMissing = $derived(
		missingSlots.filter((m) => !slots.some((s) => s.slot === m && s.source === 'tenant'))
	);
	const missingLabels = $derived(stillMissing.map((m) => requirements[m]?.label || m));

	const banner = $derived(llmAccessBanner(llmAccess));
	const accessMode = $derived(banner?.mode ?? null);

	function replace(slotName: string, next: SlotView): void {
		slots = slots.map((s) => (s.slot === slotName ? next : s));
	}

	async function changed(slotName: string, next: SlotView | null): Promise<void> {
		const { [slotName]: _dropped, ...rest } = notices;
		notices = rest;
		if (next) replace(slotName, next);
		else await load();
	}

	async function reload(slotName: string, message: string): Promise<void> {
		await load();
		notices = { ...notices, [slotName]: message };
	}

	// Re-mount a card whenever its server state changes so its form starts clean.
	const cardKey = (s: ProviderSlot): string =>
		`${s.slot}:${s.source}:${s.connection?.version ?? 0}:${notices[s.slot] ?? ''}`;

	// `publish.youtube` is a grant (OAuth), not a connection: it gets its own card,
	// driven by /api/youtube/auth/*, whether or not the registry lists it.
	const YOUTUBE_SLOT = 'publish.youtube';
	const connectionSlots = $derived(slots.filter((s) => s.slot !== YOUTUBE_SLOT));
	/** GPU & model services (`GPU_SLOTS`: llm … ocr, video_gen), writable or not. */
	const groups = $derived(splitSlots(connectionSlots));
	const gpu = $derived(groups.gpu);
	const integrations = $derived(groups.other.filter((s) => s.writable));
	const platform = $derived(groups.other.filter((s) => !s.writable));
	const summary = $derived(gpu.map((s) => summaryRow(s, requirements[s.slot], accessMode)));
	const youtubeGate = $derived(
		youtubeGrantWritability({
			view: slots.find((s) => s.slot === YOUTUBE_SLOT),
			requirement: requirements[YOUTUBE_SLOT]
		})
	);
</script>

<Page width="narrow" testid="providers-home">
	<PageHeader
		kicker="Workspace"
		title="Providers"
		subtitle="Register your own GPU and model services per service type, or keep the platform default. A connection is tested live before it is saved; API keys are write-only and never shown again."
	/>

	{#if loading}
		<Card class="p-2"><Skeleton variant="text" count={4} height="2.25rem" /></Card>
	{:else if error}
		<ErrorState title="Couldn't load providers" {error} onRetry={load} />
	{:else}
		<div class="flex min-w-0 flex-col gap-4">
			{#if banner}
				<div
					class="rounded-[var(--radius-md)] border p-4 text-sm text-[var(--color-text)] {banner.tone ===
					'warning'
						? 'border-status-pending/40 bg-status-pending/10'
						: 'border-[var(--color-border)]'}"
					role="note"
					data-testid="providers-llm-access"
					data-mode={banner.mode}
				>
					<p class="font-semibold">
						<span class="text-xs font-medium text-[var(--color-text-muted)]"
							>Service access ·
						</span>{banner.title}
					</p>
					<p class="mt-1 text-[var(--color-text-muted)]">{banner.body}</p>
				</div>
			{/if}
			{#if stillMissing.length > 0}
				<div
					class="rounded-[var(--radius-md)] border border-status-pending/40 bg-status-pending/10 p-4 text-sm text-[var(--color-text)]"
					role="alert"
					data-testid="providers-missing"
					data-slots={stillMissing.join(',')}
				>
					<p class="font-semibold">Your run needs your own providers</p>
					<p class="mt-1 text-[var(--color-text-muted)]">
						Register {missingLabels.join(', ')} below, then start the run again.
					</p>
				</div>
			{/if}
			{#if !canWrite}
				<div
					class="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-sm text-[var(--color-text)]"
					role="note"
					data-testid="providers-readonly"
				>
					<p class="font-semibold">Read only</p>
					<p class="mt-1 text-[var(--color-text-muted)]">
						Registering or changing providers needs the tenant_admin role. Ask a workspace admin to
						register a service; the forms below show what each one needs.
					</p>
				</div>
			{/if}

			<section class="flex min-w-0 flex-col gap-4" data-testid="providers-gpu">
				<div>
					<h2 class="text-base font-semibold text-[var(--color-text)]">GPU &amp; model services</h2>
					<p class="mt-1 text-xs text-[var(--color-text-muted)]">{PROBE_CAVEAT}</p>
					<p
						class="mt-1 text-xs break-words text-[var(--color-text-muted)]"
						data-testid="providers-gateway-hint"
					>
						Each service lists the API shape it expects. A provider can be your own endpoint or the
						platform gateway, <code class="break-all">{PLATFORM_GATEWAY_BASE}/&lt;service&gt;</code
						>, with your licence token as the key.
					</p>
				</div>
				{#if canWrite && summary.length > 0}
					<Card class="overflow-hidden p-0">
						<table class="w-full table-fixed text-left text-sm" data-testid="providers-summary">
							<thead class="text-xs text-[var(--color-text-muted)]">
								<tr>
									<th class="w-[30%] px-3 py-2 font-medium">Service</th>
									<th class="w-[25%] px-3 py-2 font-medium">Source</th>
									<th class="px-3 py-2 font-medium">Model</th>
									<th class="w-[17%] px-3 py-2 font-medium">Key</th>
								</tr>
							</thead>
							<tbody>
								{#each summary as row (row.slot)}
									<tr
										class="border-t border-[var(--color-border)] align-top"
										data-testid="providers-summary-{row.slot}"
										data-source={row.source}
									>
										<td class="px-3 py-2 break-words">
											<a
												class="underline-offset-2 hover:underline"
												href="#{providerSlotAnchor(row.slot)}">{row.label}</a
											>
										</td>
										<td
											class="px-3 py-2 break-words {row.source === 'required'
												? 'text-xs font-medium text-[var(--color-danger)]'
												: ''}"
											data-testid="providers-summary-source">{row.sourceLabel}</td
										>
										<td class="px-3 py-2 break-all" data-testid="providers-summary-model"
											>{row.model}</td
										>
										<td class="px-3 py-2" data-testid="providers-summary-key">{row.key}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</Card>
				{/if}
				{#each gpu as s (cardKey(s))}
					<ProviderSlotCard
						slot={s}
						requirement={requirements[s.slot]}
						missing={stillMissing.includes(s.slot)}
						notice={notices[s.slot] ?? null}
						{canWrite}
						stateKnown={canWrite}
						access={accessMode}
						onchanged={(next) => changed(s.slot, next)}
						onreload={(message) => reload(s.slot, message)}
					/>
				{/each}
			</section>

			<section class="flex min-w-0 flex-col gap-4" data-testid="providers-integrations">
				<h2 class="mt-4 text-base font-semibold text-[var(--color-text)]">Integrations</h2>
				{#each integrations as s (cardKey(s))}
					<ProviderSlotCard
						slot={s}
						requirement={requirements[s.slot]}
						notice={notices[s.slot] ?? null}
						{canWrite}
						stateKnown={canWrite}
						access={accessMode}
						onchanged={(next) => changed(s.slot, next)}
						onreload={(message) => reload(s.slot, message)}
					/>
				{/each}
				<h3 class="text-sm font-semibold text-[var(--color-text-muted)]">Publishing</h3>
				{#if canWrite}
					<YouTubeGrantCard
						writable={youtubeGate.writable}
						notWritableReason={youtubeGate.reason}
					/>
				{:else}
					<p
						class="text-sm text-[var(--color-text-muted)]"
						data-testid="providers-youtube-readonly"
					>
						YouTube publishing is connected by a workspace admin.
					</p>
				{/if}
				{#if platform.length > 0}
					<h3 class="mt-2 text-sm font-semibold text-[var(--color-text-muted)]">
						Platform provided
					</h3>
					{#each platform as s (cardKey(s))}
						<ProviderSlotCard
							slot={s}
							requirement={requirements[s.slot]}
							{canWrite}
							stateKnown={canWrite}
							onchanged={(next) => changed(s.slot, next)}
							onreload={(message) => reload(s.slot, message)}
						/>
					{/each}
				{/if}
			</section>
			{#if dependencies.length > 0}
				<div data-testid="provider-dependencies">
					<h2 class="mt-4 text-sm font-semibold text-[var(--color-text-muted)]">
						Platform dependencies
					</h2>
					<p class="mt-1 text-xs text-[var(--color-text-muted)]">
						Services Studio relies on that are provided by the platform. They are not configurable
						per workspace.
					</p>
					<ul class="mt-2 flex flex-col gap-2">
						{#each dependencies as d (d.name)}
							<li
								class="text-sm text-[var(--color-text)]"
								data-testid="provider-dependency-{d.name}"
							>
								<span class="font-medium">{d.label}</span>
								{#if d.description}
									<span class="text-xs text-[var(--color-text-muted)]"> — {d.description}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</Page>
