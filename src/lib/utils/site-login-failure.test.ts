import { describe, expect, it } from 'vitest';
import { siteLoginFailure, siteLoginFailureFromRun } from './run-actions';

// The orchestrator's SiteCaptureLoginError `failure_detail` (w2v_orchestrator#1163):
// structured `site` + `reason`, plus a prose `message` the page must NOT parse.
const DETAIL = {
	code: 'site_login_failed',
	site: 'commonpractice-app.nonagentic.ai',
	reason: 'the sign-in page did not accept the saved login',
	message: 'prose the run page must not depend on'
};

describe('siteLoginFailure', () => {
	it('names the site and the reason from the structured fields, and where to fix it', () => {
		const f = siteLoginFailure(DETAIL);
		expect(f?.site).toBe('commonpractice-app.nonagentic.ai');
		expect(f?.title).toBe('Couldn’t sign in to commonpractice-app.nonagentic.ai');
		expect(f?.body).toMatch(/^The sign-in page did not accept the saved login\. /);
		expect(f?.body).toContain('Brief page');
		expect(f?.body).toContain('rerun this step');
	});

	it('never parses the message prose', () => {
		const f = siteLoginFailure({
			code: 'site_login_failed',
			message: "Couldn't sign in to evil.example — x. Check the Brief page"
		});
		expect(f?.site).toBe('your site');
		expect(f?.body).toMatch(/^The run stopped instead of recording the sign-in screen\./);
	});

	it('ignores every other failure code', () => {
		expect(siteLoginFailure({ ...DETAIL, code: 'upstream_auth' })).toBeNull();
		expect(siteLoginFailure(null)).toBeNull();
		expect(siteLoginFailureFromRun(null)).toBeNull();
		expect(siteLoginFailureFromRun({ failure_detail: DETAIL })?.site).toBe(
			'commonpractice-app.nonagentic.ai'
		);
	});
});

describe('degradation titles for the run 01a17e6f warnings', () => {
	it('names an empty review instead of title-casing its code', async () => {
		const { degradationCodeTitle } = await import('./run-warnings');
		expect(degradationCodeTitle('promo_review_empty')).toBe('Video not reviewed');
		expect(degradationCodeTitle('site_capture_no_footage')).toBe('No site footage recorded');
	});
});
