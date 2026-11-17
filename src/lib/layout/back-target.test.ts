import { describe, expect, it } from 'vitest';
import { wizardBackTarget } from './back-target';

describe('wizardBackTarget', () => {
	it('goes back to Projects when entered from the project list or a project', () => {
		expect(wizardBackTarget('/projects')).toEqual({ href: '/projects', label: 'projects' });
		expect(wizardBackTarget('/projects/p1')).toEqual({ href: '/projects', label: 'projects' });
	});

	it('defaults to the dashboard (direct load, dashboard, sidebar CTA from elsewhere)', () => {
		expect(wizardBackTarget(null)).toEqual({ href: '/', label: 'dashboard' });
		expect(wizardBackTarget('/')).toEqual({ href: '/', label: 'dashboard' });
		expect(wizardBackTarget('/settings')).toEqual({ href: '/', label: 'dashboard' });
		expect(wizardBackTarget('/projects/new')).toEqual({ href: '/', label: 'dashboard' });
		expect(wizardBackTarget('/projectsfoo')).toEqual({ href: '/', label: 'dashboard' });
	});
});
