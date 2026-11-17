#!/usr/bin/env bun
/**
 * type-drift-check.ts — stop hand-written types from shadowing generated ones.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/lib/api/types.gen.ts` is generated from the orchestrator's OpenAPI
 * document (`bun run codegen`). Everything else under `src/` is hand-written.
 * When a hand-written declaration reuses a generated schema NAME we end up with
 * two different types called the same thing, and nothing tells us when the
 * backend moves. That is not hypothetical — two live examples, both the same
 * shape (a hand-written `job_id` against a backend that stopped saying `job_id`):
 *
 *   - `CheckpointsResponse` declared `job_id` where the schema says `run_id`,
 *     was exported from `$lib/types`, and every live caller was actually using
 *     a *different* `CheckpointsResponse` from `$lib/api/runs`. (Now deleted.)
 *   - `AnnotationResponse` (src/lib/types/annotations.ts) declared `job_id` +
 *     `applied_in_draft_id` where the schema says `stage_output_id` +
 *     `applied_in_run_id`. (Now an alias of the generated schema, and OFF the
 *     allowlist — so a future BE rename breaks the call sites instead of
 *     hiding behind a boundary adapter.)
 *
 * `codegen:check` cannot catch any of this: it only diffs `types.gen.ts`
 * against itself after a regenerate. This script closes that gap.
 *
 * SCOPE — the whole of src/, deliberately
 * ---------------------------------------
 * An earlier version of this script scanned ONLY `src/lib/types/api.ts`. It
 * reported zero while 37 shadows sat in seven other files, including
 * `src/lib/api/runs.ts` — the very file whose `CheckpointsResponse` is the
 * trap this guard was written for. A guard that cannot see the drift it was
 * built to catch is worse than none: it tells the next author the class is
 * handled. So: every `.ts` and `.svelte` under `src/`.
 *
 * WHAT IT CHECKS
 * --------------
 * NAME COLLISIONS ONLY. It deliberately does not attempt structural
 * comparison: TypeScript's structural rules, `Omit<>`/intersection wrappers and
 * deliberate frontend-only fields make that a type-checker-sized problem, and
 * the tooling would cost more than it saves. A name collision is a cheap,
 * high-signal proxy — both real drifts above announced themselves as one.
 *
 * NOT flagged: an alias that re-exports the generated type, in any of the
 * idioms this repo actually uses —
 *     export type Foo = gen['schemas']['Foo'];
 *     export type Foo = Schemas['Foo'];
 *     export type Foo = components['schemas']['Foo'];
 * including prettier-wrapped multi-line forms. An alias IS the generated type,
 * so it cannot drift; it is the pattern to migrate towards and must not be
 * punished.
 *
 * THE ALLOWLIST IS A RATCHET WITH A REAL BACKLOG
 * ----------------------------------------------
 * The 26 entries below are pre-existing debt, not a clean bill of health. They
 * were NOT bulk-deleted to force a green number and they are NOT waved through
 * silently — each carries a measured reason. What this guard enforces today is
 * therefore: *no NEW shadow, in any file*. Every existing one is listed, and
 * shrinking the list is always an improvement.
 *
 * TO FIX A FAILURE
 * ----------------
 *   1. Preferred: delete the hand-written declaration and import the generated
 *      type (directly, or via an alias as above).
 *   2. If the hand-written shape is deliberate (frontend-only fields, or the
 *      pinned OpenAPI package predates the route), RENAME it so it no longer
 *      collides — e.g. `BranchContextView`.
 *   3. Only if neither is possible, add it to ALLOWLIST below WITH a reason.
 */

import { readFileSync } from 'node:fs';
import { Glob } from 'bun';

const GEN = 'src/lib/api/types.gen.ts';

/**
 * Deliberate exceptions, keyed `<path>::<TypeName>`.
 *
 * Keyed by FILE AND NAME, not by bare name, on purpose: allowlisting
 * `AnnotationResponse` everywhere would let a brand-new file reintroduce the
 * identical trap and still go green. An entry licenses exactly one declaration
 * in exactly one file.
 *
 * Every entry needs a reason. Growing this list needs a real justification.
 */
