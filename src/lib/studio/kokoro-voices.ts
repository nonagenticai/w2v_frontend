// Frontend mirror of the orchestrator's voice_catalog.py (54 kokoro presets).
//
// KEEP IN EXACT SYNC with src/services/stages/audiobook/voice_catalog.py in
// w2v_orchestrator: the audiobook_cast stage validates every voice_id against
// that same set server-side and SILENTLY repairs an unknown id to the narrator
// default. So offering an id that isn't in this list would be a confusing
// no-op for the user (they pick a voice, the book narrates in another). That's
// why this picker uses exactly the 54 ids — not the larger Settings-page list.

/** Default narrator voice (matches voice_catalog._DEFAULT_NARRATOR_VOICE). */
export const NARRATOR_DEFAULT_VOICE = 'af_heart';

// kokoro id prefix → display language + gender (mirrors _PREFIX_META).
const PREFIX_META: Record<string, { language: string; gender: 'F' | 'M' }> = {
	af: { language: 'American English', gender: 'F' },
	am: { language: 'American English', gender: 'M' },
	bf: { language: 'British English', gender: 'F' },
	bm: { language: 'British English', gender: 'M' },
	ef: { language: 'Spanish', gender: 'F' },
	em: { language: 'Spanish', gender: 'M' },
	ff: { language: 'French', gender: 'F' },
	hf: { language: 'Hindi', gender: 'F' },
	hm: { language: 'Hindi', gender: 'M' },
	if: { language: 'Italian', gender: 'F' },
	im: { language: 'Italian', gender: 'M' },
	jf: { language: 'Japanese', gender: 'F' },
	jm: { language: 'Japanese', gender: 'M' },
	pf: { language: 'Portuguese', gender: 'F' },
	pm: { language: 'Portuguese', gender: 'M' },
	zf: { language: 'Mandarin Chinese', gender: 'F' },
	zm: { language: 'Mandarin Chinese', gender: 'M' }
};

// The 54 live kokoro voice ids (sorted). MUST equal VOICE_CATALOG server-side.
export const KOKORO_VOICE_IDS = [
	'af_alloy',
	'af_aoede',
	'af_bella',
	'af_heart',
	'af_jessica',
	'af_kore',
	'af_nicole',
	'af_nova',
	'af_river',
	'af_sarah',
	'af_sky',
	'am_adam',
	'am_echo',
	'am_eric',
	'am_fenrir',
	'am_liam',
	'am_michael',
	'am_onyx',
	'am_puck',
	'am_santa',
	'bf_alice',
	'bf_emma',
	'bf_isabella',
	'bf_lily',
	'bm_daniel',
	'bm_fable',
	'bm_george',
	'bm_lewis',
	'ef_dora',
	'em_alex',
	'em_santa',
	'ff_siwis',
	'hf_alpha',
	'hf_beta',
	'hm_omega',
	'hm_psi',
	'if_sara',
	'im_nicola',
	'jf_alpha',
	'jf_gongitsune',
	'jf_nezumi',
	'jf_tebukuro',
	'jm_kumo',
	'pf_dora',
	'pm_alex',
	'pm_santa',
	'zf_xiaobei',
	'zf_xiaoni',
	'zf_xiaoxiao',
	'zf_xiaoyi',
	'zm_yunjian',
	'zm_yunxi',
	'zm_yunxia',
	'zm_yunyang'
] as const;

/** Fast membership check matching the server-side frozenset. */
export const VOICE_CATALOG: ReadonlySet<string> = new Set<string>(KOKORO_VOICE_IDS);

export interface VoiceOption {
	value: string;
	label: string;
}
export interface VoiceGroup {
	language: string;
	voices: VoiceOption[];
}

function meta(id: string): { language: string; gender: 'F' | 'M' } {
	return PREFIX_META[id.slice(0, 2)] ?? { language: 'Other', gender: 'F' };
}

/** Human-readable option label, e.g. "af_heart" → "Heart (F)". */
export function voiceLabel(id: string): string {
	const name = id.split('_')[1] ?? id;
	const pretty = name.charAt(0).toUpperCase() + name.slice(1);
	return `${pretty} (${meta(id).gender})`;
}

/** The 54 voices grouped by language, for rendering as <optgroup>s. */
export const KOKORO_VOICE_GROUPS: VoiceGroup[] = (() => {
	const groups = new Map<string, VoiceOption[]>();
	for (const id of KOKORO_VOICE_IDS) {
		const { language } = meta(id);
		const opt: VoiceOption = { value: id, label: voiceLabel(id) };
		const existing = groups.get(language);
		if (existing) existing.push(opt);
		else groups.set(language, [opt]);
	}
	return [...groups.entries()].map(([language, voices]) => ({ language, voices }));
})();
