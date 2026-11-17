// Wizard context store using Svelte 5 runes (class-based for mutable imports)
// All state lives on a class instance so consumers can assign properties directly.

import type { CreatePipelineRequest } from '$lib/types';
import type { WizardPrefill } from '$lib/api/tenant-defaults.js';

// Factory values of the fields a workspace default can prefill. A prefill only
// replaces a field still holding its factory value, so a choice the user made
// before the (async) defaults arrived is never overwritten.
export const WIZARD_FACTORY_VOICE = 'af_heart';
export const WIZARD_FACTORY_SPEED = 1.0;
export const WIZARD_FACTORY_BRAND_COLOR = '#4F46E5';

// --- Types ---

export interface SupplementarySource {
	mode: 'url' | 'file';
	url: string;
	file: File | null;
	fileName: string;
	fileSize: number;
	label: string;
	authType: 'none' | 'basic' | 'bearer';
	username: string;
	password: string;
	token: string;
}

// --- Resolution mapping ---

const dimensionsToLabel: Record<string, string> = {
	'1920x1080': '1080p',
	'1280x720': '720p',
	'3840x2160': '4k'
};

export function resolutionToLabel(dim: string): string {
	return dimensionsToLabel[dim] ?? dim;
}

// --- Store class ---

class WizardStore {
	// Configuration page
	sourceType = $state<'web' | 'ios' | 'android' | 'other'>('web');
	url = $state('');
	urlError = $state('');
	message = $state('');
	appPath = $state('');
	appIdentifier = $state('');
	deviceName = $state('');
	authEnabled = $state(false);
	authType = $state('none');
	loginUrl = $state('');
	authUsername = $state('');
	authPassword = $state('');
	authToken = $state('');
	crawlEnabled = $state(true);
	maxPages = $state(30);
	supplementarySources = $state<SupplementarySource[]>([]);

	// Purpose page
	createDemoVideo = $state(true);
	videoMode = $state<string>('webapp_commercial');
	demoFocusAreas = $state('');
	enableReview = $state(true);
	reviewFocusAreas = $state('');
	createReviewVideo = $state(true);
	enableCritique = $state(true);
	critiqueFocusAreas = $state('');
	critiqueCategories = $state<string[]>(['ux', 'performance', 'accessibility', 'seo', 'security']);
	createCritiqueVideo = $state(true);
	enableRedesign = $state(true);
	runFrontendTest = $state(false);
	createSlideDeck = $state(false);
	createRedesignVideo = $state(false);
	redesignStyle = $state('modern');
	redesignScope = $state('full');

	// Pack selection (replaces growth mode)
	selectedPack = $state('');
	/** @deprecated Use selectedPack instead */
	get enableGrowthMode() {
		return this.selectedPack === 'prospect_microsite';
	}
	set enableGrowthMode(v: boolean) {
		this.selectedPack = v ? 'prospect_microsite' : '';
	}
	campaignStyles = $state<string[]>(['webapp_commercial', 'commercial', 'company_commercial']);
	campaignVariantsPerStyle = $state(3);
	campaignVariantDuration = $state(15);
	campaignTopVariants = $state(3);
	campaignHooks = $state('');
	campaignCtas = $state('');

	// Settings page
	ttsProvider = $state('kokoro');
	voice = $state(WIZARD_FACTORY_VOICE);
	narrationSpeed = $state(WIZARD_FACTORY_SPEED);
	llmProvider = $state('deepseek');
	modelFast = $state('deepseek-v4-flash');
	modelBalanced = $state('deepseek-v4-flash');
	modelCapable = $state('deepseek-v4-flash');
	openaiBaseUrl = $state('');
	openaiApiKeyEnv = $state('');
	stageOverrides = $state<Record<string, { provider?: string; model?: string }>>({});
	theme = $state('default');
	brandColor = $state(WIZARD_FACTORY_BRAND_COLOR);
	// Orchestrator tier (1080p | 2k | 4k); 2k is its own default (quality_tier).
	resolution = $state('2k');
	frameRate = $state('30');
	videoQuality = $state(80);
	transitionType = $state('fade');

