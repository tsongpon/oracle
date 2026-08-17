// Registration flow is client-only (same as login). Register page must be
// reachable while logged out, and we don't auto-login on success.
export const ssr = false;
export const prerender = false;