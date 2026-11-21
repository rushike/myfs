import { Zip, ZipDeflate, AsyncZipDeflate } from 'fflate';

/**
 * A TransformStream that accepts OpfsStreamChunks and outputs
 * Uint8Array zip archive data.
 *
 * Usage:
 *   opfsReadableStream.pipeThrough(new ZipStreamTransformer())
 *
 * Input chunks (readable side):
 *   { type: "file-start", path: string }
 *   { type: "file-data",  data: Uint8Array }
 *   { type: "file-end" }
 *
 * Output chunks (writable side):
 *   Uint8Array — raw zip bytes, streamed incrementally
 *
 * Options:
 *   level  — compression level 0-9 (default: 6)
 *   async  — use AsyncZipDeflate for worker-based compression (default: false)
 */
class ZipStreamTransformer extends TransformStream {
    constructor(options = {}) {
        let zip;
        let currentEntry = null;
        const level = options.level ?? 6;
        const useAsync = options.async ?? false;

        super({
            start(controller) {
                zip = new Zip((err, data, final) => {
                    if (err) {
                        controller.error(err);
                        return;
                    }
                    controller.enqueue(data);
                    if (final) {
                        controller.terminate();
                    }
                });
            },

            transform(chunk, controller) {
                switch (chunk.type) {
                    case "file-start": {
                        const Deflator = useAsync ? AsyncZipDeflate : ZipDeflate;
                        currentEntry = new Deflator(chunk.path, { level });
                        zip.add(currentEntry);
                        break;
                    }
                    case "file-data": {
                        if (!currentEntry) {
                            controller.error(new Error("file-data without file-start"));
                            return;
                        }
                        currentEntry.push(chunk.data);
                        break;
                    }
                    case "file-end": {
                        if (!currentEntry) {
                            controller.error(new Error("file-end without file-start"));
                            return;
                        }
                        currentEntry.push(new Uint8Array(0), true);
                        currentEntry = null;
                        break;
                    }
                    default:
                        controller.error(new Error(`Unknown chunk type: ${chunk.type}`));
                }
            },

            flush(_controller) {
                zip.end();
            }
        });
    }
}

class ZstdStreamTransformer {

}

export { ZipStreamTransformer, ZstdStreamTransformer };
