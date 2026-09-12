export class LocalFileSystem {
    constructor(config = {}) {
        this.config = config;
    }

    async dirtree(path = "/") {
        throw new Error("Not implemented for local file system yet.");
    }

    async listdir(path) {
        throw new Error("Not implemented for local file system yet.");
    }

    async mkdir(path) {
        throw new Error("Not implemented for local file system yet.");
    }

    async rmdir(path, options = {}) {
        throw new Error("Not implemented for local file system yet.");
    }

    async readFile(path, options = {}) {
        throw new Error("Not implemented for local file system yet.");
    }

    async writeFile(path, data, options = {}) {
        throw new Error("Not implemented for local file system yet.");
    }
}
