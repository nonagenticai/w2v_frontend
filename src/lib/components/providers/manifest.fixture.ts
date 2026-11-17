/**
 * A real `GET /api/provider-requirements` response: `build_manifest()` from
 * w2v_orchestrator (P8, branch feat/p8-manifest @ 923fe0a) under the default
 * deployment policy, `used_by` trimmed to one entry per slot. Test fixture only.
 */
import type { ProviderRequirements } from '$lib/api/provider-requirements.js';

export const MANIFEST: ProviderRequirements = {
	app: 'w2v',
	manifest_version: 1,
	slots: [
		{
			slot: 'llm',
			label: 'Language model (LLM)',
			type: 'connection',
			default_kind: 'nonagentic-wm',
			default_kind_label: 'Platform (Nonagentic)',
			allowed_kinds: ['anthropic', 'openai-compatible'],
			byo_required: false,
			kinds: {
				anthropic: {
					label: 'Anthropic',
					help: '',
					base_url: 'optional',
					default_base_url: 'https://api.anthropic.com',
					model_required: false,
					secret_required: false,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: '',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: 'https://api.anthropic.com',
							format: 'url'
						}
					]
				},
				'openai-compatible': {
					label: 'OpenAI-compatible',
					help: '',
					base_url: 'required',
					default_base_url: null,
					model_required: false,
					secret_required: false,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'e.g. gpt-4.1-mini',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: true,
							help: 'https://api.example.com/v1',
							format: 'url'
						}
					]
				}
			},
			used_by: [
				{
					blueprint: 'action_reel_v1',
					project_type: 'action_reel',
					stage: 'shot_analysis',
					when: 'always'
				}
			]
		},
		{
			slot: 'tts',
			label: 'Text to speech',
			type: 'connection',
			default_kind: 'nonagentic',
			default_kind_label: 'Platform (Nonagentic)',
			allowed_kinds: ['elevenlabs', 'openai', 'openai-compatible'],
			byo_required: false,
			kinds: {
				elevenlabs: {
					label: 'ElevenLabs',
					help: '',
					base_url: 'optional',
					default_base_url: 'https://api.elevenlabs.io',
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: ['voice'],
					fields: [
						{
							key: 'options.voice',
							label: 'Voice ID',
							required: true,
							help: 'the ElevenLabs voice_id',
							format: 'text'
						},
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'e.g. eleven_multilingual_v2',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: 'https://api.elevenlabs.io',
							format: 'url'
						}
					]
				},
				openai: {
					label: 'OpenAI',
					help: '',
					base_url: 'optional',
					default_base_url: 'https://api.openai.com/v1',
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: ['voice'],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'e.g. gpt-4o-mini-tts',
							format: 'text'
						},
						{
							key: 'options.voice',
							label: 'Voice',
							required: true,
							help: 'e.g. alloy',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: 'https://api.openai.com/v1',
							format: 'url'
						}
					]
				},
				'openai-compatible': {
					label: 'OpenAI-compatible',
					help: '',
					base_url: 'required',
					default_base_url: null,
					model_required: true,
					secret_required: false,
					secret_label: 'API key',
					required_options: ['voice'],
					fields: [
						{
							key: 'base_url',
							label: 'Base URL',
							required: true,
							help: 'https://tts.example.com/v1',
							format: 'url'
						},
						{
							key: 'model',
							label: 'Model',
							required: true,
							help: 'the served model name',
							format: 'text'
						},
						{
							key: 'options.voice',
							label: 'Voice',
							required: true,
							help: '',
							format: 'text'
						}
					]
				}
			},
			used_by: [
				{
					blueprint: 'action_reel_v1',
					project_type: 'action_reel',
					stage: 'narrate',
					when: 'always'
				}
			]
		},
		{
			slot: 'image',
			label: 'Image generation',
			type: 'connection',
			default_kind: 'nonagentic',
			default_kind_label: 'Platform (Nonagentic)',
			allowed_kinds: ['openai'],
			byo_required: false,
			kinds: {
				openai: {
					label: 'OpenAI',
					help: '',
					base_url: 'optional',
					default_base_url: 'https://api.openai.com/v1',
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'defaults to gpt-image-1',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: 'https://api.openai.com/v1',
							format: 'url'
						}
					]
				}
			},
			used_by: [
				{
					blueprint: 'course_v1',
					project_type: 'course',
					stage: 'ai_image_gen',
					when: 'brief.ai_image_gen'
				}
			]
		},
		{
			slot: 'video_gen',
			label: 'Video generation',
			type: 'connection',
			default_kind: 'nonagentic',
			default_kind_label: 'Platform (Nonagentic)',
			allowed_kinds: ['kling', 'runway', 'seedance', 'sora', 'veo'],
			byo_required: false,
			kinds: {
				kling: {
					label: 'Kling',
					help: '',
					base_url: 'optional',
					default_base_url: null,
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'provider default',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: "the provider's public API",
							format: 'url'
						}
					]
				},
				runway: {
					label: 'Runway',
					help: '',
					base_url: 'optional',
					default_base_url: null,
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'provider default',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: "the provider's public API",
							format: 'url'
						}
					]
				},
				seedance: {
					label: 'Seedance',
					help: '',
					base_url: 'optional',
					default_base_url: null,
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'provider default',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: "the provider's public API",
							format: 'url'
						}
					]
				},
				sora: {
					label: 'OpenAI Sora',
					help: '',
					base_url: 'optional',
					default_base_url: null,
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'provider default',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: "the provider's public API",
							format: 'url'
						}
					]
				},
				veo: {
					label: 'Google Veo',
					help: '',
					base_url: 'optional',
					default_base_url: 'https://generativelanguage.googleapis.com/v1beta',
					model_required: false,
					secret_required: true,
					secret_label: 'API key',
					required_options: [],
					fields: [
						{
							key: 'model',
							label: 'Model',
							required: false,
							help: 'provider default',
							format: 'text'
						},
						{
							key: 'base_url',
							label: 'Base URL',
							required: false,
							help: "the provider's public API",
							format: 'url'
						}
					]
				}
			},
			used_by: [
				{
					blueprint: 'generic_v1',
					project_type: 'generic',
					stage: 'ai_video_gen',
					when: 'brief.ai_video_gen'
				}
			]
		},
		{
			slot: 'publish.youtube',
			label: 'YouTube publishing',
			type: 'grant',
			default_kind: 'platform',
			default_kind_label: 'Platform (Nonagentic)',
			allowed_kinds: [],
			byo_required: false,
			kinds: {},
			used_by: []
		},
		{
			slot: 'device_farm',
			label: 'Device farm',
			type: 'connection',
			default_kind: 'local',
			default_kind_label: 'Platform (local automation)',
			allowed_kinds: ['browserstack'],
			byo_required: false,
			kinds: {
				browserstack: {
					label: 'BrowserStack',
					help: '',
					base_url: 'forbidden',
					default_base_url: null,
					model_required: false,
					secret_required: true,
					secret_label: 'Access key',
					required_options: ['username'],
					fields: [
						{
							key: 'options.username',
							label: 'Username',
							required: true,
							help: 'your BrowserStack username',
							format: 'text'
						}
					]
				}
			},
			used_by: [
				{
					blueprint: 'app_review_v1',
					project_type: 'app_review',
					stage: 'app_inspect',
					when: 'always'
				}
			]
		}
	],
	dependencies: [
		{
			name: 'webscraper',
			label: 'Web scraper',
			type: 'platform',
			configurable: false,
			description:
				'Platform service that fetches web pages for source ingest (brief.sources url entries). Provided by the deployment; not tenant-configurable.'
		},
		{
			name: 'media_discovery',
			label: 'Media discovery',
			type: 'platform',
			configurable: false,
			description:
				'Platform service that searches stock media for the Find-media panel and the media_discovery stage (brief.media_discovery). Provided by the deployment; not tenant-configurable.'
		}
	]
};
