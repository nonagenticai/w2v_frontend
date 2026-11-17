/**
 * The Providers page connection form, driven by the server's requirements
 * manifest (P8, `GET /api/provider-requirements`).
 *
 * The frontend holds NO per-kind field table: which inputs a kind shows, which
 * are required, the secret's label and whether a key is required all come from
 * the manifest's `KindRequirement`. `required` there is the server's own rule (a
 * PUT without the field is 422), so the form can never ask for less or more than
 * the API accepts.
 *
 * Pure module: no Svelte, no I/O — unit-tested in `connection-form.test.ts`.
 */
import type { ConnectionDraft, ConnectionView, ModelListDraft } from '$lib/api/providers.js';
import type {
	KindField,
	KindRequirement,
	SlotRequirement
} from '$lib/api/provider-requirements.js';

/** `base_url` / `model` map to the top-level draft fields, `options.<k>` to `options[k]`. */
export type FieldKey = string;
export type FieldValues = Record<string, string>;

/** Display name of a kind: the manifest's label, else the kind id. */
export function kindLabel(req: SlotRequirement | undefined, kind: string): string {
	if (req?.default_kind === kind) return req.default_kind_label;
	return req?.kinds?.[kind]?.label || kind;
}

/** The manifest's form for one kind of a slot; `undefined` = the server describes no form. */
export function kindRequirement(
	req: SlotRequirement | undefined,
	kind: string
): KindRequirement | undefined {
	return req?.kinds?.[kind];
}

/** Placeholder text derived from the manifest (required-ness + the default endpoint). */
export function fieldPlaceholder(field: KindField, kind: KindRequirement): string {
	if (field.required) return field.help ? `Required — ${field.help}` : 'Required';
	if (field.key === 'base_url' && kind.default_base_url) {
		return `Optional — defaults to ${kind.default_base_url}`;
	}
	return field.help ? `Optional — ${field.help}` : 'Optional';
}

const optionKey = (key: FieldKey): string | null =>
	key.startsWith('options.') ? key.slice('options.'.length) : null;

/** Every field key any kind of this slot can show — the form state is keyed on all of them,
 *  so switching kinds never binds an input to a missing key. */
export function fieldKeysFor(req: SlotRequirement | undefined): FieldKey[] {
	const keys = new Set<FieldKey>(['base_url', 'model']);
	for (const kind of Object.values(req?.kinds ?? {})) {
		for (const f of kind.fields) keys.add(f.key);
	}
	return [...keys];
}

/** Form values from the stored connection (string options only; never the secret). */
export function initialValues(
	req: SlotRequirement | undefined,
	conn: ConnectionView | null
): FieldValues {
	const values: FieldValues = {};
	for (const key of fieldKeysFor(req)) {
		const opt = optionKey(key);
		if (opt === null) {
			values[key] = (key === 'base_url' ? conn?.base_url : conn?.model) ?? '';
		} else {
			const v = conn?.options?.[opt];
			values[key] = typeof v === 'string' ? v : '';
		}
	}
	return values;
}

export interface SecretState {
	mode: 'keep' | 'replace' | 'clear';
	/** What the user typed (only meaningful in `replace`). */
	value: string;
	/** The stored connection has a key. */
	hasStored: boolean;
	/**
	 * Set (to the new kind's label) when the chosen kind differs from the stored
	 * connection's kind and needs a key: the stored key belongs to the OLD provider,
	 * so it never satisfies the requirement — a newly typed key is required.
	 */
	requireNewFor?: string;
}

/** The `secret` member of the body: undefined = keep (the key is OMITTED, never `null`). */
export function secretForBody(s: SecretState): string | undefined {
	if (s.mode === 'clear') return '';
	if (s.mode === 'replace' && s.value) return s.value;
	return undefined;
}

function isHttpUrl(v: string): boolean {
	try {
		const u = new URL(v);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Client-side checks before a test/save. Keys are field keys plus `secret`; empty = valid. */
export function validateDraft(
	kind: KindRequirement,
	values: FieldValues,
	secret: SecretState
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const f of kind.fields) {
		const v = (values[f.key] ?? '').trim();
		if (!v) {
			if (f.required) errors[f.key] = `${f.label} is required.`;
		} else if (f.format === 'url' && !isHttpUrl(v)) {
			errors[f.key] = 'Use a full http(s) URL, e.g. https://api.example.com/v1.';
		}
	}
	if (kind.secret_required && secret.requireNewFor) {
		if (!(secret.mode === 'replace' && secret.value)) {
			errors.secret = `Enter a key for ${secret.requireNewFor}.`;
		}
	} else if (kind.secret_required) {
		// "Stored; leave blank to keep it": a blank replace keeps the stored key
		// (`secretForBody` omits it), exactly like `keep`.
		const willHaveKey =
			(secret.mode !== 'clear' && secret.hasStored) ||
			(secret.mode === 'replace' && !!secret.value);
		if (!willHaveKey) {
			errors.secret =
				secret.mode === 'clear'
					? `This provider needs a key — replace it instead of clearing it.`
					: `${kind.secret_label} is required.`;
		}
	}
	return errors;
}

/**
 * The test/save body. Fields the kind does not show are sent as `null`; option
 * fields overlay the stored options (an emptied option is dropped), other stored
 * options are carried so a save keeps them. `options` is omitted when empty.
 */
export function buildDraft(
	kindId: string,
	kind: KindRequirement,
	values: FieldValues,
	storedOptions: ConnectionView['options'] | null | undefined,
	secret: SecretState
): ConnectionDraft {
	const shown = new Set(kind.fields.map((f) => f.key));
	const top = (key: 'base_url' | 'model'): string | null =>
		shown.has(key) ? (values[key] ?? '').trim() || null : null;
	const body: ConnectionDraft = { kind: kindId, base_url: top('base_url'), model: top('model') };
	const s = secretForBody(secret);
	if (s !== undefined) body.secret = s;

	const options: NonNullable<ConnectionDraft['options']> = { ...(storedOptions ?? {}) };
	for (const f of kind.fields) {
		const opt = optionKey(f.key);
		if (opt === null) continue;
		const v = (values[f.key] ?? '').trim();
		if (v) options[opt] = v;
		else delete options[opt];
	}
	if (Object.keys(options).length > 0) body.options = options;
	return body;
}

/** True when the kind's form has a model field (the "Load models" button applies). */
export function hasModelField(kind: KindRequirement | undefined): boolean {
	return !!kind?.fields.some((f) => f.key === 'model');
}

/**
 * The `POST /tenant/connections/{slot}/models` body: the chosen kind, the typed
 * base URL (only when the kind shows one) and a newly TYPED key only — keep and
 * clear both omit `secret`, so the server uses the stored key (never echoed).
 */
export function modelListDraft(
	kindId: string,
	kind: KindRequirement,
	values: FieldValues,
	secret: SecretState
): ModelListDraft {
	const showsBase = kind.fields.some((f) => f.key === 'base_url');
	const body: ModelListDraft = {
		kind: kindId,
		base_url: showsBase ? (values.base_url ?? '').trim() || null : null
	};
	if (secret.mode === 'replace' && secret.value) body.secret = secret.value;
	return body;
}

/** De-duplicated, sorted, non-empty model ids from the provider's list. */
export function normalizeModels(models: unknown): string[] {
	if (!Array.isArray(models)) return [];
	const ids = models.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
	return [...new Set(ids.map((m) => m.trim()))].sort((a, b) => a.localeCompare(b));
}
