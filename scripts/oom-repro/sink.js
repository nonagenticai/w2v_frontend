// Deliberately slow upstream. Stands in for w2v-orchestrator absorbing a
// multipart upload part more slowly than the client can push it. Run under
// real node so its own runtime never confuses the measurement.
//
// Rate is PER CONNECTION (matching the production shape: N concurrent
// operators each pushing one sequential part). Rate limiting is expressed as
// real stream backpressure — a Writable whose _write callback is delayed in
// proportion to the chunk size — so the TCP window closes on the proxy, which
// is exactly the condition the frontend must survive.
import http from 'node:http';
import { Writable, pipeline } from 'node:stream';

const PORT = Number(process.env.SINK_PORT || 47184);
const RATE = Number(process.env.SINK_RATE_BYTES_PER_SEC || 4 * 1024 * 1024);

const server = http.createServer((req, res) => {
	let received = 0;
	const progress = process.env.SINK_PROGRESS
		? setInterval(() => console.log(`recv ${(received / 1048576).toFixed(1)} MiB`), 2000)
		: null;

	const slow = new Writable({
		highWaterMark: 64 * 1024,
		write(chunk, _enc, cb) {
			received += chunk.length;
			setTimeout(cb, (chunk.length / RATE) * 1000);
		}
	});

	pipeline(req, slow, (err) => {
		if (progress) clearInterval(progress);
		if (err) return;
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ received }));
	});
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.listen(PORT, '127.0.0.1', () => {
	console.log(`sink on :${PORT} @ ${(RATE / 1024 / 1024).toFixed(1)} MiB/s per connection`);
});
