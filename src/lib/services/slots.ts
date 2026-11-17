/**
 * Service test-bench descriptors — one entry per GPU slot the playground at
 * `/(tenant)/services/[slot]` renders.
 *
 * The page is DESCRIPTOR-DRIVEN: the form fields, the request encoding (JSON vs
 * multipart), the result renderer and the example copy all come from here. Adding
 * a slot means adding an entry, not touching the page.
 *
 * Pure: no Svelte, no I/O — `slots.test.ts`. The HTTP client lives in
 * `$lib/api/serviceLab.ts` and the frozen wire contract there, not here.
 *
 * Note the one naming mismatch this module owns: the playground id for video is
 * `video` (the URL and `POST /api/services/video`), while the provider registry
 * calls that slot `video_gen`. `providerSlot` bridges them so the page can read
 * the tenant's provider chip without guessing.
 */

/** Playground slot ids, in display order. Also the `[slot]` route param universe. */
export const SLOT_IDS = ['image', 'tts', 'asr', 'llm', 'vlm', 'ocr', 'video'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/**
 * Slots whose main input is a PROMPT, so the Enhance button appears next to it.
 * Deliberately excludes `tts` (that text is the narration and must be spoken
 * verbatim) and `asr` / `ocr` (file input, nothing to rewrite).
 */
export const ENHANCE_TARGETS = ['image', 'video', 'llm', 'vlm'] as const;
export type EnhanceTarget = (typeof ENHANCE_TARGETS)[number];

/** How the request goes on the wire: a JSON body, or multipart with a file. */
export type SlotInput = 'json' | 'file';

/** The result shape a slot expects; the run's own `output_kind` wins if it differs. */
export type OutputKind = 'image' | 'audio' | 'text' | 'transcript' | 'markdown' | 'video';

/** The form control a field renders as. File fields are multipart-only. */
export type FieldKind = 'text' | 'textarea' | 'number' | 'url' | 'file';

export interface SlotField {
	/** Wire key — sent under exactly this name in the JSON body / FormData. */
	key: string;
	label: string;
	kind: FieldKind;
	required?: boolean;
	placeholder?: string;
	/** Extra sentence under the control. */
	help?: string;
	/** `min` / `max` / `step` for a number field, or the byte bounds of a file. */
	min?: number;
	max?: number;
	step?: number;
	/**
	 * Server-side `maxLength` for a text field, mirrored here so the form stops a
	 * too-long prompt instead of letting the API answer 422. Only set where the
	 * orchestrator's request model declares one.
	 */
	maxLength?: number;
	/** `accept` for a file field. */
	accept?: string;
	/**
	 * Fields sharing a group are alternatives: at least ONE must be filled
	 * (`vlm`: a file OR an image URL). Enforced by `missingRequirement`, mirrored
	 * by the server's own 422.
	 */
	group?: string;
}

export interface SlotDescriptor {
	id: SlotId;
	label: string;
	blurb: string;
	input: SlotInput;
	fields: readonly SlotField[];
	outputKind: OutputKind;
	/**
	 * A realistic sample input, shown as the prompt placeholder and as the
	 * "Example" hint under the form. NEVER sent — the user types their own.
	 */
	example: string;
	/** Key of the prompt field. Absent = this slot has no prompt (no Enhance). */
	promptField?: string;
	/** The provider-registry slot key this slot's provider context comes from. */
	providerSlot: string;
	/** Label of the submit button. */
	actionLabel: string;
	/** Sentence shown when a `group` rule is unmet. */
	groupMessage?: string;
}

export const SLOTS: readonly SlotDescriptor[] = [
	{
		id: 'image',
		label: 'Image generation',
		blurb: 'Describe a picture and the image provider renders it back here.',
		input: 'json',
		outputKind: 'image',
		example: 'A red fox in fresh snow, golden hour, 35mm photograph',
		promptField: 'prompt',
		providerSlot: 'image',
		actionLabel: 'Generate image',
		fields: [
			{
				key: 'prompt',
				label: 'Prompt',
				kind: 'textarea',
				required: true,
				maxLength: 2000,
				placeholder: 'A red fox in fresh snow, golden hour'
			},
			{
				key: 'width',
				label: 'Width',
				kind: 'number',
				min: 256,
				max: 2048,
				step: 64,
				help: '256–2048, in steps of 64.',
				placeholder: 'Provider default'
			},
			{
				key: 'height',
				label: 'Height',
				kind: 'number',
				min: 256,
				max: 2048,
				step: 64,
				help: '256–2048, in steps of 64.',
				placeholder: 'Provider default'
			},
			{ key: 'seed', label: 'Seed', kind: 'number', step: 1, placeholder: 'Random' }
		]
	},
	{
		id: 'tts',
		label: 'Speech synthesis',
		blurb: 'Speak this text with the voice provider and play the audio back.',
		input: 'json',
		outputKind: 'audio',
		example: 'The studio lights were already warm when the crew arrived.',
		providerSlot: 'tts',
		actionLabel: 'Synthesize speech',
		fields: [
			{
				key: 'text',
				label: 'Text',
				kind: 'textarea',
				required: true,
				maxLength: 5000,
				placeholder: 'The studio lights were already warm…'
			},
			{
				key: 'voice',
				label: 'Voice',
				kind: 'text',
				placeholder: 'Provider default voice'
			},
			{
				key: 'speed',
				label: 'Speed',
				kind: 'number',
				min: 0.25,
				max: 4,
				step: 0.1,
				placeholder: '1.0'
			}
		]
	},
	{
		id: 'asr',
		label: 'Transcription',
		blurb: 'Upload a recording and read back the transcript.',
		input: 'file',
		outputKind: 'transcript',
		example: 'A two-minute interview recording (mp3, wav or m4a).',
		providerSlot: 'asr',
		actionLabel: 'Transcribe',
		fields: [
			{ key: 'file', label: 'Audio file', kind: 'file', required: true, accept: 'audio/*' },
			{
				key: 'language',
				label: 'Language',
				kind: 'text',
				placeholder: 'Detected automatically (e.g. en)'
			}
		]
	},
	{
		id: 'llm',
		label: 'Text model',
		blurb: 'Send a prompt to the text model and read the reply.',
		input: 'json',
		outputKind: 'text',
		example: 'Explain what a GPU service test bench is for, in two sentences.',
		promptField: 'prompt',
		providerSlot: 'llm',
		actionLabel: 'Send prompt',
		fields: [
			{ key: 'prompt', label: 'Prompt', kind: 'textarea', required: true, maxLength: 8000 },
			{
				key: 'system',
				label: 'System prompt',
				kind: 'textarea',
				placeholder: 'Optional instructions for the model'
			}
		]
	},
	{
		id: 'vlm',
		label: 'Vision',
		blurb: 'Ask a question about a picture — attach a file or paste an image URL.',
		input: 'file',
		outputKind: 'text',
		example: 'A photo of a shop front with a readable sign.',
		promptField: 'prompt',
		providerSlot: 'vlm',
		actionLabel: 'Ask about image',
		groupMessage: 'Attach an image or paste an image URL.',
		fields: [
			{ key: 'file', label: 'Image file', kind: 'file', accept: 'image/*', group: 'source' },
			{
				key: 'image_url',
				label: 'Image URL',
				kind: 'url',
				placeholder: 'https://…',
				group: 'source'
			},
			{
				key: 'prompt',
				label: 'Prompt',
				kind: 'textarea',
				required: true,
				placeholder: 'What does the sign say?'
			}
		]
	},
	{
		id: 'ocr',
		label: 'Document OCR',
		blurb: 'Upload a scan or PDF and read back the recognised text.',
		input: 'file',
		outputKind: 'text',
		example: 'A scanned invoice, or a photographed page of text.',
		providerSlot: 'ocr',
		actionLabel: 'Extract text',
		fields: [
			{
				key: 'file',
				label: 'Document',
				kind: 'file',
				required: true,
				accept: 'image/*,application/pdf'
			}
		]
	},
	{
		id: 'video',
		label: 'Video generation',
		blurb: 'Describe a shot and get a clip back — usually the slowest run on this page.',
		input: 'json',
		outputKind: 'video',
		example: 'A slow push-in on a lighthouse at dusk, waves breaking below.',
		promptField: 'prompt',
		providerSlot: 'video_gen',
		actionLabel: 'Generate video',
		fields: [
			{ key: 'prompt', label: 'Prompt', kind: 'textarea', required: true, maxLength: 2000 },
			{
				key: 'seconds',
				label: 'Seconds',
				kind: 'number',
				// VideoGenerateRequest caps at 30 (`le=30`); the form allowed 60,
				// so anything 31-60 was a guaranteed 422.
				min: 1,
				max: 30,
				step: 1,
				placeholder: 'Provider default'
			}
		]
	}
];

/** `SLOTS` by id — the lookup the page uses for its descriptor. */
const BY_ID = new Map<string, SlotDescriptor>(SLOTS.map((s) => [s.id, s]));

export function isSlotId(value: string): value is SlotId {
	return BY_ID.has(value);
}

/** The descriptor for a route param, or `undefined` for an unknown slot (404s). */
export function slotDescriptor(id: string): SlotDescriptor | undefined {
	return BY_ID.get(id);
}

export function isEnhanceTarget(id: SlotId): id is EnhanceTarget {
	return (ENHANCE_TARGETS as readonly string[]).includes(id);
}

/**
 * The first unmet requirement of a form, as a sentence, or `null` when the form
 * can be submitted. `has` answers "is this field filled?" — the page folds the
 * value map and the picked files into it, so this stays pure and testable.
 */
export function missingRequirement(
	descriptor: SlotDescriptor,
	has: (key: string) => boolean
): string | null {
	for (const field of descriptor.fields) {
		if (field.required && !has(field.key)) return `${field.label} is required.`;
	}
	const groups = new Map<string, SlotField[]>();
	for (const field of descriptor.fields) {
		if (!field.group) continue;
		const members = groups.get(field.group) ?? [];
		members.push(field);
		groups.set(field.group, members);
	}
	for (const members of groups.values()) {
		if (members.some((field) => has(field.key))) continue;
		return descriptor.groupMessage ?? `Provide ${members.map((f) => f.label).join(' or ')}.`;
	}
	return null;
}
