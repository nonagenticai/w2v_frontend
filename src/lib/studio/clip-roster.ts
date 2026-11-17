import { unzipSync, strFromU8 } from 'fflate';

// Reading the real footage-clip roster out of an uploaded recording package.
//
// A recording package is a Playwright-BDD bundle whose `.feature` scenarios are
// tagged `@clip-<n>` (Gherkin tags). The frontend_test_runner records one clip
// per tagged scenario and keys it by that tag WITHOUT the leading `@` — i.e. the
// join key the orchestrator matches a `ShowcaseLine.clip` against is `clip-<n>`
// (see w2v_orchestrator demo_video_record.py: `valid_clip_tags`). So the roster
// we surface to the clip↔beat editor is the set of `@clip-*` tags declared in the
// package's feature files, normalized to their `clip-*` join-key form.

// `@clip-` followed by one or more id chars. The trailing `-` is required, so
// `@clipboard` / `@clip` do NOT match — only genuine clip tags.
const CLIP_TAG = /@clip-[A-Za-z0-9_.-]+/g;

/**
 * Extract the ordered, de-duplicated list of clip join keys from raw `.feature`
 * file contents. Pure — no zip / IO — so it's unit-testable on plain strings.
 * Each `@clip-<n>` tag becomes `clip-<n>` (the `@` stripped). First-seen order is
 * preserved; duplicates (a tag repeated across scenarios/files) collapse to one.
 *
 * Only genuine Gherkin *tag lines* are scanned — a line whose trimmed form starts
 * with `@` (tags sit on their own line, whitespace-separated, above Feature/
 * Scenario/Examples). This ignores an `@clip-1` that merely appears inside step
 * text, a `#` comment, or a docstring, which would otherwise seed a phantom clip.
 */
export function extractClipTags(featureTexts: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const text of featureTexts) {
		for (const rawLine of text.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line.startsWith('@')) continue; // Gherkin tag lines only
			for (const match of line.matchAll(CLIP_TAG)) {
				const key = match[0].slice(1); // drop the leading '@' → the FTR clip_key
				if (!seen.has(key)) {
					seen.add(key);
					out.push(key);
				}
			}
		}
	}
	return out;
}

/**
 * The outcome of reading a package's clip roster. `unreadable` distinguishes the
 * two cases that an empty `tags` array cannot: a package we READ and which
 * genuinely declares no `@clip-*` tags (`unreadable: false`) versus one whose zip
 * `fflate` could not open at all (zip64, an unusual compression method, a
 * truncated upload) — where we know nothing about its clips (`unreadable: true`).
 * Collapsing those to `[]` made the UI silently claim "this package has no clips"
 * and drop the user to hand-typed clip keys; a mistyped key is then dropped by the
 * orchestrator's `valid_clip_tags` join and the beat vanishes from the video.
 */
export interface ClipRosterResult {
	tags: string[];
	unreadable: boolean;
}

/**
 * Parse a recording-package `.zip` in the browser and return its clip roster.
 * Never throws — the roster is a convenience, never a gate on the upload (the
 * caller wraps this in the UPLOAD try/catch, so throwing would falsely report
 * "Upload failed" for a perfectly good upload). An unreadable zip comes back as
 * `{ tags: [], unreadable: true }` so the caller can say so instead of implying
 * the package has no clips.
 */
export async function parsePackageClipRoster(file: File): Promise<ClipRosterResult> {
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const entries = unzipSync(bytes, { filter: (f) => f.name.endsWith('.feature') });
		const texts = Object.values(entries).map((data) => strFromU8(data));
		return { tags: extractClipTags(texts), unreadable: false };
	} catch {
		return { tags: [], unreadable: true };
	}
}
