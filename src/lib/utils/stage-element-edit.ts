// Which parts of a step's output a person may edit in place, as plain text.
//
// The server says which output arrays hold addressable elements
// (`StageOutputResponse.element_paths`). Within each element only the free-text
// fields are offered: identifiers, links, storage keys and machine enums are left
// alone — editing those breaks the pipeline, not the content.

export interface EditableElement {
	id: string;
	/** "Line 3", "Shot 1" — where the element sits, for the person reading. */
	label: string;
	/** field → current text */
	fields: Record<string, string>;
}

const NOT_CONTENT =
	/(^id$|_id$|^url$|_url$|^ref$|_ref$|_key$|^key$|path$|hash$|^kind$|^type$|^status$|^role$|^format$|_at$)/i;

const SINGULAR: Record<string, string> = {
	lines: 'Line',
	shots: 'Shot',
	paragraphs: 'Paragraph',
	slides: 'Slide',
	clips: 'Clip',
	sections: 'Section',
	lessons: 'Lesson',
	items: 'Item',
	facts: 'Fact',
	pros: 'Pro',
	cons: 'Con',
	recommendations: 'Recommendation',
	pain_points: 'Pain point',
	hook_candidates: 'Hook',
	narrations: 'Narration',
	visuals: 'Visual',
	recordings: 'Recording'
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function editableElements(
	output: Record<string, unknown> | null | undefined,
	elementPaths: readonly string[]
): EditableElement[] {
	if (!output) return [];
	const out: EditableElement[] = [];
	for (const path of elementPaths) {
		const nodes = output[path];
		if (!Array.isArray(nodes)) continue;
		const noun = SINGULAR[path] ?? path.replace(/_/g, ' ');
		nodes.forEach((node, index) => {
			if (!isRecord(node) || typeof node.id !== 'string') return;
			const fields: Record<string, string> = {};
			for (const [key, value] of Object.entries(node)) {
				if (typeof value === 'string' && !NOT_CONTENT.test(key)) fields[key] = value;
			}
			if (Object.keys(fields).length === 0) return;
			out.push({ id: node.id, label: `${noun} ${index + 1}`, fields });
		});
	}
	return out;
}

/** The fields whose draft differs from the saved text — the PATCH body. */
export function changedFields(
	el: EditableElement,
	draft: Record<string, string>
): Record<string, string> {
	const patch: Record<string, string> = {};
	for (const [field, value] of Object.entries(draft)) {
		if (field in el.fields && value !== el.fields[field]) patch[field] = value;
	}
	return patch;
}
