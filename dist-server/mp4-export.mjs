import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function createMp4Exporter(dataDir, executable) {
  const folder = join(dataDir, 'exports');
  const pending = new Map();
  async function render(id) {
    const output = join(folder, id + '.mp4');
    if (existsSync(output)) return output;
    if (pending.has(id)) return pending.get(id);
    if (pending.size) throw new Error('Another video is exporting. Please try again shortly.');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temporary = join(folder, id + '.partial.mp4');
    rmSync(temporary, { force: true });
    const task = new Promise((resolve, reject) => {
      const child = spawn(executable, [join(dataDir, 'recordings', id + '.json'), temporary], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      const timeout = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
      child.on('error', reject);
      child.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0) return reject(new Error('Video export failed. Please try again.'));
        try { renameSync(temporary, output); resolve(output); } catch (error) { reject(error); }
      });
    }).finally(() => { pending.delete(id); rmSync(temporary, { force: true }); });
    pending.set(id, task);
    return task;
  }
  return async function download(req, res, id, recording) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid recording.');
    const path = await render(id);
    if (res.destroyed) return;
    const stamp = recording.createdAt.replace(/[^0-9T]/g, '').slice(0, 15);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="PressPlaySim-${stamp}.mp4"`, 'Cache-Control': 'no-store' });
    const stream = createReadStream(path);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}
