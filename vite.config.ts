import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],

	server: {
		proxy: {
			// Proxy the backend API through the dev server so the browser makes
			// same-origin requests (avoids CORS — the backend does not send CORS
			// headers in dev; see Login API spec §11.3). Override the target by
			// setting VITE_API_PROXY_TARGET (defaults to the spec dev base URL).
			'/v1': {
				target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:1323',
				changeOrigin: true
			}
		}
	}
});
