import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const backendUrl = process.env.SPATIA_BACKEND_URL || 'http://localhost:8085';
export default defineConfig({ plugins: [react()], server: { port: 5173, proxy: { '/api': backendUrl } } });
