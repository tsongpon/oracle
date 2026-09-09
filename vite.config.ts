import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// Load .env / .env.[mode] files so VITE_API_PROXY_TARGET is available at
	// config time. Vite auto-loads env vars only into import.meta.env for
	// client code; config-time access requires loadEnv explicitly.
	const env = loadEnv(mode, process.cwd(), '');

	return {
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
				// If your environment is not supported, or you settled on another environment, switch out the adapter.
				// See https://svelte.dev/docs/kit/adapters for a list.
				adapter: adapter()
			})
		],

		server: {
			proxy: {
				// Proxy the backend API through the dev server so the browser
				// makes same-origin requests (avoids CORS). The target is read
				// from .env files (VITE_API_PROXY_TARGET), falling back to the
				// local dev base URL.
				'/v1': {
					target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:1323',
					changeOrigin: true
				}
			}
		}
	};
});