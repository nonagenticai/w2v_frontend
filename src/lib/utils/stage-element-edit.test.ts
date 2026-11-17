import { describe, expect, it } from 'vitest';
import { changedFields, editableElements } from './stage-element-edit';

describe('editableElements', () => {
	const output = {
		lines: [
			{ id: 'L1', text: 'Hello', voice_id: 'af', audio_url: 'http://x', seconds: 3 },
			{ id: 'L2', text: 'World', narration: 'World!' },
			{ text: 'no id — not addressable' }
		],
		shots: [{ id: 's1', vo_text: 'shot' }],
		notes: ['ignored']
	};

	it('offers only the arrays the server named, and only their text fields', () => {
		const els = editableElements(output, ['lines']);
		expect(els).toEqual([
			{ id: 'L1', label: 'Line 1', fields: { text: 'Hello' } },
			{ id: 'L2', label: 'Line 2', fields: { text: 'World', narration: 'World!' } }
		]);
	});

	it('is empty when nothing is editable', () => {
		expect(editableElements(output, [])).toEqual([]);
		expect(editableElements(null, ['lines'])).toEqual([]);
	});
});

describe('changedFields', () => {
	it('sends only what differs from the saved text', () => {
		const el = { id: 'L1', label: 'Line 1', fields: { text: 'Hello', narration: 'Hi' } };
		expect(changedFields(el, { text: 'Hello' })).toEqual({});
		expect(changedFields(el, { text: 'Hello there', narration: 'Hi' })).toEqual({
			text: 'Hello there'
		});
		// A draft for a field that is not editable is never sent.
		expect(changedFields(el, { voice_id: 'x' })).toEqual({});
	});
});
