import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BrandEditor from './BrandEditor.svelte';
import type { BrandConfig } from '$lib/types';

describe('BrandEditor', () => {
	it('prefills the surfaced fields from the value', () => {
		const { getByLabelText } = render(BrandEditor, {
			value: {
				accent_color: '#123456',
				display_font: 'Fraunces',
				logo_url: 'https://x/logo.svg'
			} as BrandConfig
		});
		// The hex text field shares the label via name; query by the input name.
		expect((getByLabelText('Accent') as HTMLInputElement).value).toBe('#123456');
		expect((getByLabelText('Display font') as HTMLInputElement).value).toBe('Fraunces');
		expect((getByLabelText('Logo URL') as HTMLInputElement).value).toBe('https://x/logo.svg');
	});

	it('keeps a non-hex color in the text field but shows black on the swatch', () => {
		const { getByLabelText } = render(BrandEditor, {
			value: { primary_color: 'rgb(1, 2, 3)' } as BrandConfig
		});
		expect((getByLabelText('Primary') as HTMLInputElement).value).toBe('rgb(1, 2, 3)');
		expect((getByLabelText('Primary swatch') as HTMLInputElement).value).toBe('#000000');
	});
});
