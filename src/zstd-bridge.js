let _module = null;

/**
 * Load and cache the zstd WASM bridge module (singleton).
 *
 * Returns the Emscripten module instance exposing:
 *   - HEAPU8           : live Uint8Array view of WASM linear memory
 *   - wasmMemory       : WebAssembly.Memory object
 *   - _wasm_malloc     : (size: number) => ptr
 *   - _wasm_free       : (ptr: number) => void
 *   - _get_out_buffer_size : (inChunkSize: number) => number
 *   - _create_stream   : (level: number) => ptr
 *   - _compress_chunk  : (cstream, src, srcSize, dst, dstCapacity, endOp) => number
 *   - _free_stream     : (cstream: number) => void
 */
export async function loadZstdModule() {
    if (_module) return _module;

    const { default: ZstdFactory } = await import('../wasm/zstd/zstd_bridge.js');

    _module = await ZstdFactory({
        // Redirect the .wasm binary lookup to the same wasm/ directory
        locateFile: (path) =>
            new URL(`../wasm/zstd/${path}`, import.meta.url).href
    });

    return _module;
}
