<script lang="ts">
	import { Input, Select } from '$lib/components/ui';
	import {
		DELIVERABLE_FORMAT_LABELS,
		CAPTIONS_MODE_LABELS,
		type DeliverableInput,
		type DeliverableFormat,
		type CaptionsMode
	} from '$lib/types';

	let {
		deliverable = $bindable<DeliverableInput>({
			name: '',
			format: '16x9',
			target_duration_seconds: null,
			captions_mode: 'none'
		}),
		minDurationSeconds = null,
		inheritCaptions = false,
		inheritedCaptionsMode = null,
		showDuration = true
	}: {
		deliverable?: DeliverableInput;
		/** Floor for this type's target duration (website_review: 10s); null = none. */
		minDurationSeconds?: number | null;
		/** Offer "Workspace default" for captions: picking it OMITS `captions_mode`, so the
		 *  orchestrator applies the workspace default (P6). The New Project wizard sets it. */
		inheritCaptions?: boolean;
		/** What the workspace default resolves to, for the option label; null = unknown. */
		inheritedCaptionsMode?: CaptionsMode | null;
		/** False for types whose pipeline never reads a target duration (audits). */
		showDuration?: boolean;
	} = $props();

	const durationTooShort = $derived(
		minDurationSeconds !== null &&
			typeof deliverable.target_duration_seconds === 'number' &&
			deliverable.target_duration_seconds < minDurationSeconds
	);

	// 'audio' is an audiobook-only format injected by the wizard (project-request.ts);
	// it is never a manual choice for video deliverables, so it's filtered out here.
	const formatOptions = (Object.keys(DELIVERABLE_FORMAT_LABELS) as DeliverableFormat[])
		.filter((key) => key !== 'audio')
		.map((key) => ({ value: key, label: DELIVERABLE_FORMAT_LABELS[key] }));
	const modeOptions = (Object.keys(CAPTIONS_MODE_LABELS) as CaptionsMode[]).map((key) => ({
		value: key,
		label: CAPTIONS_MODE_LABELS[key]
	}));
	const captionsOptions = $derived(
		inheritCaptions
			? [
					{
						value: '',
						label: inheritedCaptionsMode
							? `Workspace default (${CAPTIONS_MODE_LABELS[inheritedCaptionsMode]})`
							: 'Workspace default'
					},
					...modeOptions
				]
			: modeOptions
	);

	function setCaptions(value: string) {
		if (value === '') {
			const { captions_mode: _dropped, ...rest } = deliverable;
			deliverable = rest;
		} else {
			update({ captions_mode: value as CaptionsMode });
		}
	}

	function update(patch: Partial<DeliverableInput>) {
		deliverable = { ...deliverable, ...patch };
	}
</script>

<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
	<Input
		name="deliverable-name"
		label="Name"
		placeholder="e.g. 60s horizontal"
		value={deliverable.name}
		oninput={(e) => update({ name: (e.currentTarget as HTMLInputElement).value })}
		class="md:col-span-2"
	/>

	<Select
		name="deliverable-format"
		label="Format"
		options={formatOptions}
		value={deliverable.format}
		onchange={(e) =>
			update({
				format: (e.currentTarget as HTMLSelectElement).value as DeliverableInput['format']
			})}
	/>

	{#if showDuration}
		<div class="flex flex-col gap-1">
			<Input
				name="deliverable-duration"
				label="Target duration (seconds)"
				type="number"
				min={minDurationSeconds !== null ? String(minDurationSeconds) : '1'}
				error={durationTooShort
					? `At least ${minDurationSeconds} seconds for this type of video.`
					: undefined}
				placeholder="60"
				value={deliverable.target_duration_seconds === null ||
				deliverable.target_duration_seconds === undefined
					? ''
					: String(deliverable.target_duration_seconds)}
				oninput={(e) => {
					const raw = (e.currentTarget as HTMLInputElement).value;
					const n = raw === '' ? null : Number(raw);
					update({ target_duration_seconds: Number.isFinite(n) ? n : null });
				}}
			/>
			{#if minDurationSeconds !== null && !durationTooShort}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="deliverable-duration-hint">
					Minimum {minDurationSeconds}s — the shortest order this type accepts.
				</p>
			{/if}
		</div>
	{/if}

	<Select
		name="deliverable-captions"
		label="Captions"
		options={captionsOptions}
		value={deliverable.captions_mode ?? (inheritCaptions ? '' : 'none')}
		placeholder=""
		onchange={(e) => setCaptions((e.currentTarget as HTMLSelectElement).value)}
		class="md:col-span-2"
	/>
</div>
