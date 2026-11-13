import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'tsup';

// テスト用に src の各ファイルを tsup でエントリごとに ESM へ落とし、import して返す。
// 出力は build/ 以下の一時ディレクトリで、テストファイルの終わりに消す。
// @mapconductor/js-sdk-core は通常どおり node_modules から解決する（dist を使う）。
export async function buildSources(prefix, entries) {
    mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
    const outDir = mkdtempSync(fileURLToPath(new URL(`../build/${prefix}-`, import.meta.url)));
    after(() => rmSync(outDir, { recursive: true, force: true }));
    await build({
        entry: entries,
        outDir, format: ['esm'], platform: 'node', splitting: false,
        dts: false, sourcemap: false, config: false, silent: true,
        external: ['@mapconductor/js-sdk-core'],
    });
    const modules = {};
    for (const name of Object.keys(entries)) {
        modules[name] = await import(pathToFileURL(resolve(outDir, `${name}.mjs`)));
    }
    return modules;
}
