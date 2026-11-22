import { Zip, ZipDeflate, AsyncZipDeflate, Gzip, Deflate, Zlib } from 'fflate';

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

/**
 * A TransformStream that accumulates small Uint8Array chunks into
 * larger fixed-size buffer emissions, reducing downstream GC pressure.
 *
 * Options:
 *   bufferSize — size of the accumulation buffer in bytes (default: 512KB)
 */
class BufferedStreamTransformer extends TransformStream {
    constructor(options = {}) {
        const bufferSize = options.bufferSize ?? (512 * 1024);
        let buffer = new Uint8Array(bufferSize);
        let offset = 0;

        super({
            transform(chunk, controller) {
                let chunkOffset = 0;

                while (chunkOffset < chunk.byteLength) {
                    const remaining = bufferSize - offset;
                    const toCopy = Math.min(remaining, chunk.byteLength - chunkOffset);

                    buffer.set(
                        chunk.subarray(chunkOffset, chunkOffset + toCopy),
                        offset
                    );
                    offset += toCopy;
                    chunkOffset += toCopy;

                    if (offset === bufferSize) {
                        controller.enqueue(buffer);
                        buffer = new Uint8Array(bufferSize);
                        offset = 0;
                    }
                }
            },

            flush(controller) {
                if (offset > 0) {
                    controller.enqueue(buffer.slice(0, offset));
                    offset = 0;
                }
                buffer = null;
            }
        });
    }
}

/**
 * A TransformStream that compresses Uint8Array chunks into GZIP format.
 */
class GzipStreamTransformer extends TransformStream {
    constructor(options = {}) {
        let stream;
        super({
            start(controller) {
                stream = new Gzip(options, (chunk, final) => {
                    if (chunk && chunk.length > 0) {
                        controller.enqueue(chunk);
                    }
                    if (final) {
                        controller.terminate();
                    }
                });
            },
            transform(chunk) {
                stream.push(chunk, false);
            },
            flush() {
                stream.push(new Uint8Array(0), true);
            }
        });
    }
}

/**
 * A TransformStream that compresses Uint8Array chunks into raw DEFLATE format.
 */
class DeflateRawStreamTransformer extends TransformStream {
    constructor(options = {}) {
        let stream;
        super({
            start(controller) {
                stream = new Deflate(options, (chunk, final) => {
                    if (chunk && chunk.length > 0) {
                        controller.enqueue(chunk);
                    }
                    if (final) {
                        controller.terminate();
                    }
                });
            },
            transform(chunk) {
                stream.push(chunk, false);
            },
            flush() {
                stream.push(new Uint8Array(0), true);
            }
        });
    }
}

/**
 * A TransformStream that compresses Uint8Array chunks into Zlib (DEFLATE with zlib wrapper) format.
 */
class DeflateStreamTransformer extends TransformStream {
    constructor(options = {}) {
        let stream;
        super({
            start(controller) {
                stream = new Zlib(options, (chunk, final) => {
                    if (chunk && chunk.length > 0) {
                        controller.enqueue(chunk);
                    }
                    if (final) {
                        controller.terminate();
                    }
                });
            },
            transform(chunk) {
                stream.push(chunk, false);
            },
            flush() {
                stream.push(new Uint8Array(0), true);
            }
        });
    }
}

/**
 * A TransformStream that compresses Uint8Array chunks into Zstandard (zstd) format
 * using the my-zstd-bridge WASM module compiled via Emscripten.
 *
 * Zero-copy JS↔WASM bridge:
 *   - Input:  HEAPU8.set(chunk, inPtr)  — 1 memcpy into WASM heap, unavoidable
 *   - Output: .slice() of WASM view     — 1 copy to detach from WASM lifetime,
 *             then inPtr/outPtr are immediately reused for the next chunk
 *
 * Built-in output buffering (outputBufferSize, default 512KB): each enqueued
 * chunk is already ~outputBufferSize, so BufferedStreamTransformer is NOT needed.
 *
 * Options:
 *   level            — zstd compression level 1-22 (default: 3)
 *   inputBufferSize  — WASM input buffer size in bytes  (default: 64KB)
 *   outputBufferSize — WASM output buffer size in bytes (default: 512KB)
 */
