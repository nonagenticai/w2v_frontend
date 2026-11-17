import { postForBlob } from './downloads.js';

export interface VoicePreviewRequest {
	provider?: string;
	voice?: string;
	speed?: number;
}

export const tts = {
	/**
	 * Synthesize a short sample in the given voice/provider/speed and resolve to
	 * the audio blob for in-browser playback. Backed by the orchestrator's
	 * `POST /api/tts/preview` (which forwards to the TTS service).
	 */
	previewVoice(req: VoicePreviewRequest): Promise<Blob> {
		return postForBlob('/tts/preview', req, 'audio/wav');
	}
};
