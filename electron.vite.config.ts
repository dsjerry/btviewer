import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // 原生媒体二进制不能被打包进 bundle，只能作为静态资源随应用分发
    publicDir: resolve(__dirname, 'resources'),
    // fast-xml-parser 打进主进程包：electron-builder 只打包 release/app/**，不随包分发 node_modules，
    // 若把它留作 external，安装后的应用会因找不到模块而启动失败
    plugins: [externalizeDepsPlugin({ exclude: ['fast-xml-parser'] })],
    build: {
      outDir: resolve(__dirname, 'release/app/main'),
      emptyOutDir: true,
      // 内置媒体资源（ffmpeg/ffprobe）按 app.getAppPath()/resources 相对定位，随构建产物一起拷出
      copyPublicDir: true,
      lib: {
        entry: resolve(__dirname, 'electron/main.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, 'release/app/preload'),
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    build: {
      outDir: resolve(__dirname, 'release/app/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
})
