// Per-field merge-resolution helpers, factored out of StoryboardBranchMerge.svelte so the
// allowlist rule can be unit-tested in isolation.
import type { DiffEntry } from '$lib/types';

// The per-field merge fence is now an ALLOWLIST sourced from the server: the diff response
// carries `mergeable_fields` — the exact set of content columns the orchestrator will apply
// field-by-field. Everything NOT in that set (shot_key/position/scene/characters/props/location,
// and any column the server has not opted in) is fenced to a whole-row verdict. Consuming the
// server's list rather than a hand-mirrored denylist means the client can never drift LOOSER
// than the backend: an unknown field defaults to fenced.

// The fields a conflict genuinely disagrees on: changed on BOTH sides vs base (the intersection).
// With `mergeableFields` passed, the intersection is narrowed to the server-mergeable columns —
// the ones actually offered as per-field toggles. Omit it for the raw intersection (back-compat).
export function conflictingFields(e: DiffEntry, mergeableFields?: readonly string[]): string[] {
	const raw = e.changed_fields.filter((f) => e.main_changed_fields.includes(f));
	return mergeableFields ? raw.filter((f) => mergeableFields.includes(f)) : raw;
}

// Whether a conflict may be resolved per column, mirroring the backend `_field_resolvable`:
// both sides still have the panel, at least one genuinely-conflicting field, EVERY conflicting
// field is on the server's `mergeableFields` ALLOWLIST, and main made no main-only edit to a
// non-allowlisted (fenced) field — such a conflict must use a whole-row verdict. An empty
// allowlist (or a field the server did not opt in) fences the conflict.
export function isFieldMergeable(e: DiffEntry, mergeableFields: readonly string[]): boolean {
	if (e.kind !== 'conflict' || e.branch === null || e.main === null) return false;
	// Raw intersection here (NOT narrowed) so a fenced conflicting field is actually seen and
	// fails the allowlist check below — narrowing first would hide it and wrongly pass.
	const conflicting = e.changed_fields.filter((f) => e.main_changed_fields.includes(f));
	if (conflicting.length === 0) return false;
	if (!conflicting.every((f) => mergeableFields.includes(f))) return false;
	const mainOnly = e.main_changed_fields.filter((f) => !e.changed_fields.includes(f));
	return mainOnly.every((f) => mergeableFields.includes(f));
}
