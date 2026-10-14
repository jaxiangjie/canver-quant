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
      // 运行时数据目录（组合库/估值快照/行情 parquet/staging 缓存）不进 watcher。
      // ⚠️ 诚实备注（tribunal vite c1，2026-10-14）：本条规则最初的理由——"服务端写
      // data/ 触发 Vite full-reload"——经实证不成立（data/ 不在 Vite 模块图：无 src
      // 文件 import 它，watcher 事件只打 "[no modules matched]" 日志、不触达浏览器；
      // 2026-10-13「点持仓页弹回」事故的真因是面板挂载 effect，已在组件侧修复）。
      // 保留本规则是纵深防御：将来若有人 import data/ 进模块图、或 Vite 行为变化，
      // 数据写入仍不会炸出 reload；同时它确实省掉每分钟估值快照写入的 watcher 噪音。
      // 路径锚定到项目根的 data/（c2：name-anchored '**/data/**' 会把未来 src/data/、
      // public/data/ 之类误伤出 watcher）；data 根的事实来源是服务端各 writer
      // （persistence.ts / stagingData.ts / valuationStore 的 process.cwd() 基准），
      // 此处与之同基准（c3：不做第六份硬编码副本）。
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : { ignored: [path.resolve(import.meta.dirname || '.', 'data')] },
    },
  };
});
