export class OpfsFileSystem {
    constructor(config = {}) {
        this.config = config;
    }

    async dirtree(path = "/") {
        const dirHandle = await this._getDirectoryHandle(path);
        const clean = this._parsePath(path);
        const dirName = clean.length ? clean[clean.length - 1] : "";
        const normalizedPath = path === "/" ? "/" : `/${clean.join("/")}`;

        async function buildTree(handle, name, currentPath) {
            const node = {
                name,
                type: "directory",
                path: currentPath,
                children: []
            };

            for await (const [childName, childHandle] of handle.entries()) {
                const childpath = currentPath === "/"
                    ? `/${childName}`
                    : `${currentPath}/${childName}`;

                if (childHandle.kind === "file") {
                    node.children.push({
                        name: childName,
                        type: "file",
                        path: childpath
                    });
                } else {
                    const subdir = await buildTree(childHandle, childName, childpath);
                    node.children.push(subdir);
                }
            }

            return node;
        }

        return buildTree(dirHandle, dirName, normalizedPath);
    }

    async listdir(path) {
        const dir = await this._getDirectoryHandle(path);

        const result = [];
        for await (const [name, handle] of dir.entries()) {
            const childpath = path === "/" ? `/${name}` : `${path}/${name}`;
            result.push({
                name,
                type: handle.kind,
                path: childpath
            });
        }

        result.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
        return result;
    }

    async mkdir(path) {
        return this._getDirectoryHandle(path, { create: true });
    }

    async rmdir(path, options = {}) {
        const clean = this._parsePath(path);

        if (clean.length === 0) {
            throw new Error("Cannot remove root directory");
        }

        const parentPath = clean.slice(0, -1).join("/");
        const dir = await this._getDirectoryHandle(parentPath || "/");
        const dirName = clean[clean.length - 1];

        await dir.removeEntry(dirName, { recursive: options.recursive !== false });
        return "ok";
    }

    async readFile(path, options = {}) {
        path = path.replace("opfs://", "");
        let fileHandle = await this._getFileHandle(path, options);
        return (await fileHandle.getFile()).stream();
    }

    async writeFile(path, data, options = {}) {
        path = path.replace("opfs://", "");
        let fileHandle = await this._getFileHandle(path, { ...options, create: true });

        const writable = await fileHandle.createWritable(options);
        await writable.write(data);
        await writable.close();

        return "ok";
    }

    /**
     * Walk a directory tree, calling `callback(dirpath, dirnames, filenames, dirHandle)`
     * for each directory — matching the Python `os.walk` signature (with an extra
     * dirHandle for callers that need direct OPFS access without re-resolving).
     *
     * @param {string} path       Root path to start walking from.
     * @param {Function} callback `async (dirpath, dirnames, filenames, dirHandle) => void`
     *   - dirpath   {string}                  Current directory path.
     *   - dirnames  {string[]}                Names of subdirectories in dirpath.
     *   - filenames {string[]}                Names of files in dirpath.
     *   - dirHandle {FileSystemDirectoryHandle} The OPFS handle for dirpath.
     */
    async walk(path, callback) {
        const dirHandle = await this._getDirectoryHandle(path);
        const clean = this._parsePath(path);
        const normalizedPath = (!path || path === "/") ? "/" : `/${clean.join("/")}`;

        async function _walk(handle, currentPath) {
            const dirnames = [];
            const filenames = [];
            const subdirs = [];

            for await (const [childName, childHandle] of handle.entries()) {
                if (childHandle.kind === "directory") {
                    dirnames.push(childName);
                    subdirs.push(childHandle);
                } else {
                    filenames.push(childName);
                }
            }

            await callback(currentPath, dirnames, filenames, handle);

            for (let i = 0; i < dirnames.length; i++) {
                const childPath = currentPath === "/"
                    ? `/${dirnames[i]}`
                    : `${currentPath}/${dirnames[i]}`;
                await _walk(subdirs[i], childPath);
            }
        }

        await _walk(dirHandle, normalizedPath);
    }

