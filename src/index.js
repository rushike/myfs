import { OpfsFileSystem } from "./opfs.js";
import { LocalFileSystem } from "./local.js";
import { FtpFileSystem } from "./ftp.js";

export default class MyFS {

    constructor(config = {}) {
        this.providers = {
            opfs: new OpfsFileSystem(config.opfs),
            file: new LocalFileSystem(config.file),
            ftp: new FtpFileSystem(config.ftp),
        };
    }

    parse(uri) {
        const url = new URL(uri);

        const provider = url.protocol.slice(0, -1);

        return {
            provider,
            url,
            path: decodeURIComponent(url.pathname),
        };
    }

    getProvider(uri) {
        const { provider } = this.parse(uri);

        const fs = this.providers[provider];

        if (!fs) {
            throw new Error(`Unsupported filesystem: ${provider}`);
        }

        return fs;
    }

    _get(uri) {
        const parsed = this.parse(uri);

        const fs = this.providers[parsed.provider];

        if (!fs) {
            throw new Error(
                `Unsupported filesystem: ${parsed.provider}`
            );
        }

        return {
            fs,
            ...parsed
        };
    }

    async readFile(uri, options) {
        const { fs, path } = this._get(uri);

        return fs.readFile(path, options);
    }

    async writeFile(uri, data, options) {
        const { fs, path } = this._get(uri);

        return fs.writeFile(path, data, options);
    }

    async listdir(uri) {
        const { fs, path } = this._get(uri);

        return fs.listdir(path);
    }

    async mkdir(uri) {
        const { fs, path } = this._get(uri);

        return fs.mkdir(path);
    }

    async rmdir(uri, options) {
        const { fs, path } = this._get(uri);

        return fs.rmdir(path, options);
    }

    async dirtree(uri) {
        const { fs, path } = this._get(uri);

        return fs.dirtree(path);
    }

    async copy(sourceUri, destinationUri) {

        const source = this._get(sourceUri);
        const destination = this._get(destinationUri);

        const data = await source.fs.readFile(source.path);

        await destination.fs.writeFile(
            destination.path,
            data
        );
    }

    async move(sourceUri, destUri) {
        await this.copy(sourceUri, destUri);

        const source = this._get(sourceUri);

        await source.fs.rm(source.path);
    }
}