export class FtpFileSystem {
    constructor(config = {}) {
        this.config = config;
    }

    async dirtree(path = "/") {
        throw new Error("Not implemented for FTP yet.");
    }

    async listdir(path) {
        throw new Error("Not implemented for FTP yet.");
    }

    async mkdir(path) {
        throw new Error("Not implemented for FTP yet.");
    }

    async rmdir(path, options = {}) {
        throw new Error("Not implemented for FTP yet.");
    }

    async readFile(path, options = {}) {
        throw new Error("Not implemented for FTP yet.");
    }

    async writeFile(path, data, options = {}) {
        throw new Error("Not implemented for FTP yet.");
    }
}
