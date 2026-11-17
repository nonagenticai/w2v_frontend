/**
 * Providers page grouping + the per-slot summary row (care-bus `/admin/providers` pattern):
 * one row per service with its SOURCE (your connection / platform default / not
 * configured), the provider + model, and whether a key is stored.
 *
 * Which kinds a slot offers, their labels and fields all stay manifest-driven
 * (`connection-form.ts`); this module only decides the page's sections and
 * formats the summary. Pure: no Svelte, no I/O — `provider-groups.test.ts`.
 */
import type { LlmAccessMode, SlotView } from '$lib/api/providers.js';
import type { ProviderRequirements, SlotRequirement } from '$lib/api/provider-requirements.js';
import { kindLabel } from './connection-form.js';

/** GPU / model-serving slots, in display order. Every other slot is an integration. */
export const GPU_SLOTS: readonly string[] = [
	'llm',
	'vlm',
	'tts',
	'asr',
	'image',
	'ocr',
	'video_gen'
];

/** Shown on the page and next to every Save: the server makes a live call before storing. */
export const PROBE_CAVEAT =
	'The endpoint must be reachable over public https: saving makes a live test call from the platform, and nothing is stored when it fails.';

/**
 * Example self-hosted endpoints, for owner testing. Shown as a hint under a kind
 * whose base URL is REQUIRED (a self-hosted / protocol endpoint) — never sent.
 */
export const EXAMPLE_ENDPOINTS: Readonly<Record<string, string>> = {
	llm: 'https://api.nonagentic.ai/vllm/v1',
	vlm: 'https://api.nonagentic.ai/vllm/v1',
	tts: 'https://api.nonagentic.ai/tts',
	asr: 'https://api.nonagentic.ai/asr',
	image: 'https://api.nonagentic.ai/image',
	ocr: 'https://api.nonagentic.ai/ocr'
};

export function isGpuSlot(slot: string): boolean {
	return GPU_SLOTS.includes(slot);
}

/** GPU slots first (registry order fixed by `GPU_SLOTS`), then the rest in server order. */
export function splitSlots<T extends { slot: string }>(slots: T[]): { gpu: T[]; other: T[] } {
	const gpu = slots
		.filter((s) => isGpuSlot(s.slot))
		.sort((a, b) => GPU_SLOTS.indexOf(a.slot) - GPU_SLOTS.indexOf(b.slot));
	return { gpu, other: slots.filter((s) => !isGpuSlot(s.slot)) };
}

export type SummarySource = 'tenant' | 'default' | 'unconfigured' | 'required';

export interface SummaryRow {
	slot: string;
	label: string;
	source: SummarySource;
	sourceLabel: string;
	/** `<kind label> · <model>` of the connection, else the platform default's kind label. */
	model: string;
	/** `Stored` / `None` for a tenant connection; `—` when the platform serves the slot. */
	key: 'Stored' | 'None' | '—';
	writable: boolean;
}

/**
 * The summary row of one slot. `unconfigured` = this deployment requires the
 * tenant's own connection (`byo_required`) and none is stored, so nothing serves it.
 * `required` = the tenant's access mode is `byo_required` and this GPU / model slot
 * has no registration: runs that use it do not start.
 */
export function summaryRow(
	slot: SlotView,
	req: SlotRequirement | undefined,
	access: LlmAccessMode | null = null
): SummaryRow {
	const conn = slot.connection ?? null;
	const label = req?.label || slot.slot;
	if (slot.source === 'tenant' && conn) {
		return {
			slot: slot.slot,
			label,
			source: 'tenant',
			sourceLabel: 'Your connection',
			model: `${kindLabel(req, conn.kind)} · ${conn.model || 'provider default'}`,
			key: conn.has_secret ? 'Stored' : 'None',
			writable: slot.writable
		};
	}
	if (access === 'byo_required' && isGpuSlot(slot.slot)) {
		return {
			slot: slot.slot,
			label,
			source: 'required',
			sourceLabel: 'Required — not registered',
			model: '—',
			key: '—',
			writable: slot.writable
		};
	}
	const unconfigured = slot.byo_required;
	return {
		slot: slot.slot,
		label,
		source: unconfigured ? 'unconfigured' : 'default',
		sourceLabel: unconfigured ? 'Not configured' : 'Platform default',
		model: unconfigured ? '—' : kindLabel(req, slot.default_kind),
		key: '—',
		writable: slot.writable
	};
}

/**
 * Slot views for a caller who may not read the tenant's connections (the GET is
 * tenant_admin-only): built from the static manifest, so a member still sees which
 * services can be registered and with which fields — rendered read-only, with no
 * claim about what the tenant has stored.
 */
export function slotsFromManifest(manifest: ProviderRequirements): SlotView[] {
	return manifest.slots.map((r) => ({
		slot: r.slot,
		type: r.type,
		writable: r.type === 'connection' && r.allowed_kinds.length > 0,
		allowed_kinds: r.allowed_kinds,
		source: 'deployment',
		default_kind: r.default_kind,
		byo_required: r.byo_required,
		connection: null
	}));
}