	// Derived
	get isMobile(): boolean {
		return this.sourceType === 'ios' || this.sourceType === 'android';
	}

	get isDocumentOnly(): boolean {
		return this.sourceType === 'other';
	}

	resetWizard(): void {
		this.sourceType = 'web';
		this.url = '';
		this.urlError = '';
		this.message = '';
		this.appPath = '';
		this.appIdentifier = '';
		this.deviceName = '';
		this.authEnabled = false;
		this.authType = 'none';
		this.loginUrl = '';
		this.authUsername = '';
		this.authPassword = '';
		this.authToken = '';
		this.crawlEnabled = true;
		this.maxPages = 30;
		this.supplementarySources = [];

		this.createDemoVideo = true;
		this.videoMode = 'webapp_commercial';
		this.demoFocusAreas = '';
		this.enableReview = true;
		this.reviewFocusAreas = '';
		this.createReviewVideo = true;
		this.enableCritique = true;
		this.critiqueFocusAreas = '';
		this.critiqueCategories = ['ux', 'performance', 'accessibility', 'seo', 'security'];
		this.createCritiqueVideo = true;
		this.enableRedesign = true;
		this.runFrontendTest = false;
		this.createSlideDeck = false;
		this.createRedesignVideo = false;
		this.redesignStyle = 'modern';
		this.redesignScope = 'full';
		this.selectedPack = '';
		this.campaignStyles = ['webapp_commercial', 'commercial', 'company_commercial'];
		this.campaignVariantsPerStyle = 3;
		this.campaignVariantDuration = 15;
		this.campaignTopVariants = 3;
		this.campaignHooks = '';
		this.campaignCtas = '';

		this.ttsProvider = 'kokoro';
		this.voice = WIZARD_FACTORY_VOICE;
		this.narrationSpeed = WIZARD_FACTORY_SPEED;
		this.llmProvider = 'deepseek';
		this.modelFast = 'deepseek-v4-flash';
		this.modelBalanced = 'deepseek-v4-flash';
		this.modelCapable = 'deepseek-v4-flash';
		this.openaiBaseUrl = '';
		this.openaiApiKeyEnv = '';
		this.stageOverrides = {};
		this.theme = 'default';
		this.brandColor = WIZARD_FACTORY_BRAND_COLOR;
		this.resolution = '2k';
		this.frameRate = '30';
		this.videoQuality = 80;
		this.transitionType = 'fade';
	}

	/** Start from the workspace defaults (GET /api/tenant/defaults, P6 FE-1). */
	applyTenantDefaults(p: WizardPrefill): void {
		if (p.voiceId && this.voice === WIZARD_FACTORY_VOICE) this.voice = p.voiceId;
		if (p.speed != null && this.narrationSpeed === WIZARD_FACTORY_SPEED) {
			this.narrationSpeed = p.speed;
		}
		if (p.brandColor && this.brandColor === WIZARD_FACTORY_BRAND_COLOR) {
			this.brandColor = p.brandColor;
		}
	}

