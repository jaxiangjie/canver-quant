import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || '.', '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // watch.ignored: data/ 是运行时数据目录（组合库/估值快照/行情 parquet）——
      // 服务端运行时写入这些文件会触发 watcher full-reload，把正在浏览的用户弹回主页
      // （2026-10-13 事故：诊断面板挂载 -> POST 组合库 -> 写 data/portfolios/*.json -> 整页 reload）。
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/data/**'] },
    },
  };
});
