import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// FIX: Import `process` to provide the correct types and resolve the error on `process.cwd()`.
import process from 'process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Expose the API_KEY to the app code
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  };
});
