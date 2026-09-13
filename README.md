# `@rushike/myfs`

A unified filesystem abstraction with support for OPFS, Local File System, and FTP.

## Overview
- **URI Based Approach**: Access any configured file system via a URI prefix (e.g., `opfs://path/to/file`, `file:///local/path`, `ftp://host/file`).
- **Standard FS APIs**: `mkdir`, `rmdir`, `readFile`, `writeFile`, `listdir`, `dirtree`, `copy`, `move`.
- **Advanced Features**: Native streaming downloads with automatic on-the-fly zip compression for directories.

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
- **Single File**: Returns `{ stream, name, type: "file" }` wrapping the raw file stream.
- **Directory**: Returns `{ stream, name: "folderName.zip", type: "directory" }`. It recursively traverses the folder, reads files in 64KB chunks, and compresses them on-the-fly using `fflate` directly into the output `ReadableStream`.

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