const ALLOWLIST: Record<string, string> = {
	// --- src/lib/api/admin.ts (11) -------------------------------------------
	// The file header states it outright: "these response types are declared here
	// because the admin schemas are not in the published orchestrator OpenAPI yet;
	// fold them into types.gen.ts on the next codegen republish". The schemas now
	// EXIST in types.gen.ts, so this whole block is deletable on the next bump —
	// the largest single win available against this list.
	'src/lib/api/admin.ts::AdminTenantSummary':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminTenantUpdate':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminAuditEntry':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::RequestAuditEntry':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminUsageTotals':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminUsageByType':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminUsageByStage':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminUsageByModel':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',
	'src/lib/api/admin.ts::AdminUsagePoint':
		'admin DTO predating the published OpenAPI; schema now exists — fold in on next codegen bump',

	// --- src/lib/api/runs.ts (5) ---------------------------------------------
	// In-file comment: "Hand-mirrored from the orchestrator ApplyClipEdits contract
	// until `bun run codegen` bumps types.gen.ts (the repo's duck-typing pattern for
	// a FE PR that leads its backend by one codegen cycle)." The bump has landed —
	// these are now duplicating schemas that exist.
	'src/lib/api/runs.ts::MusicEdit':
		'hand-mirrored ApplyClipEdits contract ahead of codegen; bump has landed — replace with the generated type',
	'src/lib/api/runs.ts::ApplyClipEdits':
		'hand-mirrored ApplyClipEdits contract ahead of codegen; bump has landed — replace with the generated type',

	// --- upload response shapes (5) ------------------------------------------
	// Small 2-3 field wire shapes written alongside their endpoint. Low drift risk
	// (they are additive-only refs + byte counts) but identical names to the
	// generated schemas.
	'src/lib/api/uploads.ts::DocumentUploadResponse':
		'small upload wire shape duplicating the generated schema; swap to the generated type',
	'src/lib/api/uploads.ts::PackageUploadResponse':
		'small upload wire shape duplicating the generated schema; swap to the generated type',
	'src/lib/api/uploads.ts::VoiceoverUploadResponse':
		'small upload wire shape duplicating the generated schema; swap to the generated type',
	'src/lib/api/course.ts::ThumbnailUploadResponse':
		'small upload wire shape duplicating the generated schema; swap to the generated type',

	// --- src/lib/api/media.ts (2) --------------------------------------------
	'src/lib/api/media.ts::MediaSearchResult': 'wraps MediaResult above; migrate the pair together',

	// --- src/lib/types/api.ts: storyboard branch/merge family (10) -----------
	// Hand-written because the then-pinned @nonagentic/w2v-orchestrator-openapi package
	// predated these routes (see the comments in that file). The generated schemas
	// now exist, so these are candidates for deletion on the next codegen bump —
	// they are load-bearing across storyboard.svelte.ts, api/storyboard.ts and
	// StoryboardBranchMerge.svelte, so migrating them is its own change.
	'src/lib/types/api.ts::BranchListResponse':
		'pre-dates pinned OpenAPI package; wide storyboard usage — migrate on next codegen bump',
	'src/lib/types/api.ts::BranchAncestor':
		'structural member of the hand-written BranchContext below',
	'src/lib/types/api.ts::BranchContext':
		'pre-dates pinned OpenAPI package; consumed by BranchBanner.svelte',
	'src/lib/types/api.ts::DiffEntry':
		'pre-dates pinned OpenAPI package; consumed by merge-fields.ts + StoryboardBranchMerge.svelte',
	'src/lib/types/api.ts::BranchDiffResponse':
		'pre-dates pinned OpenAPI package; consumed by storyboard store + merge UI',
	'src/lib/types/api.ts::MergeResolution':
		'pre-dates pinned OpenAPI package; consumed by StoryboardBranchMerge.svelte',
	'src/lib/types/api.ts::SiblingMergeRequest':
		'pre-dates pinned OpenAPI package; consumed by storyboard store + api/storyboard.ts',
	'src/lib/types/api.ts::SiblingMergeResponse':
		'pre-dates pinned OpenAPI package; consumed by storyboard store + api/storyboard.ts',
	'src/lib/types/api.ts::SnapshotListResponse':
		'pre-dates pinned OpenAPI package; consumed by storyboard store + api/storyboard.ts',
	'src/lib/types/api.ts::PanelEventListResponse':
		'pre-dates pinned OpenAPI package; consumed by api/storyboard.ts'
};

/** Names declared under `components.schemas` in the generated file. */
function generatedSchemaNames(): Set<string> {
	const lines = readFileSync(GEN, 'utf8').split('\n');
	const start = lines.findIndex((l) => /^\s{4}schemas:\s*\{/.test(l));
	if (start === -1) {
		throw new Error(
			`${GEN}: could not find the "schemas:" block — has openapi-typescript changed its output shape?`
		);
	}
	// The block ends at the next sibling key at the same (4-space) indent.
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^\s{4}[A-Za-z_$][\w$]*:/.test(lines[i])) {
			end = i;
			break;
		}
	}
	const names = new Set<string>();
	for (const m of lines
		.slice(start + 1, end)
		.join('\n')
		.matchAll(/^ {8}([A-Za-z_$][\w$]*):/gm)) {
		names.add(m[1]);
	}
	if (names.size === 0) {
		throw new Error(`${GEN}: parsed 0 schema names — the parser is broken, not the code.`);
	}
	return names;
}

