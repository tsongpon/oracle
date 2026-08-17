// App section is client-only because the mock auth session is stored in
// localStorage. A real backend would allow SSR with cookies.
export const ssr = false;
export const prerender = false;