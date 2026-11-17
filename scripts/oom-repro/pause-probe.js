// Decisive probe: does this runtime's node:http honour an EXPLICIT req.pause()?
//
// Server pauses the request after the first chunk and never resumes. A runtime
// that honours pause() stops reading the socket, so `received` stays at roughly
// one chunk. A runtime that ignores it keeps draining the socket into memory
// and `received` climbs toward the full body — which makes any pause/resume
// based fix INERT on that runtime.
//
// Run: <runtime> pause-probe.js   then POST a large body at it.
import http from 'node:http';

const PORT = Number(process.env.PROBE_PORT || 47185);
const HOLD_MS = Number(process.env.PROBE_HOLD_MS || 8000);

http
	.createServer((req, res) => {
		let received = 0;
		let firstChunk = 0;
		req.on('data', (chunk) => {
			received += chunk.length;
			if (!firstChunk) {
				firstChunk = chunk.length;
				req.pause();
			}
		});
		setTimeout(() => {
			console.log(
				JSON.stringify({
					first_chunk_bytes: firstChunk,
					received_after_pause_mib: +(received / 1048576).toFixed(2),
					verdict: received > firstChunk * 8 ? 'PAUSE IGNORED' : 'pause honoured'
				})
			);
			res.writeHead(200).end('ok');
		}, HOLD_MS);
	})
	.listen(PORT, () => console.log(`pause-probe on :${PORT}`));
