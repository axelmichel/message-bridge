import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/index.ts'),
            name: 'MessageBridge',
            fileName: (format) => `message-bridge.${format}.js`,
            formats: ['iife'],
        },
        rollupOptions: {
            output: {
                globals: {
                    rxjs: 'rxjs',
                },
            },
            external: ['rxjs'], // optional: keep rxjs out of bundle
        },
        minify: 'terser',
        outDir: 'dist-lib',
        emptyOutDir: true,
    },
});