/**
 * API client for the 360 Feedback backend auth endpoints.
 *
 * Spec: see docs/login-api.md
 * Base URL is configurable via VITE_API_BASE_URL.
 * - Empty/unset  -> same-origin requests (use the Vite dev proxy in dev,
 *                   see vite.config.ts -> server.proxy['/v1']).
 * - Set to e.g. 'http://localhost:1323' to call the backend directly
 *   (requires CORS on the backend, see spec §11.3).
 * All endpoints are prefixed with `/v1`.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_PREFIX = '/v1';

// --- Types (drop-in from spec §9) ---

export type Role = 'org_admin' | 'user';

export interface Employee {
	id: string;
	name: string;
	organization_name: string;
	role: Role;
	manager_id: string | null;
	title: string;
	email: string;
	is_mail_verified: boolean;
	created_at: string; // ISO 8601
	updated_at: string; // ISO 8601
}

export interface LoginRequest {
	email: string;
	password: string;
}

export interface LoginResponse {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number; // seconds
	employee: Employee;
}

export interface RegisterRequest {
	name: string;
	organization_name: string;
	manager_id?: string | null;
	title?: string;
	email: string;
	password: string;
	invite_token?: string;
}

export interface CreateInvitationRequest {
	organization_name: string;
}

export interface InvitationResponse {
	token: string;
	id: string;
	created_by: string;
	organization_name: string;
	created_at: string; // ISO 8601
	expires_at: string; // ISO 8601
}

export interface ApiError {
	message: string;
}

// --- Feedback domain types (drop-in from OpenAPI §components/schemas) ---

export type FeedbackVisibility = 'anonymous' | 'named';

export interface FeedbackPeriod {
	id: string;
	name: string;
	organization_name: string;
	start_date: string; // ISO 8601
	end_date: string; // ISO 8601
	created_at: string;
	updated_at: string;
}

export interface FeedbackPeriodListResponse {
	periods: FeedbackPeriod[];
}

export interface CreateFeedbackPeriodRequest {
	name: string;
	start_date: string; // ISO 8601
	end_date: string; // ISO 8601
}

export interface EmployeeListResponse {
	employees: Employee[];
	next_cursor: string | null;
}

export interface CreateFeedbackRequest {
	period_id: string;
	reviewee_id: string;
	communication_score: number;
	leadership_score: number;
	technical_score: number;
	collaboration_score: number;
	delivery_score: number;
	trust_score: number;
	strengths_comment?: string;
	weaknesses_comment?: string;
	visibility?: FeedbackVisibility;
}

export interface FeedbackResponse {
	id: string;
	period_id: string;
	reviewee_id: string;
	reviewer_id: string;
	communication_score: number;
	leadership_score: number;
	technical_score: number;
	collaboration_score: number;
	delivery_score: number;
	trust_score: number;
	strengths_comment: string;
	weaknesses_comment: string;
	visibility: FeedbackVisibility;
	created_at: string;
	updated_at: string;
}

export interface FeedbackListResponse {
	feedbacks: FeedbackResponse[];
	next_cursor: string | null;
}

// --- Error model ---

export type AuthErrorCode =
	| 'invalid_credentials' // 401 on /login
	| 'email_not_verified' // 403 on /login
	| 'email_taken' // 409 on /register
	| 'bad_request' // 400 (validation / malformed)
	| 'unauthorized' // 401 from /v1/me
	| 'forbidden' // 403 (not an org admin, etc.)
	| 'employee_not_found' // 404 from /v1/me
	| 'network' // fetch threw
	| 'server' // 5xx
	| 'unknown';

export class ApiClientError extends Error {
	constructor(
		message: string,
		public status: number,
		public code: AuthErrorCode
	) {
		super(message);
		this.name = 'ApiClientError';
	}
}

// Backwards-compat alias so existing imports keep working if anything still
// references the old class name.
export const AuthError = ApiClientError;

// --- Low-level fetch helper ---

async function request<T>(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		token?: string | null;
	} = {}
): Promise<T> {
	const { method = 'GET', body, token } = options;
	const url = `${API_BASE_URL}${API_PREFIX}${path}`;
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (token) headers.Authorization = `Bearer ${token}`;

	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
	} catch (err) {
		throw new ApiClientError(
			'Could not reach the server. Check your connection and try again.',
			0,
			'network'
		);
	}

	if (res.status === 204) return undefined as T;

	let parsed: unknown = null;
	const text = await res.text();
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			// fall through; handled below
		}
	}

	if (!res.ok) {
		const message =
			(parsed && typeof parsed === 'object' && 'message' in parsed
				? String((parsed as { message: unknown }).message)
				: undefined) ?? fallbackMessage(res.status, path);

		if (res.status === 400) {
			throw new ApiClientError(message, 400, 'bad_request');
		}
		if (res.status === 401 && path === '/login') {
			throw new ApiClientError(message, 401, 'invalid_credentials');
		}
		if (res.status === 401) {
			throw new ApiClientError(message, 401, 'unauthorized');
		}
		if (res.status === 403 && path === '/login') {
			throw new ApiClientError(message, 403, 'email_not_verified');
		}
		if (res.status === 403) {
			throw new ApiClientError(message, 403, 'forbidden');
		}
		if (res.status === 409 && path === '/register') {
			throw new ApiClientError(message, 409, 'email_taken');
		}
		if (res.status === 404 && path === '/me') {
			throw new ApiClientError(message, 404, 'employee_not_found');
		}
		if (res.status >= 500) {
			throw new ApiClientError(message, res.status, 'server');
		}
		throw new ApiClientError(message, res.status, 'unknown');
	}

	return parsed as T;
}

function fallbackMessage(status: number, path: string): string {
	if (status === 401 && path === '/login') return 'Invalid email or password.';
	if (status === 403 && path === '/login') return 'Email not verified.';
	if (status === 409 && path === '/register') return 'email already taken';
	if (status === 401) return 'Missing or invalid token.';
	if (status === 404) return 'Employee not found.';
	if (status === 400) return 'Invalid request body.';
	if (status >= 500) return 'Something went wrong. Please try again.';
	return `Request failed (HTTP ${status}).`;
}

// --- Public API endpoints ---

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
	return request<LoginResponse>('/login', { method: 'POST', body: credentials });
}

export async function getMe(token: string): Promise<Employee> {
	return request<Employee>('/me', { method: 'GET', token });
}

export async function register(payload: RegisterRequest): Promise<Employee> {
	return request<Employee>('/register', { method: 'POST', body: payload });
}

export async function createInvitation(
	token: string,
	payload: CreateInvitationRequest
): Promise<InvitationResponse> {
	return request<InvitationResponse>('/invitation', { method: 'POST', body: payload, token });
}

// --- Feedback endpoints ---

export async function listEmployees(
	token: string,
	options: { limit?: number; cursor?: string } = {}
): Promise<EmployeeListResponse> {
	const params = new URLSearchParams();
	if (options.limit != null) params.set('limit', String(options.limit));
	if (options.cursor) params.set('cursor', options.cursor);
	const qs = params.toString();
	return request<EmployeeListResponse>(`/employees${qs ? `?${qs}` : ''}`, {
		method: 'GET',
		token
	});
}

export async function listFeedbackPeriods(token: string): Promise<FeedbackPeriodListResponse> {
	return request<FeedbackPeriodListResponse>('/feedback-periods', { method: 'GET', token });
}

export async function createFeedbackPeriod(
	token: string,
	payload: CreateFeedbackPeriodRequest
): Promise<FeedbackPeriod> {
	return request<FeedbackPeriod>('/feedback-periods', { method: 'POST', body: payload, token });
}

export async function createFeedback(
	token: string,
	payload: CreateFeedbackRequest
): Promise<FeedbackResponse> {
	return request<FeedbackResponse>('/feedbacks', { method: 'POST', body: payload, token });
}

export async function listMyFeedbacks(
	token: string,
	options: { limit?: number; cursor?: string } = {}
): Promise<FeedbackListResponse> {
	const params = new URLSearchParams();
	if (options.limit != null) params.set('limit', String(options.limit));
	if (options.cursor) params.set('cursor', options.cursor);
	const qs = params.toString();
	return request<FeedbackListResponse>(`/me/feedbacks${qs ? `?${qs}` : ''}`, {
		method: 'GET',
		token
	});
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
	const url = `${API_BASE_URL}${API_PREFIX}/verify-email?token=${encodeURIComponent(token)}`;
	const res = await fetch(url, { headers: { Accept: 'application/json' } });
	const text = await res.text();
	let parsed: { message?: string } = {};
	try {
		parsed = text ? JSON.parse(text) : {};
	} catch {
		// ignore
	}
	if (!res.ok) {
		throw new ApiClientError(
			parsed.message ?? 'Invalid or expired verification token.',
			res.status,
			res.status === 400 ? 'bad_request' : 'unknown'
		);
	}
	return { message: parsed.message ?? 'email verified' };
}

// --- Session persistence (client-side) ---

const TOKEN_KEY = 'oracle.token';
const EXPIRY_KEY = 'oracle.tokenExpiresAt';
const USER_KEY = 'oracle.user';

export interface StoredSession {
	token: string;
	expiresAt: number; // epoch ms
	employee: Employee;
}

export function persistSession(login: LoginResponse): StoredSession {
	const session: StoredSession = {
		token: login.access_token,
		// Guard against server returning 0 / missing expires_in.
		expiresAt: Date.now() + Math.max(60, login.expires_in || 3600) * 1000,
		employee: login.employee
	};
	if (typeof localStorage === 'undefined') return session;
	localStorage.setItem(TOKEN_KEY, session.token);
	localStorage.setItem(EXPIRY_KEY, String(session.expiresAt));
	localStorage.setItem(USER_KEY, JSON.stringify(session.employee));
	return session;
}

export function clearSession(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(EXPIRY_KEY);
	localStorage.removeItem(USER_KEY);
}

export function readStoredToken(): string | null {
	if (typeof localStorage === 'undefined') return null;
	const token = localStorage.getItem(TOKEN_KEY);
	const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
	if (!token || !expiry || Date.now() >= expiry) {
		// expired — clean up to keep storage tidy
		if (token || expiry) clearSession();
		return null;
	}
	return token;
}

export function readStoredUser(): Employee | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(USER_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Employee;
	} catch {
		clearSession();
		return null;
	}
}