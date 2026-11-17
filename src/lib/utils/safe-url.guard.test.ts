import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The guarded-beside-unguarded shape, closed.
 *
 * `isSafeHref`'s logic already existed — correctly — inside ONE component, and
 * was absent from nine siblings that bind LLM- and scrape-derived URLs straight
 * into an `href`. Fixing those nine is worth little on its own: the tenth gets
 * added next week. This walks the component tree and fails on any `href={...}`
 * expression that is not visibly guarded.
 *
 * Deliberately syntactic, not clever. A reviewer can see what it checks, and a
 * genuinely-safe binding is one `safeHref(...)` away from passing.
 */

const COMPONENT_ROOT = 'src/lib/components';

/** Bindings whose value provably cannot be attacker-controlled. */
const ALLOWED = [
	/^href=\{safeHref\(/, // the guard itself
	/^href=\{`\//, // template literal rooted at a site-relative path
	/^href=\{scopedMediaUrl\(/, // built from our own origin + run id
	/^href=\{resolve\(/ // SvelteKit's own route resolver
];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : full.endsWith('.svelte') ? [full] : [];
	});
}

describe('every href binding in a component is guarded', () => {
	it('has no unguarded href={...} expression', () => {
		const offenders: string[] = [];
		for (const file of walk(COMPONENT_ROOT)) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					const match = line.match(/href=\{[^}]*\}?/);
					if (!match) return;
					const binding = match[0];
					// A local identifier that is itself derived above is still a risk;
					// the point is that SOMETHING visible must vouch for it.
					if (ALLOWED.some((re) => re.test(binding))) return;
					offenders.push(`${file}:${i + 1}  ${binding.trim()}`);
				});
		}

		expect(
			offenders,
			`Unguarded href bindings. Every URL rendered here can originate in LLM ` +
				`output or a scraped page, and "javascript:..." in an href executes in ` +
				`this app's origin with the user's session — rel="noopener" does not ` +
				`stop it. Wrap the value in safeHref() from $lib/utils/safe-url.\n` +
				offenders.join('\n')
		).toEqual([]);
	});
});
