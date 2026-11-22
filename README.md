# `@rushike/myfs`

A unified filesystem abstraction with support for OPFS, Local File System, and FTP.

## Overview
- **URI Based Approach**: Access any configured file system via a URI prefix (e.g., `opfs://path/to/file`, `file:///local/path`, `ftp://host/file`).
- **Standard FS APIs**: `mkdir`, `rmdir`, `readFile`, `writeFile`, `listdir`, `dirtree`, `copy`, `move`.
- **Advanced Features**: Native streaming downloads with selectable ZIP, gzip, DEFLATE, and Zstandard formats.

---

## API Examples

### Initialization
```javascript
import MyFS from '@rushike/myfs';

// Configuration for providers if needed (e.g. ftp credentials)
const myfs = new MyFS({
    opfs: {},
    file: {},
    ftp: {}
});
```

### Basic File Operations
```javascript
// Write to a file in OPFS
await myfs.writeFile("opfs:///workspace/notes.txt", "Hello World");

// Read a file back
const fileBlob = await myfs.readFile("opfs:///workspace/notes.txt");
const text = await fileBlob.text();

// List directory contents
const list = await myfs.listdir("opfs:///workspace");
console.log(list); 
// Output: [{ name: "notes.txt", type: "file", path: "/workspace/notes.txt" }]
```

### Copy and Move
```javascript
// Copy a file 
await myfs.copy("opfs:///workspace/notes.txt", "opfs:///workspace/notes_backup.txt");

// Move (rename) a file
await myfs.move("opfs:///workspace/notes.txt", "opfs:///workspace/important_notes.txt");
```

---

## Download Functionality & Streaming

`myfs` includes a powerful `download(uri)` API designed specifically to handle large files and directories efficiently without blowing up browser memory limits.

### How it works
- **Single File**: Returns `{ stream, name, type: "file" }`. The stream is either raw or compressed according to `options.format`.
- **Directory**: Returns a streamed archive. ZIP is the default. Zstandard is implemented by creating a streamed ZIP archive and then compressing that archive to `.zip.zst`.

### Download formats

Pass `format` explicitly to `myfs.download(uri, { format })`. Supported values are:

| `format` | File extension | Behavior |
|---|---|---|
| `raw` | unchanged | Streams the original file; used for files by default |
| `zip` | `.zip` | Streams the file or directory as a ZIP archive |
| `gzip` | `.gz` | Compresses a file with gzip |
| `deflate` | `.zz` | Compresses a file with zlib-wrapped DEFLATE |
| `deflate-raw` | `.deflate` | Compresses a file with raw DEFLATE |
| `zstd` | `.zst` for files; `.zip.zst` for directories | Compresses through the bundled Zstandard WASM bridge |

Directories default to ZIP. Files default to raw unless a format is supplied explicitly.

```javascript
const zip = await myfs.download("opfs:///reports", { format: "zip" });
const gzip = await myfs.download("opfs:///reports.csv", { format: "gzip" });
const zstd = await myfs.download("opfs:///reports.csv", { format: "zstd" });
```

The Zstandard implementation uses `ZstdStreamTransformer` from `src/compress.js` and loads the singleton WASM module through `src/zstd-bridge.js`.

Existing compressed files are not double-compressed: selecting a matching format for a `.zip`, `.gz`/`.gzip`, `.zst`, `.zz`, or `.deflate` file preserves its original name and streams the original bytes unchanged.

### Zstandard artifacts

The source bridge is maintained in `c/my-std-bridge/`. Its compiled `zstd_bridge.js` and `zstd_bridge.wasm` files are synchronized into `js/packages/myfs/wasm/zstd/` by:

```bash
./doit zstd_bridge
```

The package loader imports this synchronized WASM directory at runtime and caches the Emscripten module across downloads.

### Limitations (Backpressure)
The OPFS implementation reads files and pushes chunks into the compression stream synchronously. If the stream consumer (e.g., a slow network upload pipeline) is much slower than the OPFS disk read speed, the internal stream buffer could build up, negating the memory-saving benefits. 

However, for local disk-to-disk streaming (using standard browser save functionality), it is highly efficient as local disk write speeds keep pace with OPFS read speeds.

### Using Download in UI (Modern browsers)
To securely and efficiently download a stream to the user's local disk without keeping the whole file in RAM, use the File System Access API:

```javascript
const { stream, name } = await myfs.download("opfs:///my-large-folder");

// Modern Browser Streaming to Disk
const handle = await window.showSaveFilePicker({ suggestedName: name });
const writable = await handle.createWritable();
await stream.pipeTo(writable);
```

---

## Downloading a file from the Browser Console

If you are debugging and want to quickly trigger a download from your browser console by providing a path, you can use the following snippet. 

> **Note**: This snippet uses the `Blob` fallback which will load the *entire* stream into memory. It is strictly meant for smaller debugging tasks rather than gigabytes of data.

```javascript
// Ensure myfs is exposed to the window object in your app:
// window.myfs = new MyFS();

async function downloadFromConsole(path) {
  const { stream, name } = await window.myfs.download(path);
  
  console.log(`Downloading ${name}, please wait...`);
  
  // Read the stream into a Blob
  const response = new Response(stream);
  const blob = await response.blob();
  
  // Create object URL and trigger click
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  
  // Cleanup
  URL.revokeObjectURL(url);
  console.log(`Successfully downloaded ${name}`);
}

// Example usage:
// downloadFromConsole("opfs:///my/test/folder");
```
