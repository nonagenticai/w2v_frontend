<script lang="ts">
	import {
		ChevronDown,
		ChevronUp,
		Mic,
		Settings,
		Smartphone,
		Palette,
		Video
	} from '@lucide/svelte';
	import { Select, Input } from '$lib/components/ui';
	import { wizard } from '$lib/stores/wizard.svelte.js';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		serverConfigured = false,
		serverProvider = '',
		isMobilePlatform = false,
		showLlm = true,
		showLook = true
	}: {
		serverConfigured?: boolean;
		serverProvider?: string;
		isMobilePlatform?: boolean;
		showLlm?: boolean;
		/** Theme + Video Options sections; false for audio-only types (audiobook). */
		showLook?: boolean;
	} = $props();

	// Accordion state
	const openSections = new SvelteSet<string>(['narration']);

	function toggleSection(key: string) {
		if (openSections.has(key)) {
			openSections.delete(key);
		} else {
			openSections.add(key);
		}
	}

	// --- TTS data ---
	const ttsOptions = [
		{ value: 'kokoro', label: 'Kokoro (Free, Local)' },
		{ value: 'kitten', label: 'KittenTTS (Free, Local)' },
		{ value: 'openai', label: 'OpenAI' },
		{ value: 'elevenlabs', label: 'ElevenLabs' },
		{ value: 'none', label: 'None (No Narration)' }
	];

	const kokoroVoiceGroups = [
		{
			label: 'American English',
			voices: [
				{ value: 'af_alloy', label: 'Alloy (F)' },
				{ value: 'af_aoede', label: 'Aoede (F)' },
				{ value: 'af_bella', label: 'Bella (F)' },
				{ value: 'af_heart', label: 'Heart (F)' },
				{ value: 'af_jessica', label: 'Jessica (F)' },
				{ value: 'af_kore', label: 'Kore (F)' },
				{ value: 'af_nicole', label: 'Nicole (F)' },
				{ value: 'af_nova', label: 'Nova (F)' },
				{ value: 'af_river', label: 'River (F)' },
				{ value: 'af_sarah', label: 'Sarah (F)' },
				{ value: 'af_sky', label: 'Sky (F)' },
				{ value: 'am_adam', label: 'Adam (M)' },
				{ value: 'am_echo', label: 'Echo (M)' },
				{ value: 'am_eric', label: 'Eric (M)' },
				{ value: 'am_fenrir', label: 'Fenrir (M)' },
				{ value: 'am_liam', label: 'Liam (M)' },
				{ value: 'am_michael', label: 'Michael (M)' },
				{ value: 'am_onyx', label: 'Onyx (M)' },
				{ value: 'am_puck', label: 'Puck (M)' },
				{ value: 'am_santa', label: 'Santa (M)' }
			]
		},
		{
			label: 'British English',
			voices: [
				{ value: 'bf_alice', label: 'Alice (F)' },
				{ value: 'bf_emma', label: 'Emma (F)' },
				{ value: 'bf_isabella', label: 'Isabella (F)' },
				{ value: 'bf_lily', label: 'Lily (F)' },
				{ value: 'bm_daniel', label: 'Daniel (M)' },
				{ value: 'bm_fable', label: 'Fable (M)' },
				{ value: 'bm_george', label: 'George (M)' },
				{ value: 'bm_lewis', label: 'Lewis (M)' }
			]
		},
		{
			label: 'Spanish',
			voices: [
				{ value: 'ef_dora', label: 'Dora (F)' },
				{ value: 'em_alex', label: 'Alex (M)' },
				{ value: 'em_santa', label: 'Santa (M)' }
			]
		},
		{
			label: 'French',
			voices: [{ value: 'ff_siwis', label: 'Siwis (F)' }]
		},
		{
			label: 'Hindi',
			voices: [
				{ value: 'hf_alpha', label: 'Alpha (F)' },
				{ value: 'hf_beta', label: 'Beta (F)' },
				{ value: 'hm_omega', label: 'Omega (M)' },
				{ value: 'hm_psi', label: 'Psi (M)' }
			]
		},
		{
			label: 'Italian',
			voices: [
				{ value: 'if_sara', label: 'Sara (F)' },
				{ value: 'im_nicola', label: 'Nicola (M)' }
			]
		},
		{
			label: 'Japanese',
			voices: [
				{ value: 'jf_alpha', label: 'Alpha (F)' },
				{ value: 'jf_gongitsune', label: 'Gongitsune (F)' },
				{ value: 'jf_nezumi', label: 'Nezumi (F)' },
				{ value: 'jf_tebukuro', label: 'Tebukuro (F)' },
				{ value: 'jm_kumo', label: 'Kumo (M)' }
			]
		},
		{
			label: 'Portuguese',
			voices: [
				{ value: 'pf_dora', label: 'Dora (F)' },
				{ value: 'pm_alex', label: 'Alex (M)' },
				{ value: 'pm_santa', label: 'Santa (M)' }
			]
		},
		{
			label: 'Chinese',
			voices: [
				{ value: 'zf_xiaobei', label: 'Xiaobei (F)' },
				{ value: 'zf_xiaoni', label: 'Xiaoni (F)' },
				{ value: 'zf_xiaoxiao', label: 'Xiaoxiao (F)' },
				{ value: 'zf_xiaoyi', label: 'Xiaoyi (F)' },
				{ value: 'zm_yunjian', label: 'Yunjian (M)' },
				{ value: 'zm_yunxi', label: 'Yunxi (M)' },
				{ value: 'zm_yunxia', label: 'Yunxia (M)' },
				{ value: 'zm_yunyang', label: 'Yunyang (M)' }
			]
		}
	];

	const kittenVoices = [
		{ value: 'bella', label: 'Bella (F)' },
		{ value: 'jasper', label: 'Jasper (M)' },
		{ value: 'luna', label: 'Luna (F)' },
		{ value: 'bruno', label: 'Bruno (M)' },
		{ value: 'rosie', label: 'Rosie (F)' },
		{ value: 'hugo', label: 'Hugo (M)' },
		{ value: 'kiki', label: 'Kiki (F)' },
		{ value: 'leo', label: 'Leo (M)' }
	];

	// --- AI Models data ---
	const providerOptions = [
		{ value: 'anthropic', label: 'Anthropic' },
		{ value: 'deepseek', label: 'DeepSeek' },
		{ value: 'openai', label: 'OpenAI-compatible' },
		{ value: 'claude_code', label: 'Claude Code CLI' }
	];

	const modelsByProvider: Record<string, Array<{ value: string; label: string }>> = {
		anthropic: [
			{ value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
			{ value: 'claude-sonnet-4-5-20250514', label: 'Sonnet 4.5' },
			{ value: 'claude-sonnet-4-6-20250620', label: 'Sonnet 4.6' },
			{ value: 'claude-opus-4-6-20250618', label: 'Opus 4.6' }
		],
		deepseek: [
			{ value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
			{ value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
		],
		openai: [
			{ value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
			{ value: 'gpt-4o', label: 'GPT-4o' },
			{ value: 'o3-mini', label: 'o3 Mini' }
		],
		claude_code: [
			{ value: 'haiku', label: 'Haiku' },
			{ value: 'sonnet', label: 'Sonnet' },
			{ value: 'opus', label: 'Opus' }
		]
	};

	const providerDefaults: Record<string, { fast: string; balanced: string; capable: string }> = {
		anthropic: {
			fast: 'claude-haiku-4-5-20251001',
			balanced: 'claude-sonnet-4-5-20250514',
			capable: 'claude-sonnet-4-5-20250514'
		},
		deepseek: {
			fast: 'deepseek-v4-flash',
			balanced: 'deepseek-v4-flash',
			capable: 'deepseek-v4-pro'
		},
		openai: {
			fast: 'gpt-4o-mini',
			balanced: 'gpt-4o',
			capable: 'gpt-4o'
		},
		claude_code: {
			fast: 'haiku',
			balanced: 'sonnet',
			capable: 'sonnet'
		}
	};

	const stageGroups = [
		{
			label: 'Analysis & Evaluation',
			stages: [
				{
					key: 'analyze',
					name: 'Analyze',
					desc: 'Website description, audience, use cases',
					tier: 'fast'
				},
				{
					key: 'review',
					name: 'Review',
					desc: 'Design, usability, feature, content reviews',
					tier: 'balanced'
				},
				{ key: 'critique', name: 'Critique/UX', desc: 'UX findings per page', tier: 'balanced' },
				{ key: 'enhance', name: 'Critique/Summary', desc: 'Report narrative summary', tier: 'fast' }
			]
		},
		{
			label: 'Creative Writing',
			stages: [
				{
					key: 'storyline',
					name: 'Storyline',
					desc: 'Video narrative structure',
					tier: 'balanced'
				},
				{ key: 'narrate', name: 'Narrate', desc: 'Voice-over text per chapter', tier: 'fast' },
				{ key: 'shotlist', name: 'Shotlist', desc: 'Action description enhancement', tier: 'fast' }
			]
		},
		{
			label: 'Code Generation',
			stages: [
				{
					key: 'generate',
					name: 'Generate',
					desc: 'Playwright TypeScript scripts',
					tier: 'capable'
				},
				{ key: 'validate', name: 'Validate', desc: 'Fix failing scripts', tier: 'capable' }
			]
		},
		{
			label: 'Post-Production',
			stages: [{ key: 'compile', name: 'Compile', desc: 'Video edit plan', tier: 'fast' }]
		}
	];

	const tierLabels: Record<string, string> = {
		fast: 'Fast',
		balanced: 'Balanced',
		capable: 'Capable'
	};

	let currentModels = $derived(modelsByProvider[wizard.llmProvider] ?? modelsByProvider.anthropic);
	let showOverrides = $state(false);

	// Theme options
	const themeOptions = [
		{ value: 'default', label: 'Default' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'light', label: 'Light' },
		{ value: 'custom', label: 'Custom' }
	];

	// Video options
	const resolutionOptions = [
		// Exactly the orchestrator's tiers (motion_slides._TIER_SCALE); any other
		// value is coerced to its default (2k), so 720p was never deliverable.
		{ value: '1080p', label: '1080p (Full HD)' },
		{ value: '2k', label: '2K (QHD)' },
		{ value: '4k', label: '4K (Ultra HD)' }
	];

	const frameRateOptions = [
		{ value: '24', label: '24 fps (Cinematic)' },
		{ value: '30', label: '30 fps (Standard)' },
		{ value: '60', label: '60 fps (Smooth)' }
	];

	const transitionOptions = [
		{ value: 'fade', label: 'Fade' },
		{ value: 'slide', label: 'Slide' },
		{ value: 'dissolve', label: 'Dissolve' },
		{ value: 'none', label: 'None' }
	];

	// Device options for mobile
	const iosDevices = [
		'Auto (recommended)',
		'iPhone 15 Pro',
		'iPhone 15',
		'iPhone 16 Pro',
		'iPhone 16',
		'iPad Pro (12.9-inch)',
		'iPad Air'
	];
	const androidDevices = [
		'Auto (recommended)',
		'Pixel 8',
		'Pixel 8 Pro',
		'Pixel 9',
		'Samsung Galaxy S24',
		'Samsung Galaxy S24 Ultra'
	];

	const inputClasses =
		'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-colors';

	function handleProviderChange() {
		const defaults = providerDefaults[wizard.llmProvider] ?? providerDefaults.anthropic;
		wizard.modelFast = defaults.fast;
		wizard.modelBalanced = defaults.balanced;
		wizard.modelCapable = defaults.capable;
		wizard.stageOverrides = {};
	}

	function getTierModel(tier: string): string {
		if (tier === 'fast') return wizard.modelFast;
		if (tier === 'balanced') return wizard.modelBalanced;
		return wizard.modelCapable;
	}

	function getModelLabel(modelId: string): string {
		for (const models of Object.values(modelsByProvider)) {
			const found = models.find((m) => m.value === modelId);
			if (found) return found.label;
		}
		return modelId;
	}

	function toggleOverride(stageKey: string) {
		if (wizard.stageOverrides[stageKey]) {
			const next = { ...wizard.stageOverrides };
			delete next[stageKey];
			wizard.stageOverrides = next;
		} else {
			wizard.stageOverrides = { ...wizard.stageOverrides, [stageKey]: {} };
		}
	}

	function setOverrideProvider(stageKey: string, value: string) {
		const newProvider = value || undefined;
		const newModel = value ? (providerDefaults[value]?.balanced ?? '') : undefined;
		wizard.stageOverrides = {
			...wizard.stageOverrides,
			[stageKey]: { provider: newProvider, model: newModel }
		};
	}

	function setOverrideModel(stageKey: string, value: string) {
		const current = wizard.stageOverrides[stageKey] ?? {};
		wizard.stageOverrides = {
			...wizard.stageOverrides,
			[stageKey]: { ...current, model: value || undefined }
		};
	}

	function getOverrideModels(stageKey: string): Array<{ value: string; label: string }> {
		const overrideProvider = wizard.stageOverrides[stageKey]?.provider ?? wizard.llmProvider;
		return modelsByProvider[overrideProvider] ?? modelsByProvider.anthropic;
	}

	// Accordion sections config
	const sections = $derived([
		{ key: 'narration', label: 'Narration', icon: Mic },
		// AI-models override UI is hidden unless `showLlm` — `resolve_llm_config`
		// has no stage callers in the blueprint engine, so per-stage/provider LLM
		// overrides are not consumed and would be a false affordance.
		...(showLlm ? [{ key: 'ai-models', label: 'AI Models', icon: Settings }] : []),
		...(isMobilePlatform ? [{ key: 'device-farm', label: 'Device Farm', icon: Smartphone }] : []),
		...(showLook
			? [
					{ key: 'theme', label: 'Video theme', icon: Palette },
					{ key: 'video-options', label: 'Video Options', icon: Video }
				]
			: [])
	]);
</script>

<div class="space-y-3">
	<div>
		<h3 class="text-base font-semibold text-[var(--color-text)]">Settings</h3>
		<p class="mt-1 text-sm text-[var(--color-text-muted)]">
			Fine-tune narration, models, and output settings
		</p>
	</div>

	{#each sections as section (section.key)}
		{@const isOpen = openSections.has(section.key)}
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
		>
			<!-- Section header -->
			<button
				type="button"
				onclick={() => toggleSection(section.key)}
				class="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--color-surface-strong)] transition-colors"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-text-muted)]"
					>
						<section.icon class="h-4 w-4" />
					</div>
					<span class="text-sm font-semibold text-[var(--color-text)]">{section.label}</span>
				</div>
				{#if isOpen}
					<ChevronUp class="h-4 w-4 text-[var(--color-text-muted)]" />
				{:else}
					<ChevronDown class="h-4 w-4 text-[var(--color-text-muted)]" />
				{/if}
			</button>

			<!-- Section content -->
			{#if isOpen}
				<div class="border-t border-[var(--color-border)] px-4 py-4">
					<!-- Narration -->
					{#if section.key === 'narration'}
						<div class="space-y-4">
							<Select
								name="ttsProvider"
								label="TTS Provider"
								bind:value={wizard.ttsProvider}
								options={ttsOptions}
							/>

							{#if wizard.ttsProvider === 'kokoro'}
								<div class="flex flex-col gap-1.5">
									<label for="voice" class="text-sm font-medium text-[var(--color-text-muted)]">
										Voice
									</label>
									<select id="voice" name="voice" bind:value={wizard.voice} class={inputClasses}>
										{#each kokoroVoiceGroups as group (group.label)}
											<optgroup label={group.label}>
												{#each group.voices as v (v.value)}
													<option value={v.value}>{v.label}</option>
												{/each}
											</optgroup>
										{/each}
									</select>
								</div>
							{:else if wizard.ttsProvider === 'kitten'}
								<div class="space-y-1">
									<label
										for="kittenVoice"
										class="text-sm font-medium text-[var(--color-text-muted)]"
									>
										Voice
									</label>
									<select
										id="kittenVoice"
										bind:value={wizard.voice}
										class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
									>
										{#each kittenVoices as v (v.value)}
											<option value={v.value}>{v.label}</option>
										{/each}
									</select>
								</div>
							{:else if wizard.ttsProvider !== 'none'}
								<Input
									name="voice"
									label="Voice ID"
									bind:value={wizard.voice}
									placeholder="af_heart"
								/>
							{/if}

							{#if wizard.ttsProvider !== 'none'}
								<div class="space-y-2">
									<div class="flex items-center justify-between">
										<label
											for="narrationSpeed"
											class="text-sm font-medium text-[var(--color-text-muted)]"
										>
											Speed
										</label>
										<span class="text-sm font-semibold text-[var(--color-text)]">
											{wizard.narrationSpeed.toFixed(1)}x
										</span>
									</div>
									<input
										id="narrationSpeed"
										type="range"
										min="0.5"
										max="2.0"
										step="0.1"
										bind:value={wizard.narrationSpeed}
										class="w-full accent-[var(--color-accent)]"
									/>
									<div class="flex justify-between text-xs text-[var(--color-text-muted)]">
										<span>0.5x</span>
										<span>2.0x</span>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- AI Models -->
					{#if section.key === 'ai-models'}
						<div class="space-y-4">
							{#if serverConfigured}
								<div
									class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-bg)] px-4 py-3"
								>
									<p class="text-sm text-[var(--color-accent)]">
										Using server configuration: <span class="font-semibold">
											{providerOptions.find((p) => p.value === serverProvider)?.label ??
												serverProvider}
										</span>
									</p>
									<p class="text-xs text-[var(--color-accent)] mt-1">
										Pre-configured via environment variables. You can still change values below.
									</p>
								</div>
							{/if}

							<Select
								name="llmProvider"
								label="Provider"
								bind:value={wizard.llmProvider}
								options={providerOptions}
								onchange={handleProviderChange}
							/>

							{#if wizard.llmProvider === 'openai'}
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
									<Input
										name="openaiBaseUrl"
										label="Base URL"
										bind:value={wizard.openaiBaseUrl}
										placeholder="https://api.example.com/v1"
									/>
									<Input
										name="openaiApiKeyEnv"
										label="API Key env var"
										bind:value={wizard.openaiApiKeyEnv}
										placeholder="DEEPSEEK_API_KEY"
									/>
								</div>
							{/if}

							<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div class="flex flex-col gap-1.5">
									<label for="modelFast" class="text-sm font-medium text-[var(--color-text-muted)]">
										Fast tier
									</label>
									<p class="text-xs text-[var(--color-text-muted)]">Analyze, Narrate, Shotlist</p>
									<select
										id="modelFast"
										name="modelFast"
										bind:value={wizard.modelFast}
										class={inputClasses}
									>
										{#each currentModels as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
								<div class="flex flex-col gap-1.5">
									<label
										for="modelBalanced"
										class="text-sm font-medium text-[var(--color-text-muted)]"
									>
										Balanced tier
									</label>
									<p class="text-xs text-[var(--color-text-muted)]">Review, Storyline, Critique</p>
									<select
										id="modelBalanced"
										name="modelBalanced"
										bind:value={wizard.modelBalanced}
										class={inputClasses}
									>
										{#each currentModels as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
								<div class="flex flex-col gap-1.5">
									<label
										for="modelCapable"
										class="text-sm font-medium text-[var(--color-text-muted)]"
									>
										Capable tier
									</label>
									<p class="text-xs text-[var(--color-text-muted)]">Generate, Validate</p>
									<select
										id="modelCapable"
										name="modelCapable"
										bind:value={wizard.modelCapable}
										class={inputClasses}
									>
										{#each currentModels as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
							</div>

							<!-- Per-stage overrides -->
							<div class="border border-[var(--color-border)] rounded-xl">
								<button
									type="button"
									onclick={() => (showOverrides = !showOverrides)}
									class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
								>
									<span>Customize per stage</span>
									{#if showOverrides}
										<ChevronUp class="h-4 w-4" />
									{:else}
										<ChevronDown class="h-4 w-4" />
									{/if}
								</button>

								{#if showOverrides}
									<div class="border-t border-[var(--color-border)] px-4 py-4 space-y-6">
										{#each stageGroups as group (group.label)}
											<div>
												<h4
													class="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3"
												>
													{group.label}
												</h4>
												<div class="space-y-3">
													{#each group.stages as stage (stage.key)}
														{@const isOverridden = !!wizard.stageOverrides[stage.key]}
														<div
															class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
														>
															<div class="flex items-center justify-between">
																<div class="flex-1 min-w-0">
																	<div class="flex items-center gap-2">
																		<span class="text-sm font-medium text-[var(--color-text)]">
																			{stage.name}
																		</span>
																		<span class="text-xs text-[var(--color-text-muted)]">
																			{stage.desc}
																		</span>
																	</div>
																	{#if !isOverridden}
																		<p class="text-xs text-[var(--color-text-muted)] mt-1">
																			Using {tierLabels[stage.tier]} default: {getModelLabel(
																				getTierModel(stage.tier)
																			)}
																		</p>
																	{/if}
																</div>
																<button
																	type="button"
																	onclick={() => toggleOverride(stage.key)}
																	aria-label="Override model for {stage.name}"
																	class="ml-3 shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors {isOverridden
																		? 'bg-[var(--color-accent)]'
																		: 'bg-[var(--color-text-muted)]'}"
																>
																	<span
																		class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {isOverridden
																			? 'translate-x-4.5'
																			: 'translate-x-0.5'}"
																	></span>
																</button>
															</div>
															{#if isOverridden}
																<div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
																	<div class="flex flex-col gap-1">
																		<label
																			for="provider-{stage.key}"
																			class="text-xs text-[var(--color-text-muted)]"
																		>
																			Provider
																		</label>
																		<select
																			id="provider-{stage.key}"
																			class={inputClasses}
																			value={wizard.stageOverrides[stage.key]?.provider ?? ''}
																			onchange={(e) =>
																				setOverrideProvider(
																					stage.key,
																					(e.target as HTMLSelectElement).value
																				)}
																		>
																			<option value="">
																				Same as global ({providerOptions.find(
																					(p) => p.value === wizard.llmProvider
																				)?.label})
																			</option>
																			{#each providerOptions as opt (opt.value)}
																				<option value={opt.value}>{opt.label}</option>
																			{/each}
																		</select>
																	</div>
																	<div class="flex flex-col gap-1">
																		<label
																			for="model-{stage.key}"
																			class="text-xs text-[var(--color-text-muted)]"
																		>
																			Model
																		</label>
																		<select
																			id="model-{stage.key}"
																			class={inputClasses}
																			value={wizard.stageOverrides[stage.key]?.model ?? ''}
																			onchange={(e) =>
																				setOverrideModel(
																					stage.key,
																					(e.target as HTMLSelectElement).value
																				)}
																		>
																			<option value="">Tier default</option>
																			{#each getOverrideModels(stage.key) as opt (opt.value)}
																				<option value={opt.value}>{opt.label}</option>
																			{/each}
																		</select>
																	</div>
																</div>
															{/if}
														</div>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Device Farm -->
					{#if section.key === 'device-farm'}
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Select a device for mobile app recording
							</p>
							<div class="flex flex-col gap-1.5">
								<label
									for="device-select"
									class="text-sm font-medium text-[var(--color-text-muted)]"
								>
									Device
								</label>
								<select id="device-select" bind:value={wizard.deviceName} class={inputClasses}>
									{#each isMobilePlatform ? (wizard.deviceName && iosDevices.includes(wizard.deviceName) ? iosDevices : androidDevices) : [] as device (device)}
										<option value={device}>{device}</option>
									{/each}
								</select>
							</div>
						</div>
					{/if}

					<!-- Theme -->
					{#if section.key === 'theme'}
						<div class="space-y-4">
							<p class="text-xs text-[var(--color-text-muted)]" data-testid="video-theme-hint">
								The look of the rendered video. This is separate from the app's interface theme.
							</p>
							<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
								{#each themeOptions as opt (opt.value)}
									<button
										type="button"
										onclick={() => (wizard.theme = opt.value)}
										class="rounded-lg border px-3 py-2 text-sm font-medium transition-colors {wizard.theme ===
										opt.value
											? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
											: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)]'}"
									>
										{opt.label}
									</button>
								{/each}
							</div>

							{#if wizard.theme === 'custom'}
								<div class="flex items-center gap-3">
									<label
										for="brandColor"
										class="text-sm font-medium text-[var(--color-text-muted)]"
									>
										Brand Color
									</label>
									<div class="flex items-center gap-2">
										<input
											type="color"
											id="brandColor"
											bind:value={wizard.brandColor}
											class="h-8 w-8 cursor-pointer rounded border border-[var(--color-border)]"
										/>
										<Input
											name="brandColorHex"
											placeholder="#4F46E5"
											bind:value={wizard.brandColor}
										/>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Video Options -->
					{#if section.key === 'video-options'}
						<div class="space-y-4">
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<Select
									name="resolution"
									label="Resolution"
									bind:value={wizard.resolution}
									options={resolutionOptions}
								/>
								<Select
									name="frameRate"
									label="Frame Rate"
									bind:value={wizard.frameRate}
									options={frameRateOptions}
								/>
							</div>
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<label
										for="videoQuality"
										class="text-sm font-medium text-[var(--color-text-muted)]"
									>
										Quality
									</label>
									<span class="text-sm font-semibold text-[var(--color-text)]">
										{wizard.videoQuality}%
									</span>
								</div>
								<input
									id="videoQuality"
									type="range"
									min="30"
									max="100"
									bind:value={wizard.videoQuality}
									class="w-full accent-[var(--color-accent)]"
								/>
								<div class="flex justify-between text-xs text-[var(--color-text-muted)]">
									<span>Low</span>
									<span>High</span>
								</div>
							</div>
							<Select
								name="transitionType"
								label="Transition Type"
								bind:value={wizard.transitionType}
								options={transitionOptions}
							/>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/each}
</div>
