// Atomic multi-file WhatsApp auth store with .bak fallback recovery.
import fs from 'node:fs';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto } from 'baileys';

const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-');

function tryParse(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return undefined;
    const value = JSON.parse(raw, BufferJSON.reviver);
    if (value === null || value === undefined) return undefined;
    return { raw, value };
  } catch {
    return undefined;
  }
}

/**
 * Drop-in replacement for Baileys' useMultiFileAuthState using synchronous
 * temp-write + flush + atomic rename and per-file .bak backups so process
 * restarts cannot leave 0-byte or truncated auth/key files behind.
 * @param {string} folder
 */
export async function useAtomicAuthState(folder) {
  if (fs.existsSync(folder)) {
    const info = fs.statSync(folder);
    if (!info.isDirectory()) {
      throw new Error(
        `found something that is not a directory at ${folder}, either delete it or specify a different location`,
      );
    }
  } else {
    fs.mkdirSync(folder, { recursive: true });
  }

  for (const name of fs.readdirSync(folder)) {
    const entryPath = path.join(folder, name);
    if (name.endsWith('.tmp')) {
      fs.rmSync(entryPath, { force: true });
    } else if (name.endsWith('.json') && fs.statSync(entryPath).size === 0) {
      const bakPath = `${entryPath}.bak`;
      const hasValidBak = fs.existsSync(bakPath) && fs.statSync(bakPath).size > 0;
      if (!hasValidBak) fs.unlinkSync(entryPath);
    }
  }

  const fileLocks = new Map();
  const inFlight = new Set();
  let seq = 0;

  function withFileLock(filePath, fn) {
    const prev = fileLocks.get(filePath) || Promise.resolve();
    const task = prev.then(fn, fn);
    const tail = task.catch(() => {});
    fileLocks.set(filePath, tail);
    inFlight.add(tail);
    tail.finally(() => {
      inFlight.delete(tail);
      if (fileLocks.get(filePath) === tail) fileLocks.delete(filePath);
    });
    return task;
  }

  function atomicWriteRaw(filePath, raw, { backupExisting = true } = {}) {
    const tmpPath = `${filePath}.${process.pid}.${++seq}.tmp`;
    try {
      fs.writeFileSync(tmpPath, raw, { encoding: 'utf8', flush: true });
      if (backupExisting && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        fs.copyFileSync(filePath, `${filePath}.bak`);
      }
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {}
      throw err;
    }
  }

  const pathFor = (file) => path.join(folder, fixFileName(file));

  const writeData = (data, file) => {
    const filePath = pathFor(file);
    const json = JSON.stringify(data, BufferJSON.replacer);
    return withFileLock(filePath, () => atomicWriteRaw(filePath, json));
  };

  const readData = (file) => {
    const filePath = pathFor(file);
    return withFileLock(filePath, () => {
      const primary = tryParse(filePath);
      if (primary !== undefined) return primary.value;

      const backup = tryParse(`${filePath}.bak`);
      if (backup !== undefined) {
        atomicWriteRaw(filePath, backup.raw, { backupExisting: false });
        return backup.value;
      }

      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      return null;
    });
  };

  const removeData = (file) => {
    const filePath = pathFor(file);
    return withFileLock(filePath, () => {
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}.bak`, { force: true });
    });
  };

  const flush = async () => {
    while (inFlight.size) {
      await Promise.allSettled([...inFlight]);
    }
  };

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value !== null && value !== undefined) data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds.json'),
    flush,
  };
}
