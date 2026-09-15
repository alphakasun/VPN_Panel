import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async read() { try { return JSON.parse(await readFile(this.file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async write(value) { await mkdir(dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
  async update(callback) {
    const operation = this.queue.then(async () => {
      const next = await callback((await this.read()) ?? { nodes: [], clients: [] });
      const result = next.result;
      delete next.result;
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      return result ?? next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