    async download(path) {
        path = path.replace("opfs://", "");

        const clean = this._parsePath(path);
        let handle, name;

        if (!path || path === "/") {
            handle = await this._getDirectoryHandle("/");
            name = "root";
        } else {
            const parentPath = clean.slice(0, -1).join("/");
            const parentDir = await this._getDirectoryHandle(parentPath || "/");
            name = clean[clean.length - 1];

            // Determine whether the target is a file or directory
            try {
                handle = await parentDir.getFileHandle(name);
            } catch {
                try {
                    handle = await parentDir.getDirectoryHandle(name);
                } catch {
                    throw new Error("File or directory not found: " + path);
                }
            }
        }

        if (handle.kind === "file") {
            const file = await handle.getFile();
            return {
                stream: file.stream(),
                name: file.name,
                type: "file"
            };
        } else {
            // Directory → stream as zip via OpfsReadableStream + ZipStreamTransformer
            const { ZipStreamTransformer } = await import('./compress.js');
            const normalizedRoot = (!path || path === "/") ? "/" : `/${clean.join("/")}`;

            const opfsStream = new OpfsReadableStream(this, normalizedRoot);
            const zipStream = opfsStream.pipeThrough(new ZipStreamTransformer());

            return {
                stream: zipStream,
                name: `${name}.zip`,
                type: "directory"
            };
        }
    }

    // ── Utilities ──────────────────────────────────────────────────────────

    /**
     * Parse a path string into segments, respecting escaped slashes (`\/`).
     *
     * Example:
     *   "/data/file\\/name.txt" → ["data", "file/name.txt"]
     *   "/a/b/c"               → ["a", "b", "c"]
     */
    _parsePath(path) {
        if (!path || path === "/") return [];
        path = path.replace("opfs://", "");

        // Split on unescaped '/' (a '/' NOT preceded by '\')
        // Strategy: replace escaped '\/' with a placeholder, split, restore.
        const placeholder = "\x00";
        const safe = path.replace(/\\\//g, placeholder);
        return safe.split("/").filter(Boolean).map(s => s.replaceAll(placeholder, "/"));
    }

    async _getDirectoryHandle(path, options = {}) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        const clean = this._parsePath(path);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p, options);
        }
        return dir;
    }

    async _getFileHandle(path, options = {}) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        const clean = this._parsePath(path);

        let file;
        for (let i = 0; i < clean.length; i++) {
            let p = clean[i];
            if (i === clean.length - 1) {
                file = await dir.getFileHandle(p, options);
            } else {
                dir = await dir.getDirectoryHandle(p, options);
            }
        }
        return file;
    }
}


/**
 * A ReadableStream that walks an OPFS directory tree and emits file entry
 * chunks following the OpfsStreamChunk protocol.
 *
 * Uses OpfsFileSystem.walk() internally for directory traversal.
 *
 * Output chunks:
 *   { type: "file-start", path: string }   — relative path inside the tree
 *   { type: "file-data",  data: Uint8Array }
 *   { type: "file-end" }
 */
export class OpfsReadableStream extends ReadableStream {
    /**
     * @param {OpfsFileSystem} opfs  OpfsFileSystem instance
     * @param {string} path          Root path to walk
     */
    constructor(opfs, path) {
        let started = false;

        super({
            async pull(controller) {
                if (started) return;
                started = true;

                try {
                    await opfs.walk(path, async (dirpath, _dirnames, filenames, dirHandle) => {
                        const relDir = dirpath === path
                            ? ""
                            : dirpath.slice(path.length).replace(/^\//, "");

                        for (const fname of filenames) {
                            const relPath = relDir ? `${relDir}/${fname}` : fname;

                            controller.enqueue({ type: "file-start", path: relPath });

                            const fileHandle = await dirHandle.getFileHandle(fname);
                            const file = await fileHandle.getFile();
                            const reader = file.stream().getReader();
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                controller.enqueue({ type: "file-data", data: value });
                            }

                            controller.enqueue({ type: "file-end" });
                        }
                    });
                    controller.close();
                } catch (err) {
                    controller.error(err);
                }
            }
        });
    }

    /**
     * Create an OpfsReadableStream from an OpfsFileSystem instance and path.
     *
     * @param {OpfsFileSystem} opfs
     * @param {string} path
     * @returns {OpfsReadableStream}
     */
    static from(opfs, path) {
        const clean = opfs._parsePath(path);
        const root = (!path || path === "/") ? "/" : `/${clean.join("/")}`;
        return new OpfsReadableStream(opfs, root);
    }
}