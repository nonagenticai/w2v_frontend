import { describe, it, expect } from 'vitest';
import { runPageTitle } from './page-title';

describe('runPageTitle', () => {
	it('names the project and its workflow type', () => {
		expect(runPageTitle('Acme launch', 'demo_video')).toBe('Acme launch · Demo video run - Studio');
	});

	it('falls back to the raw type id for an unmapped type', () => {
		expect(runPageTitle('Acme', 'brand_new_type')).toBe('Acme · brand_new_type run - Studio');
	});

	it('omits the type when it is missing', () => {
		expect(runPageTitle('Acme', null)).toBe('Acme · Run - Studio');
	});

	it('falls back to the generic title when the project title is not known', () => {
		expect(runPageTitle(undefined, 'demo_video')).toBe('Pipeline Detail - Studio');
		expect(runPageTitle('   ', 'demo_video')).toBe('Pipeline Detail - Studio');
	});
});
