export class OpfsFileSystem {
    constructor(config = {}) {
        this.config = config;
    }

    async dirtree(path = "/") {
        const root = await navigator.storage.getDirectory();

        async function walk(dirHandle, name, currentPath) {
            const node = {
                name,
                type: "directory",
                path: currentPath,
                children: []
            };

            for await (const [childName, childHandle] of dirHandle.entries()) {
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
                    const subdir = await walk(childHandle, childName, childpath);
                    node.children.push(subdir);
                }
            }

            return node;
        }

        const clean = this._parsePath(path);
        let start = root;
        for (const p of clean) {
            start = await start.getDirectoryHandle(p);
        }

        const dirName = clean.length ? clean[clean.length - 1] : "";
        return walk(start, dirName, path === "/" ? "/" : `/${clean.join("/")}`);
    }

    async listdir(path) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        const clean = this._parsePath(path);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p);
        }

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
        const root = await navigator.storage.getDirectory();
        let dir = root;

        const clean = this._parsePath(path);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p, { create: true });
        }
        return dir;
    }

    async rmdir(path, options = {}) {
        const root = await navigator.storage.getDirectory();

        const clean = this._parsePath(path);

        if (clean.length === 0) {
            throw new Error("Cannot remove root directory");
        }

        let dir = root;
        for (let i = 0; i < clean.length - 1; i++) {
            dir = await dir.getDirectoryHandle(clean[i]);
        }

        const dirName = clean[clean.length - 1];
        await dir.removeEntry(dirName, { recursive: options.recursive !== false });
        return "ok";
    }

    async readFile(path, options = {}) {
        path = path.replace("opfs://", "");
        let fileHandle = await this._getFileHandle(path, options);
        return fileHandle.getFile();
    }

    async writeFile(path, data, options = {}) {
        path = path.replace("opfs://", "");
        let fileHandle = await this._getFileHandle(path, { ...options, create: true });

        const writable = await fileHandle.createWritable(options);
        await writable.write(data);
        await writable.close();

        return "ok";
    }

    async download(path) {
        path = path.replace("opfs://", "");

        const root = await navigator.storage.getDirectory();
        let handle = root;
        let name = "root";

        if (path && path !== "/") {
            const clean = this._parsePath(path);
            const parentPath = clean.slice(0, -1).join("/");
            const dir = await this._getDirectoryHandle(parentPath);
            name = clean[clean.length - 1];

            let found = false;
            for await (const [childName, childHandle] of dir.entries()) {
                if (childName === name) {
                    handle = childHandle;
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new Error("File or directory not found: " + path);
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
            // It's a directory
            const { Zip, ZipDeflate } = await import('fflate');

            let zip;
            const stream = new ReadableStream({
                start(controller) {
                    zip = new Zip((err, data, final) => {
                        if (err) {
                            controller.error(err);
                        } else {
                            controller.enqueue(data);
                            if (final) {
                                controller.close();
                            }
                        }
                    });
                }
            });

            // Start pushing files into zip asynchronously
            (async () => {
                try {
                    async function walk(dirHandle, currentPath) {
                        for await (const [childName, childHandle] of dirHandle.entries()) {
                            const childpath = currentPath ? `${currentPath}/${childName}` : childName;
                            if (childHandle.kind === "file") {
                                const file = await childHandle.getFile();
                                const zipStream = new ZipDeflate(childpath);
                                zip.add(zipStream);

                                const reader = file.stream().getReader();
                                while (true) {
                                    const { done, value } = await reader.read();
                                    if (done) break;
                                    zipStream.push(value);
                                }
                                zipStream.push(new Uint8Array(0), true);
                            } else {
                                await walk(childHandle, childpath);
                            }
                        }
                    }
                    await walk(handle, "");
                    zip.end();
                } catch (err) {
                    console.error("Zip generation error:", err);
                }
            })();

            return {
                stream,
                name: `${name}.zip`,
                type: "directory"
            };
        }
    }

    // Utilities    
    _parsePath(path) {
        if (!path || path === "/") return [];
        return path.replace("opfs://", "").split("/").filter(Boolean);
    }

    async _getDirectoryHandle(path, options) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        const clean = this._parsePath(path);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p);
        }
        return dir;
    }

    async _getFileHandle(path, options) {
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
