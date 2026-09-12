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

        const clean = path === "/" ? [] : path.split("/").filter(Boolean);
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

        path = path || "/";
        const clean = path === "/" ? [] : path.split("/").filter(Boolean);

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

        path = path || "/";
        const clean = path === "/" ? [] : path.split("/").filter(Boolean);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p, { create: true });
        }
        return dir;
    }

    async rmdir(path, options = {}) {
        const root = await navigator.storage.getDirectory();

        path = path || "/";
        const clean = path === "/" ? [] : path.split("/").filter(Boolean);

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

    // Utilities
    async _getDirectoryHandle(path, options) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        path = path || "/";
        const clean = path === "/" ? [] : path.split("/").filter(Boolean);

        for (const p of clean) {
            dir = await dir.getDirectoryHandle(p);
        }
        return dir;
    }

    async _getFileHandle(path, options) {
        const root = await navigator.storage.getDirectory();
        let dir = root;

        path = path || "/";
        const clean = path === "/" ? [] : path.split("/").filter(Boolean);
        
        let file;
        for (let i = 0; i < clean.length; i++) {
            let p = clean[i];
            if(i === clean.length - 1) {
                file = await dir.getFileHandle(p, options);
            } else {
                dir = await dir.getDirectoryHandle(p, options);
            }
        }
        return file;
    }
}