class ZstdStreamTransformer extends TransformStream {
    constructor(options = {}) {
        const level     = options.level            ?? 3;
        const inBufSize = options.inputBufferSize  ?? (64  * 1024);
        const outBufSize= options.outputBufferSize ?? (512 * 1024);

        // Shared state across start / transform / flush via closure
        let M;        // Emscripten WASM module
        let cstream;  // ptr → ZSTD_CStream in WASM heap
        let inPtr;    // ptr → fixed input  buffer in WASM heap
        let outPtr;   // ptr → fixed output buffer in WASM heap

        // Re-acquire HEAPU8 after potential WASM memory growth
        const heap = () => M.HEAPU8 ?? new Uint8Array(M.wasmMemory.buffer);

        super({
            async start(controller) {
                // ── Load singleton WASM module ───────────────────────────────
                const { loadZstdModule } = await import('./zstd-bridge.js');
                M = await loadZstdModule();

                // ── Validate output buffer vs ZSTD_compressBound ─────────────
                const minOut = M._get_out_buffer_size(inBufSize);
                if (outBufSize < minOut) {
                    controller.error(new Error(
                        `outputBufferSize (${outBufSize}) < ZSTD_compressBound(${inBufSize}) = ${minOut}`
                    ));
                    return;
                }

                // ── Allocate fixed input + output buffers in WASM heap ───────
                inPtr  = M._wasm_malloc(inBufSize);
                outPtr = M._wasm_malloc(outBufSize);
                if (!inPtr || !outPtr) {
                    controller.error(new Error('ZstdStreamTransformer: wasm_malloc failed'));
                    return;
                }

                // ── Create ZSTD_CStream ──────────────────────────────────────
                cstream = M._create_stream(level);
                if (!cstream) {
                    controller.error(new Error('ZstdStreamTransformer: ZSTD_createCStream failed'));
                }
            },

            transform(chunk, controller) {
                // Handle chunks larger than inBufSize by processing in slices
                let offset = 0;
                while (offset < chunk.byteLength) {
                    const slice    = chunk.subarray(offset, offset + inBufSize);
                    const sliceLen = slice.byteLength;
                    offset        += sliceLen;

                    // ── 1 copy: JS heap → WASM linear memory ────────────────
                    heap().set(slice, inPtr);

                    // ── Compress synchronously inside WASM ───────────────────
                    const written = M._compress_chunk(
                        cstream, inPtr, sliceLen,
                        outPtr, outBufSize,
                        0  // ZSTD_e_continue
                    );
                    if (written < 0) {
                        controller.error(new Error('ZstdStreamTransformer: compress_chunk failed'));
                        return;
                    }

                    if (written > 0) {
                        // ── 1 copy: detach from WASM memory lifetime via slice ─
                        controller.enqueue(heap().slice(outPtr, outPtr + written));
                    }
                }
            },

            flush(controller) {
                // ── Final flush: drain all ZSTD internal buffers ────────────
                const written = M._compress_chunk(
                    cstream,
                    inPtr, 0,       // empty input
                    outPtr, outBufSize,
                    2               // ZSTD_e_end
                );

                if (written < 0) {
                    controller.error(new Error('ZstdStreamTransformer: final flush failed'));
                } else if (written > 0) {
                    controller.enqueue(heap().slice(outPtr, outPtr + written));
                }

                // ── Teardown: free all WASM resources ────────────────────────
                M._free_stream(cstream);
                M._wasm_free(inPtr);
                M._wasm_free(outPtr);
                cstream = inPtr = outPtr = M = null;
            }
        });
    }
}

export {
    ZipStreamTransformer,
    ZstdStreamTransformer,
    GzipStreamTransformer,
    DeflateStreamTransformer,
    DeflateRawStreamTransformer,
    BufferedStreamTransformer
};
