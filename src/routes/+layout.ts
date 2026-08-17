import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ url }) => {
	if (url.pathname === '/') {
		throw redirect(307, '/login');
	}
};

export const ssr = false;
export const prerender = false;