/**
 * A type declaration. Matches `interface X {` / `interface X<T> extends Y {`
 * and `type X =` / `type X<T> =`.
 *
 * The trailing `{` and `=` are load-bearing: without them this also matches the
 * `type Foo,` lines inside a multi-line `import { type Foo, ... }` clause, which
 * produced two false positives (VerbatimItemList.svelte, DeliverablesSection.svelte)
 * while this parser was being built.
 */
const DECL =
	/^[ \t]*(?:export[ \t]+)?(?:(interface)[ \t]+([A-Za-z_$][\w$]*)[^\n{]*\{|(type)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?:<[^\n]*?>)?[ \t]*=)/gm;

/** The alias idioms this repo uses to re-export a generated schema. */
const ALIAS_RHS = /\[\s*['"]schemas['"]\s*\]|\bSchemas\s*\[|\bcomponents\s*\[/;

interface Decl {
	file: string;
	name: string;
	line: number;
	isGeneratedAlias: boolean;
}

function scanSources(): Decl[] {
	const out: Decl[] = [];
	const files = [
		...new Glob('src/**/*.ts').scanSync('.'),
		...new Glob('src/**/*.svelte').scanSync('.')
	];
	for (const file of files.sort()) {
		if (file.replace(/\\/g, '/').endsWith('src/lib/api/types.gen.ts')) continue;
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(DECL)) {
			const isType = m[3] === 'type';
			const name = m[2] ?? m[4];
			// Read the RHS through to its terminating `;` so prettier-wrapped
			// multi-line aliases are recognised, not just single-line ones.
			const semi = src.indexOf(';', m.index!);
			const rhs = src.slice(m.index!, semi === -1 ? m.index! + 400 : semi + 1);
			out.push({
				file: file.replace(/\\/g, '/'),
				name,
				line: src.slice(0, m.index!).split('\n').length,
				isGeneratedAlias: isType && ALIAS_RHS.test(rhs)
			});
		}
	}
	return out;
}

const generated = generatedSchemaNames();
const decls = scanSources();

const collisions = decls.filter((d) => !d.isGeneratedAlias && generated.has(d.name));
const violations = collisions.filter((d) => !(`${d.file}::${d.name}` in ALLOWLIST));

// Keep the allowlist honest: an entry that no longer collides is stale.
const live = new Set(collisions.map((d) => `${d.file}::${d.name}`));
const staleAllowlist = Object.keys(ALLOWLIST).filter((k) => !live.has(k));

const aliasCount = decls.filter((d) => d.isGeneratedAlias && generated.has(d.name)).length;
const scanned = new Set(decls.map((d) => d.file)).size;

console.log(
	`type-drift-check: ${generated.size} generated schemas vs ${decls.length} hand-written type declarations ` +
		`across ${scanned} files — ${aliasCount} generated-type aliases (exempt), ` +
		`${collisions.length} name collisions, ${Object.keys(ALLOWLIST).length} allowlisted.`
);

if (staleAllowlist.length > 0) {
	console.error(
		'\nStale ALLOWLIST entries in scripts/type-drift-check.ts — these no longer collide, delete them:'
	);
	for (const k of staleAllowlist) console.error(`  - ${k}`);
}

if (violations.length > 0) {
	console.error(`\n${violations.length} hand-written type(s) shadow a generated schema name:`);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.name}  (also in ${GEN} components.schemas)`);
	}
	console.error(
		'\nTwo different types with the same name is how CheckpointsResponse ended up declaring\n' +
			'`job_id` against a backend that returns `run_id`. Fix by deleting the hand-written\n' +
			'declaration and importing the generated type, or by renaming it so it no longer collides.\n' +
			'Last resort: add "<path>::<Name>" to ALLOWLIST in scripts/type-drift-check.ts with a reason.'
	);
}

if (violations.length > 0 || staleAllowlist.length > 0) process.exit(1);

console.log(
	`type-drift-check: OK — no NEW shadows. ${Object.keys(ALLOWLIST).length} pre-existing ones are allowlisted debt, not a clean bill of health.`
);
