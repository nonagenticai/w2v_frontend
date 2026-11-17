// Pushes N concurrent 64 MiB request bodies through the frontend proxy path
// (/api/*), as fast as the frontend's own socket will take them. Each body is
// one multipart upload part; concurrency models concurrent OPERATORS, not
// parallel parts (uploads.ts uploads parts sequentially).
import http from 'node:http';

const PORT = Number(process.env.FE_PORT || 47183);
const N = Number(process.env.CONCURRENCY || 4);
const PART = Number(process.env.PART_BYTES || 64 * 1024 * 1024);
const CHUNK = Buffer.alloc(1024 * 1024, 0x61);

// Hard wall-clock bound per arm. The peak-RSS high-water mark is reached as
// soon as the runtime has swallowed what it is going to swallow; we do not
// need the transfer to finish to measure it, and a buggy runtime may never
// finish at all.
const DEADLINE_MS = Number(process.env.LOAD_DEADLINE_MS || 20_000);

function one(i) {
	return new Promise((resolve) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port: PORT,
				path: `/api/uploads/part?n=${i}`,
				method: 'PUT',
				headers: {
					'content-type': 'application/octet-stream',
					'content-length': String(PART)
				}
			},
			(res) => {
				res.resume();
				res.on('end', () =>
					resolve({ i, status: res.statusCode, sent_mib: +(sent / 1048576).toFixed(1) })
				);
			}
		);
		let sent = 0;
		const timer = setTimeout(() => {
			req.destroy();
			resolve({ i, timedOut: true, sent_mib: +(sent / 1048576).toFixed(1) });
		}, DEADLINE_MS);
		timer.unref?.();

		req.on('error', (e) => {
			clearTimeout(timer);
			resolve({ i, error: e.message, sent_mib: +(sent / 1048576).toFixed(1) });
		});
		req.on('response', () => clearTimeout(timer));

		const pump = () => {
			while (sent < PART) {
				const n = Math.min(CHUNK.length, PART - sent);
				sent += n;
				const ok = req.write(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n));
				if (!ok) {
					req.once('drain', pump);
					return;
				}
			}
			req.end();
		};
		pump();
	});
}

const t0 = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => one(i)));
console.log(
	JSON.stringify({
		concurrency: N,
		part_mib: PART / 1024 / 1024,
		seconds: ((Date.now() - t0) / 1000).toFixed(1),
		results
	})
);
