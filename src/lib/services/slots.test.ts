import { describe, expect, it } from 'vitest';
import { GPU_SLOTS } from '$lib/components/providers/provider-groups.js';
import {
	ENHANCE_TARGETS,
	SLOTS,
	SLOT_IDS,
	isEnhanceTarget,
	isSlotId,
	missingRequirement,
	slotDescriptor,
	type SlotDescriptor
} from './slots';

function descriptorOf(id: string): SlotDescriptor {
	const d = slotDescriptor(id);
	if (!d) throw new Error(`no descriptor for ${id}`);
	return d;
}

const filled =
	(...keys: string[]) =>
	(key: string) =>
		keys.includes(key);

describe('slot descriptors', () => {
	it('every route slot id has exactly one descriptor', () => {
		for (const id of SLOT_IDS) expect(slotDescriptor(id), id).toBeDefined();
		expect(SLOTS.map((s) => s.id).sort()).toEqual([...SLOT_IDS].sort());
		expect(new Set(SLOTS.map((s) => s.id)).size).toBe(SLOTS.length);
	});

	it('labels are unique and every slot carries copy', () => {
		const labels = SLOTS.map((s) => s.label);
		expect(new Set(labels).size).toBe(labels.length);
		for (const slot of SLOTS) {
			expect(slot.label.trim(), slot.id).not.toBe('');
			expect(slot.blurb.trim(), slot.id).not.toBe('');
			expect(slot.example.trim(), slot.id).not.toBe('');
			expect(slot.actionLabel.trim(), slot.id).not.toBe('');
		}
	});

	it('every provider-registry GPU slot is reachable from a playground page', () => {
		const covered = new Set(SLOTS.map((s) => s.providerSlot));
		for (const registrySlot of GPU_SLOTS) expect(covered, registrySlot).toContain(registrySlot);
		// The one deliberate rename: the route says `video`, the registry `video_gen`.
		expect(descriptorOf('video').providerSlot).toBe('video_gen');
	});

	it('encodes the request the frozen contract expects (JSON vs multipart)', () => {
		const file = SLOTS.filter((s) => s.input === 'file').map((s) => s.id);
		const json = SLOTS.filter((s) => s.input === 'json').map((s) => s.id);
		expect(file.sort()).toEqual(['asr', 'ocr', 'vlm']);
		expect(json.sort()).toEqual(['image', 'llm', 'tts', 'video']);
		for (const slot of SLOTS) {
			// A multipart slot must carry a file field; a JSON slot must not.
			expect(
				slot.fields.some((f) => f.kind === 'file'),
				slot.id
			).toBe(slot.input === 'file');
		}
	});

	it('only the prompt slots expose a prompt field, and Enhance targets match it', () => {
		for (const slot of SLOTS) {
			const hasPrompt = slot.promptField !== undefined;
			expect(hasPrompt, slot.id).toBe(isEnhanceTarget(slot.id));
			if (slot.promptField) {
				const field = slot.fields.find((f) => f.key === slot.promptField);
				expect(field, slot.id).toBeDefined();
				expect(field?.kind, slot.id).toBe('textarea');
			}
		}
		expect([...ENHANCE_TARGETS].sort()).toEqual(['image', 'llm', 'video', 'vlm']);
		expect(slotDescriptor('tts')?.promptField).toBeUndefined();
	});

	it('guards the route param and the enhance target', () => {
		expect(isSlotId('image')).toBe(true);
		expect(isSlotId('video_gen')).toBe(false);
		expect(isSlotId('bogus')).toBe(false);
		expect(isEnhanceTarget('video')).toBe(true);
		expect(isEnhanceTarget('tts')).toBe(false);
		expect(slotDescriptor('bogus')).toBeUndefined();
	});
});

describe('missingRequirement', () => {
	it('names the first empty required field', () => {
		const image = descriptorOf('image');
		expect(missingRequirement(image, filled())).toBe('Prompt is required.');
		expect(missingRequirement(image, filled('prompt'))).toBeNull();
	});

	it('vlm needs a prompt AND one source of the image', () => {
		const vlm = descriptorOf('vlm');
		expect(missingRequirement(vlm, filled())).toBe('Prompt is required.');
		expect(missingRequirement(vlm, filled('prompt'))).toBe(
			'Attach an image or paste an image URL.'
		);
		expect(missingRequirement(vlm, filled('prompt', 'file'))).toBeNull();
		expect(missingRequirement(vlm, filled('prompt', 'image_url'))).toBeNull();
	});

	it('file slots require their file', () => {
		expect(missingRequirement(descriptorOf('asr'), filled())).toBe('Audio file is required.');
		expect(missingRequirement(descriptorOf('ocr'), filled())).toBe('Document is required.');
		expect(missingRequirement(descriptorOf('asr'), filled('file'))).toBeNull();
	});
});
