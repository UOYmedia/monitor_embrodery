import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

/**
 * Dev server. Ở bản build thật, giao diện được chính bridge phục vụ (`uiPath`) nên cùng origin và
 * không có CORS; chỉ lúc `npm run dev` mới có hai cổng khác nhau. Nên chỗ này bắc `/api` và `/ws`
 * sang bridge để **dev cũng cùng origin**, thay vì thêm `http://localhost:5173` vào
 * `allowedOrigins` của bridge — nới allowlist của bridge là nới một hàng rào thật, mà cái phải sửa
 * lại chỉ là chuyện tiện lợi khi lập trình.
 *
 * `BRIDGE_ORIGIN` (đọc từ `.env.local`, đã nằm trong .gitignore) để trỏ sang cổng khác khi 8787
 * bị tiến trình khác chiếm; mặc định vẫn là cổng trong `bridge.config.json`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BRIDGE_')
  const target = env.BRIDGE_ORIGIN || 'http://127.0.0.1:8787'

  return {
    plugins: [react()],
    test: {
      // Connector dùng node:test để kiểm thử đúng môi trường service Node thuần.
      exclude: [...configDefaults.exclude, 'connector-redthread/test/**'],
    },
    server: {
      // Đúng 5173, không cho nhảy cổng: xem ghi chú `_autoPort` trong .claude/launch.json.
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/ws': { target, ws: true },
      },
    },
  }
})