	buildCreateRequest(): CreatePipelineRequest {
		const stages: string[] = [];

		// 1. Source stage (mutually exclusive)
		if (this.sourceType === 'web') stages.push('crawl');
		else if (this.isMobile) stages.push('app_inspect');
		else if (this.isDocumentOnly) stages.push('ingest');

		// 2. Analysis (always)
		stages.push('analyze');

		// 3. Post-analysis (independent toggles, plus video/deck dependencies)
		const needsReview = this.enableReview || this.createReviewVideo;
		const needsCritique = this.enableCritique || this.createCritiqueVideo || this.createReviewVideo;
		if (needsReview) stages.push('review');
		if (needsCritique) stages.push('critique');

		// 4. Redesign / deck / redesign-video base stages
		const needsRedesign =
			this.enableRedesign ||
			this.createSlideDeck ||
			this.createRedesignVideo ||
			this.selectedPack === 'prospect_microsite';
		if (needsRedesign) {
			stages.push('brand_extract', 'redesign', 'redesign_refine', 'redesign_narrate');
		}
		if (this.createSlideDeck) stages.push('slide_deck');
		if (this.createRedesignVideo) stages.push('redesign_compile');
		if (this.createReviewVideo || this.createCritiqueVideo) stages.push('report_compile');

		// 5. Campaign pack (prospect_microsite pack only)
		if (this.selectedPack === 'prospect_microsite') {
			stages.push('campaign_pack');
		}

		// 6. Frontend testing (BDD test generation + execution)
		if (this.runFrontendTest) {
			stages.push('bdd_generate', 'test_execute');
		}

		// 7. Narrative + demo video
		if (this.createDemoVideo) {
			stages.push('storyline', 'narrate', 'shotlist');
			stages.push('generate', 'validate', 'record', 'compile');
		}

		// Build campaign_pack config (for prospect_microsite)
		const campaignPackConfig: Record<string, unknown> | undefined =
			this.selectedPack === 'prospect_microsite'
				? {
						script_styles: this.campaignStyles,
						variants_per_style: this.campaignVariantsPerStyle,
						variant_duration_seconds: this.campaignVariantDuration,
						top_variants: this.campaignTopVariants,
						...(this.campaignHooks.trim()
							? { hooks: this.campaignHooks.trim().split('\n').filter(Boolean) }
							: {}),
						...(this.campaignCtas.trim()
							? { ctas: this.campaignCtas.trim().split('\n').filter(Boolean) }
							: {})
					}
				: undefined;

		// Mode resolution: pack > redesign > critique > frontend_test > full
		const mode = this.selectedPack
			? this.selectedPack
			: needsRedesign
				? 'redesign'
				: needsCritique
					? 'critique_only'
					: this.runFrontendTest && !this.enableReview
						? 'frontend_test'
						: 'full';

		return {
			url: this.isDocumentOnly ? '' : this.isMobile ? this.appIdentifier || this.appPath : this.url,
			source_type: this.sourceType,
			config: {
				stages_enabled: [...new Set(stages)],
				mode,
				video_style: this.createDemoVideo ? this.videoMode : undefined,
				timeout_seconds: 7200,
				retry_max_attempts: 3,
				...(campaignPackConfig ? { campaign_pack: campaignPackConfig } : {})
			},
			user_context: {
				message: this.message || undefined,
				source_type: this.sourceType,
				crawl:
					this.isMobile || this.isDocumentOnly
						? undefined
						: {
								max_depth: this.crawlEnabled ? 3 : 1,
								max_pages: this.crawlEnabled ? this.maxPages : 1
							},
				theme: {
					name: this.theme,
					brand_color: this.theme === 'custom' ? this.brandColor : undefined
				},
				narration: {
					tts_provider: this.ttsProvider,
					voice: this.voice,
					speed: this.narrationSpeed
				},
				llm: {
					provider: this.llmProvider,
					model_fast: this.modelFast,
					model_balanced: this.modelBalanced,
					model_capable: this.modelCapable,
					base_url: this.openaiBaseUrl || undefined,
					api_key_env: this.openaiApiKeyEnv || undefined,
					stage_overrides:
						Object.keys(this.stageOverrides).length > 0 ? this.stageOverrides : undefined
				},
				video: {
					resolution: this.resolution,
					frame_rate: parseInt(this.frameRate),
					quality: this.videoQuality,
					transition_type: this.transitionType
				},
				redesign: this.enableRedesign
					? { style: this.redesignStyle, scope: this.redesignScope }
					: undefined,
				critique: this.enableCritique ? { categories: this.critiqueCategories } : undefined,
				auth: this.authEnabled
					? { type: this.authType, login_url: this.loginUrl || undefined }
					: undefined
			},
			site_name: undefined
		};
	}
}

export const wizard = new WizardStore();
