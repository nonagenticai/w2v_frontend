import { describe, expect, it } from 'vitest';
import { tenantLabel } from './tenant-label';

const ID = '019a3f2c-7d1e-7b4a-9c2d-5e6f7a8b9c0d';

describe('tenantLabel', () => {
	it('uses the registry name when set', () => {
		expect(tenantLabel({ tenant_id: ID, name: 'Acme' })).toBe('Acme');
	});

	it('never renders a bare UUID for an unnamed tenant', () => {
		for (const name of [null, undefined, '', '   ']) {
			const label = tenantLabel({ tenant_id: ID, name });
			expect(label).toBe('Unnamed workspace · 019a3f2c');
			expect(label).not.toContain(ID);
		}
	});
});
