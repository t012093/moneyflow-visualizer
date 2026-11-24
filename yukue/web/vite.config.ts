import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../data');
/** 画面が読むファイルの一覧（src/data/load.ts、scripts/sync-data.mjs と共通） */
const dataFiles = new Set<string>(
  Object.values(JSON.parse(readFileSync(resolve(here, 'src/data/files.json'), 'utf8')) as Record<string, string>)
);

/**
 * 開発サーバーでは、yukue/data のファイルをそのまま /data として返す。
 * 収集システムが JSON を書きかえたら、画面を読み込み直すだけで反映される。
 * build では、npm run sync-data が写した public/data が dist/data に入る。
 * どちらも、返すのは画面が読むファイル（src/data/files.json）だけ。
 */
function liveData(): Plugin {
  return {
    name: 'yukue-live-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path = '';
        try {
          path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        } catch {
          next();
          return;
        }
        const m = /^\/data\/(.+\.json)$/.exec(path);
        if (!m || !m[1] || !dataFiles.has(m[1])) {
          next();
          return;
        }
        const file = resolve(dataDir, m[1]);
        if (!file.startsWith(dataDir + sep)) {
          next();
          return;
        }
        try {
          if (!statSync(file).isFile()) {
            next();
            return;
          }
        } catch {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  // どのパスに置いても動くように、資産とデータは相対パスで参照する
  base: './',
  plugins: [react(), liveData()],
  build: {
    target: 'es2022',
    sourcemap: false
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' }
});
