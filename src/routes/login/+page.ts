// Mock auth lives in localStorage (client-only). Login page must always be
// accessible, so we render it purely on the client.
export const ssr = false;
export const prerender = false;