import { browser } from '$app/environment';
import {
	login as apiLogin,
	getMe,
	clearSession,
	persistSession,
	readStoredToken,
	readStoredUser,
	ApiClientError,
	type Employee,
	type LoginRequest
} from './auth/auth';

export type { Employee, LoginRequest };

type AuthState =
	| { status: 'loading' }
	| { status: 'authenticated'; user: Employee }
	| { status: 'unauthenticated' };

let state = $state<AuthState>({ status: 'loading' });

async function hydrateFromStorage(): Promise<void> {
	if (!browser) return;
	const token = readStoredToken();
	if (!token) {
		state = { status: 'unauthenticated' };
		return;
	}

	// Optimistically render with the cached employee while we re-hydrate.
	const cached = readStoredUser();
	if (cached) {
		state = { status: 'authenticated', user: cached };
	}

	try {
		const fresh = await getMe(token);
		state = { status: 'authenticated', user: fresh };
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('oracle.user', JSON.stringify(fresh));
		}
	} catch (err) {
		if (err instanceof ApiClientError) {
			// 401: token invalid/expired. 404: account deleted. Either way: log out.
			if (err.code === 'unauthorized' || err.code === 'employee_not_found') {
				clearSession();
				state = { status: 'unauthenticated' };
				return;
			}
			// Network / 5xx: stay logged in using cached user, but mark unknown.
			// We keep the optimistic user so the UI is still usable offline-ish.
			if (cached) {
				state = { status: 'authenticated', user: cached };
				return;
			}
		}
		clearSession();
		state = { status: 'unauthenticated' };
	}
}

if (browser) {
	hydrateFromStorage();
	window.addEventListener('storage', (e) => {
		if (e.key === 'oracle.token' || e.key === 'oracle.user') {
			const token = readStoredToken();
			if (!token) {
				state = { status: 'unauthenticated' };
			} else {
				hydrateFromStorage();
			}
		}
	});
}

export const auth = {
	get state() {
		return state;
	},
	get user(): Employee | null {
		return state.status === 'authenticated' ? state.user : null;
	},
	get isAuthenticated(): boolean {
		return state.status === 'authenticated';
	},
	get isLoading(): boolean {
		return state.status === 'loading';
	},
	/** Bearer token for protected API calls, or null. */
	get token(): string | null {
		return readStoredToken();
	},
	/** Hydrate on demand (used on first navigation into a protected route). */
	async hydrate() {
		await hydrateFromStorage();
	},
	async login(credentials: LoginRequest) {
		const res = await apiLogin(credentials);
		persistSession(res);
		state = { status: 'authenticated', user: res.employee };
		return res.employee;
	},
	async logout() {
		clearSession();
		state = { status: 'unauthenticated' };
	}
};