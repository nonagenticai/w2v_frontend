/**
 * BriefForm tests — focus on the website_review auth_info panel.
 *
 * Binding round-trip (brief mutation) is exercised by the Playwright
 * create-flow spec; here we cover the DOM contract: the panel only
 * appears for `website_review` and the auth-method options + per-type
 * input affordances are present.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';

import BriefForm from './BriefForm.svelte';
import AuthHarness from './brief/AuthSection.harness.test.svelte';
import type { ProjectBrief } from '$lib/types';
import type { PickType } from '$lib/studio/project-request';

/** Render BriefForm with a two-way-bound `brief`, returning a live accessor. */
function setupBrief(type: PickType) {
	let brief: ProjectBrief = {};
	const utils = render(BriefForm, {
		type,
		get brief() {
			return brief;
		},
		set brief(v: ProjectBrief) {
			brief = v;
		}
	});
	return { ...utils, getBrief: () => brief };
}

describe('BriefForm — auth_info panel (website_review + promo)', () => {
	it('does NOT render the auth fieldset for types without site auth', () => {
		const { queryByTestId } = render(BriefForm, { type: 'generic', brief: {} });
		expect(queryByTestId('auth-type-select')).toBeNull();
	});

	it.each(['website_review', 'promo'] as const)(
		'renders the auth method selector for %s',
		(type) => {
			const { getByTestId } = render(BriefForm, { type, brief: {} });
			const select = getByTestId('auth-type-select') as HTMLSelectElement;
			expect(select).not.toBeNull();
			expect(select.value).toBe('none');
			// All four AuthInfo types appear as options
			const optionValues = Array.from(select.options).map((o) => o.value);
			expect(optionValues).toEqual(['none', 'basic', 'bearer', 'cookies']);
		}
	);

	it('switching to "basic" exposes username + password inputs', async () => {
		const { getByTestId, container } = render(BriefForm, {
			type: 'website_review',
			brief: {}
		});
		const select = getByTestId('auth-type-select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'basic' } });
		expect(container.querySelector('input[name="auth-username"]')).not.toBeNull();
		expect(container.querySelector('input[name="auth-password"]')).not.toBeNull();
		expect((container.querySelector('input[name="auth-password"]') as HTMLInputElement).type).toBe(
			'password'
		);
	});

	it('switching to "bearer" exposes a masked token input', async () => {
		const { getByTestId, container } = render(BriefForm, {
			type: 'website_review',
			brief: {}
		});
		const select = getByTestId('auth-type-select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'bearer' } });
		const token = container.querySelector('input[name="auth-token"]') as HTMLInputElement;
		expect(token).not.toBeNull();
		expect(token.type).toBe('password');
	});

	it('switching to "cookies" exposes a cookie-header textarea', async () => {
		const { getByTestId, container } = render(BriefForm, {
			type: 'website_review',
			brief: {}
		});
		const select = getByTestId('auth-type-select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'cookies' } });
		expect(container.querySelector('textarea[name="auth-cookie-header"]')).not.toBeNull();
	});

	it('pre-populates inputs from existing brief.auth_info', () => {
		const { container } = render(BriefForm, {
			type: 'website_review',
			brief: {
				auth_info: {
					type: 'bearer',
					token: 'pre-existing-token'
				}
			}
		});
		const token = container.querySelector('input[name="auth-token"]') as HTMLInputElement;
		expect(token).not.toBeNull();
		expect(token.value).toBe('pre-existing-token');
	});
});

describe('BriefForm — a STORED sign-in shows its true state', () => {
	// What GET /api/projects/{id} returns for a saved login (prod project 01a174a6):
	// the password is replaced by the orchestrator's REDACTED marker.
	const storedBrief = (): ProjectBrief => ({
		source_url: 'https://app.example.com/',
		auth_info: {
			type: 'basic',
			username: 'u@example.com',
			password: { redacted: true },
			login_url: 'https://auth.example.com/realms/app/protocol/openid-connect/auth'
		}
	});

	function setup(brief: ProjectBrief) {
		let current = brief;
		const utils = render(BriefForm, {
			type: 'promo',
			get brief() {
				return current;
			},
			set brief(v: ProjectBrief) {
				current = v;
			}
		});
		return { ...utils, getBrief: () => current };
	}

	it('says the password is saved instead of showing the marker as a typed password', () => {
		const { container, getByTestId, queryByTestId } = setup(storedBrief());
		const pw = container.querySelector('input[name="auth-password"]') as HTMLInputElement;
		expect(pw.value).toBe(''); // was "[object Object]" — 15 dots that looked typed
		expect(pw.placeholder).toBe('Saved — leave empty to keep');
		expect(getByTestId('auth-password-saved').textContent).toContain('A password is saved');
		expect(queryByTestId('auth-password-missing')).toBeNull();
		expect((container.querySelector('input[name="auth-username"]') as HTMLInputElement).value).toBe(
			'u@example.com'
		);
	});

	it('typing then clearing the field keeps the saved password', async () => {
		const { container, getBrief } = setup(storedBrief());
		const pw = container.querySelector('input[name="auth-password"]') as HTMLInputElement;
		await fireEvent.input(pw, { target: { value: 'new-pass' } });
		expect((getBrief().auth_info as Record<string, unknown>).password).toBe('new-pass');
		await fireEvent.input(pw, { target: { value: '' } });
		expect((getBrief().auth_info as Record<string, unknown>).password).toEqual({ redacted: true });
	});

	it('editing other fields keeps the saved password marker', async () => {
		const { getBrief } = setup(storedBrief());
		expect((getBrief().auth_info as Record<string, unknown>).password).toEqual({ redacted: true });
	});

	it('warns when a username is saved but no password is', () => {
		const brief = storedBrief();
		delete (brief.auth_info as Record<string, unknown>).password;
		const { getByTestId, queryByTestId } = setup(brief);
		expect(getByTestId('auth-password-missing').textContent).toContain('No password is saved');
		expect(queryByTestId('auth-password-saved')).toBeNull();
	});
});

describe('AuthSection — changing the saved login asks for the password again', () => {
	const stored = (): ProjectBrief => ({
		source_url: 'https://app.example.com/',
		auth_info: {
			type: 'basic',
			username: 'u@example.com',
			password: { redacted: true },
			login_url: 'https://auth.example.com/realms/app/auth'
		}
	});
	function setup(initial: ProjectBrief = stored()) {
		let last: ProjectBrief = initial;
		const utils = render(AuthHarness, {
			initial,
			onbrief: (b: ProjectBrief) => (last = b)
		});
		return { ...utils, getBrief: () => last };
	}
	const pw = (b: ProjectBrief) => (b.auth_info as Record<string, unknown>).password;

	it('after a reload, the SERVER flag says the password must be re-entered', () => {
		const b = stored();
		const ai = b.auth_info as Record<string, unknown>;
		delete ai.password;
		ai.needs_reentry = true;
		const { getByTestId, queryByTestId } = setup(b);
		expect(getByTestId('auth-password-login-changed').textContent).toContain(
			're-enter the password'
		);
		expect(queryByTestId('auth-password-missing')).toBeNull();
	});

	it('an SSO sign-in page on another site asks which app it signs into', async () => {
		const { getByTestId, queryByTestId, getBrief } = setup();
		expect(getByTestId('auth-signs-into-missing').textContent).toContain('auth.example.com');
		await fireEvent.click(getByTestId('auth-signs-into-use-source'));
		expect((getBrief().auth_info as Record<string, unknown>).signs_into).toBe(
			'https://app.example.com'
		);
		expect(queryByTestId('auth-signs-into-missing')).toBeNull();
		// Declaring the site is a change to the login, so the saved password is re-asked.
		expect(getByTestId('auth-password-login-changed').textContent).toContain(
			'The site this sign-in opens changed'
		);
	});

	it('a changed login address says to re-enter, stops sending the saved one, and undo restores it', async () => {
		const { container, getByTestId, queryByTestId, getBrief } = setup();
		const url = container.querySelector('input[name="auth-login-url"]') as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://auth.example.com/realms/other/auth' } });
		expect(getByTestId('auth-password-login-changed').textContent).toContain(
			'Login address changed — re-enter the password'
		);
		expect(queryByTestId('auth-password-saved')).toBeNull();
		expect(pw(getBrief())).toBeUndefined();
		await fireEvent.input(url, { target: { value: 'https://auth.example.com/realms/app/auth' } });
		expect(pw(getBrief())).toEqual({ redacted: true });
		expect(getByTestId('auth-password-saved')).toBeTruthy();
		expect(queryByTestId('auth-password-login-changed')).toBeNull();
	});

	it('a changed username says so too; a newly typed password clears the warning', async () => {
		const { container, getByTestId, queryByTestId, getBrief } = setup();
		const user = container.querySelector('input[name="auth-username"]') as HTMLInputElement;
		await fireEvent.input(user, { target: { value: 'someone@example.com' } });
		expect(getByTestId('auth-password-login-changed').textContent).toContain('Username changed');
		const field = container.querySelector('input[name="auth-password"]') as HTMLInputElement;
		await fireEvent.input(field, { target: { value: 'new-pass' } });
		expect(queryByTestId('auth-password-login-changed')).toBeNull();
		expect(pw(getBrief())).toBe('new-pass');
	});
});

describe('BriefForm — demo_video auth_config (login-gated demo)', () => {
	// container-scoped queries: testing-library's bound queries search the whole
	// document body, so multiple render()s in one test would see each other's nodes.
	const hasDemoAuth = (type: 'demo_video' | 'website_review' | 'generic') =>
		render(BriefForm, { type, brief: {} }).container.querySelector(
			'[data-testid="demo-auth-type-select"]'
		);

	it('renders the demo sign-in selector ONLY for demo_video', () => {
		expect(hasDemoAuth('demo_video')).not.toBeNull();
		// The website_review/promo auth_info fieldset is a different control.
		expect(hasDemoAuth('website_review')).toBeNull();
		expect(hasDemoAuth('generic')).toBeNull();
	});

	it('defaults to "none" with no credential inputs', () => {
		const { getByTestId, container } = render(BriefForm, { type: 'demo_video', brief: {} });
		expect((getByTestId('demo-auth-type-select') as HTMLSelectElement).value).toBe('none');
		expect(container.querySelector('input[name="demo-auth-username"]')).toBeNull();
	});

	it('switching to "form" exposes login_url + username + password', async () => {
		const { getByTestId, container } = render(BriefForm, { type: 'demo_video', brief: {} });
		const select = getByTestId('demo-auth-type-select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'form' } });
		expect(container.querySelector('input[name="demo-auth-login-url"]')).not.toBeNull();
		expect(container.querySelector('input[name="demo-auth-username"]')).not.toBeNull();
		const pw = container.querySelector('input[name="demo-auth-password"]') as HTMLInputElement;
		expect(pw).not.toBeNull();
		expect(pw.type).toBe('password');
	});

	it('pre-populates inputs from existing brief.auth_config', () => {
		const { getByTestId, container } = render(BriefForm, {
			type: 'demo_video',
			brief: {
				auth_config: {
					type: 'form',
					login_url: 'https://app.example.com/login',
					username: 'demo@example.com'
				}
			}
		});
		expect((getByTestId('demo-auth-type-select') as HTMLSelectElement).value).toBe('form');
		const url = container.querySelector('input[name="demo-auth-login-url"]') as HTMLInputElement;
		expect(url.value).toBe('https://app.example.com/login');
		const user = container.querySelector('input[name="demo-auth-username"]') as HTMLInputElement;
		expect(user.value).toBe('demo@example.com');
	});
});

describe('BriefForm — AI-visuals config (generic + promo)', () => {
	// Widened 2026-05-31: promo also wires ai_image_gen into its DAG, not
	// just generic. The previous gate left promo videos rendering as text-
	// only because the user had no way to opt the run into imagery.
	it.each(['generic', 'promo'] as const)('renders the AiVisualsConfig section for %s', (type) => {
		const { queryByTestId } = render(BriefForm, { type, brief: {} });
		expect(queryByTestId('ai-visuals-config')).not.toBeNull();
	});

	it.each(['website_review', 'app_review', 'course'] as const)(
		'does NOT render the AiVisualsConfig section for %s',
		(type) => {
			const { queryByTestId } = render(BriefForm, { type, brief: {} });
			expect(queryByTestId('ai-visuals-config')).toBeNull();
		}
	);
});

describe('BriefForm — promo site-capture + instructions', () => {
	it('renders the SiteCaptureConfig section for promo', () => {
		const { queryByTestId } = render(BriefForm, { type: 'promo', brief: {} });
		expect(queryByTestId('site-capture-config')).not.toBeNull();
	});

	it.each(['generic', 'website_review', 'app_review', 'course'] as const)(
		'does NOT render the SiteCaptureConfig section for %s',
		(type) => {
			const { queryByTestId } = render(BriefForm, { type, brief: {} });
			expect(queryByTestId('site-capture-config')).toBeNull();
		}
	);

	it('has NO on/off toggle — recording keys on the Sources URL alone (site_capture.py)', async () => {
		const { container, getBrief } = setupBrief('promo');
		expect(container.querySelector('input[name="site-capture-enabled"]')).toBeNull();
		const paths = container.querySelector(
			'textarea[name="site-capture-paths"]'
		) as HTMLTextAreaElement;
		expect(paths).not.toBeNull();
		await fireEvent.input(paths, { target: { value: '/pricing' } });
		expect(getBrief().site_capture).toEqual({ paths: ['/pricing'] });
		// Clearing every setting drops the block instead of leaving a meaningless `{}`.
		await fireEvent.input(paths, { target: { value: '' } });
		expect('site_capture' in getBrief()).toBe(false);
	});

	it('copy points at Sources, not a Source step promo does not have', () => {
		const { getByTestId } = render(BriefForm, { type: 'promo', brief: {} });
		const text = getByTestId('site-capture-config').textContent ?? '';
		expect(text).toMatch(/Sources/);
		expect(text).not.toMatch(/Source URL above|Source step/);
	});

	it('renders the promo instructions textarea', () => {
		const { container } = render(BriefForm, { type: 'promo', brief: {} });
		expect(container.querySelector('textarea[id="brief-instructions"]')).not.toBeNull();
	});
});

describe('BriefForm — course AI-video toggle (lesson transitivity)', () => {
	it('renders the AI-video toggle for course', () => {
		const { queryByTestId } = render(BriefForm, { type: 'course', brief: {} });
		expect(queryByTestId('ai-video-toggle')).not.toBeNull();
	});

	it.each(['generic', 'promo', 'website_review', 'app_review'] as const)(
		'does NOT render the AI-video toggle for %s',
		(type) => {
			const { queryByTestId } = render(BriefForm, { type, brief: {} });
			expect(queryByTestId('ai-video-toggle')).toBeNull();
		}
	);

	it('toggling on writes a truthy ai_video_gen block, off removes the key', async () => {
		// MUST be truthy ({ enabled: true }) — run_setup lifts brief.ai_video_gen
		// only when truthy and the stage skips on a falsy config, so {} is a no-op.
		const { getByTestId, getBrief } = setupBrief('course');
		const toggle = getByTestId('ai-video-toggle') as HTMLInputElement;
		await fireEvent.change(toggle, { target: { checked: true } });
		expect(getBrief().ai_video_gen).toEqual({ enabled: true });
		await fireEvent.change(toggle, { target: { checked: false } });
		expect('ai_video_gen' in getBrief()).toBe(false);
	});
});

describe('BriefForm — redesign_motion (animated hero) toggle', () => {
	it('web_design: toggling writes/removes brief.redesign_motion', async () => {
		const { getByTestId, getBrief } = setupBrief('web_design');
		const toggle = getByTestId('redesign-motion-toggle') as HTMLInputElement;
		await fireEvent.change(toggle, { target: { checked: true } });
		expect(getBrief().redesign_motion).toBe(true);
		await fireEvent.change(toggle, { target: { checked: false } });
		expect('redesign_motion' in getBrief()).toBe(false);
	});

	it('website_review: toggle is shown when a redesign will run (redesignEnabled)', () => {
		const { getByTestId } = render(BriefForm, {
			type: 'website_review',
			brief: {},
			redesignEnabled: true
		});
		expect(getByTestId('redesign-motion-toggle')).toBeTruthy();
	});

	it('website_review: toggle is hidden when no redesign is requested', () => {
		const { queryByTestId } = render(BriefForm, {
			type: 'website_review',
			brief: {},
			redesignEnabled: false
		});
		expect(queryByTestId('redesign-motion-toggle')).toBeNull();
	});

	it('does NOT render for types without a redesign (generic)', () => {
		const { queryByTestId } = render(BriefForm, { type: 'generic', brief: {} });
		expect(queryByTestId('redesign-motion-toggle')).toBeNull();
	});
});

describe('BriefForm — title_card (animated intro/outro) toggle', () => {
	it('promo: toggling writes a truthy block / removes brief.title_card', async () => {
		const { getByTestId, getBrief } = setupBrief('promo');
		const toggle = getByTestId('title-card-toggle') as HTMLInputElement;
		await fireEvent.change(toggle, { target: { checked: true } });
		expect(getBrief().title_card).toEqual({ enabled: true, intro: true, outro: true });
		await fireEvent.change(toggle, { target: { checked: false } });
		expect('title_card' in getBrief()).toBe(false);
	});

	it.each(['promo', 'generic', 'course', 'demo_video'] as const)('renders for %s', (type) => {
		const { getByTestId } = render(BriefForm, { type, brief: {} });
		expect(getByTestId('title-card-toggle')).toBeTruthy();
	});

	it('website_review: shown when a video will run (redesignEnabled)', () => {
		const { getByTestId } = render(BriefForm, {
			type: 'website_review',
			brief: {},
			redesignEnabled: true
		});
		expect(getByTestId('title-card-toggle')).toBeTruthy();
	});

	it('website_review: hidden when no video is requested', () => {
		const { queryByTestId } = render(BriefForm, {
			type: 'website_review',
			brief: {},
			redesignEnabled: false
		});
		expect(queryByTestId('title-card-toggle')).toBeNull();
	});

	it('does NOT render for web_design (no narrated video)', () => {
		const { queryByTestId } = render(BriefForm, { type: 'web_design', brief: {} });
		expect(queryByTestId('title-card-toggle')).toBeNull();
	});
});

describe('BriefForm — ken_burns (still pan/zoom) toggle', () => {
	it('promo: toggling writes an EXPLICIT enabled flag in both directions', async () => {
		const { getByTestId, getBrief } = setupBrief('promo');
		const toggle = getByTestId('ken-burns-toggle') as HTMLInputElement;
		await fireEvent.change(toggle, { target: { checked: true } });
		expect(getBrief().ken_burns).toEqual({ enabled: true });
		await fireEvent.change(toggle, { target: { checked: false } });
		// Explicit `false`, NOT a dropped key. Ken Burns is ON BY DEFAULT in the
		// orchestrator since #836 (an absent block means ENABLED), so dropping the
		// key would silently re-enable the very thing the user just switched off.
		expect(getBrief().ken_burns).toEqual({ enabled: false });
	});

	it('promo: defaults to CHECKED on an untouched brief, matching the pipeline default', () => {
		const { getByTestId } = render(BriefForm, { type: 'promo', brief: {} });
		expect((getByTestId('ken-burns-toggle') as HTMLInputElement).checked).toBe(true);
	});

	it('promo: an explicit enabled:false renders UNCHECKED', () => {
		const { getByTestId } = render(BriefForm, {
			type: 'promo',
			brief: { ken_burns: { enabled: false } }
		});
		expect((getByTestId('ken-burns-toggle') as HTMLInputElement).checked).toBe(false);
	});

	it.each(['promo', 'generic'] as const)('renders for %s', (type) => {
		const { getByTestId } = render(BriefForm, { type, brief: {} });
		expect(getByTestId('ken-burns-toggle')).toBeTruthy();
	});

	// course: the stitch never reads brief.ken_burns and lessons don't inherit it.
	it.each(['course', 'website_review', 'web_design', 'audiobook', 'demo_video'] as const)(
		'does NOT render for %s',
		(type) => {
			const { queryByTestId } = render(BriefForm, { type, brief: {} });
			expect(queryByTestId('ken-burns-toggle')).toBeNull();
		}
	);
});

describe('BriefForm — SEO audit advanced options (competitor content-gap + cross-page)', () => {
	it('renders the competitor-URLs list + cross-page toggle for seo_audit', () => {
		const { getByTestId, getByRole } = render(BriefForm, { type: 'seo_audit', brief: {} });
		expect(getByRole('group', { name: 'Competitor URLs (optional)' })).toBeTruthy();
		expect(getByTestId('audit-cross-page-toggle')).toBeTruthy();
		// The shared audit toggles are still present.
		expect(getByTestId('audit-include-llm-toggle')).toBeTruthy();
	});

	it('does NOT render competitor URLs or cross-page for cro_audit', () => {
		const { queryByTestId, queryByRole } = render(BriefForm, { type: 'cro_audit', brief: {} });
		expect(queryByRole('group', { name: 'Competitor URLs (optional)' })).toBeNull();
		expect(queryByTestId('audit-cross-page-toggle')).toBeNull();
		// but CRO keeps the shared audit toggles.
		expect(queryByTestId('audit-include-llm-toggle')).toBeTruthy();
	});

	it('toggling cross-page writes brief.cross_page_linking and drops it when off', async () => {
		const { getByTestId, getBrief } = setupBrief('seo_audit');
		const toggle = getByTestId('audit-cross-page-toggle') as HTMLInputElement;
		await fireEvent.click(toggle);
		expect(getBrief().cross_page_linking).toBe(true);
		await fireEvent.click(toggle);
		expect('cross_page_linking' in getBrief()).toBe(false);
	});

	it('the competitor-URLs list is wired to brief.competitor_urls (Add appends a row)', async () => {
		const { getByRole, getBrief } = setupBrief('seo_audit');
		const group = getByRole('group', { name: 'Competitor URLs (optional)' });
		const addBtn = within(group).getByRole('button', { name: /Add/ });
		await fireEvent.click(addBtn);
		// Add appends an empty row under the competitor_urls key — proving the list
		// field writes to the right brief key. (Per-item typing is a list-widget
		// concern covered by the shared list field + Playwright.)
		expect(getBrief().competitor_urls).toEqual(['']);
	});

	it('renders a pre-seeded competitor URL value (read path)', () => {
		const { getByDisplayValue } = render(BriefForm, {
			type: 'seo_audit',
			brief: { competitor_urls: ['https://rival.test'] }
		});
		expect(getByDisplayValue('https://rival.test')).toBeTruthy();
	});
});

describe('BriefForm — audit options + video toggle (descriptor-driven, no hand-listed union)', () => {
	// showAuditOptions = typeIsAudit(type); showAuditVideoOption = typeIsAudit && !typeIsScanOnlyAudit.
	// These read the TYPE_BRIEF `audit` descriptor, so a new audit type is classified
	// by its `audit.scanOnly` flag rather than being hand-added to a union here.
	it.each(['seo_audit', 'cro_audit', 'marketing_scorecard'] as const)(
		'shows the shared audit options (include-llm) for audit type %s',
		(type) => {
			const { getByTestId } = render(BriefForm, { type, brief: {} });
			expect(getByTestId('audit-include-llm-toggle')).toBeTruthy();
		}
	);

	it('does NOT show audit options for a non-audit type (generic)', () => {
		const { queryByTestId } = render(BriefForm, { type: 'generic', brief: {} });
		expect(queryByTestId('audit-include-llm-toggle')).toBeNull();
		expect(queryByTestId('audit-generate-video-toggle')).toBeNull();
	});

	it.each(['seo_audit', 'cro_audit'] as const)(
		'shows the generate-video toggle for the video-capable audit %s',
		(type) => {
			const { getByTestId } = render(BriefForm, { type, brief: {} });
			expect(getByTestId('audit-generate-video-toggle')).toBeTruthy();
		}
	);

	it('HIDES the generate-video toggle for the scan-only audit (marketing_scorecard)', () => {
		const { getByTestId, queryByTestId } = render(BriefForm, {
			type: 'marketing_scorecard',
			brief: {}
		});
		// Audit options are present…
		expect(getByTestId('audit-include-llm-toggle')).toBeTruthy();
		// …but the narrated-video opt-in is not (scanOnly → !typeIsScanOnlyAudit is false).
		expect(queryByTestId('audit-generate-video-toggle')).toBeNull();
	});
});

describe('BriefForm — types outside the wizard never crash the workspace', () => {
	it('renders an API-created growth_bundle brief (CTA fields, no throw)', () => {
		const { getByText } = render(BriefForm, {
			type: 'growth_bundle' as PickType,
			brief: {}
		});
		expect(getByText('Call to action')).toBeTruthy();
		expect(getByText('CTA link (optional)')).toBeTruthy();
	});

	it('renders (empty) for a type the FE has no spec for', () => {
		expect(() =>
			render(BriefForm, { type: 'brand_new_type' as PickType, brief: {} })
		).not.toThrow();
	});
});
