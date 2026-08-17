<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { auth } from '$lib/auth.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>360 Feedback</title>
</svelte:head>

<svelte:window
	onstorage={(e) => (e.key === 'oracle.token' || e.key === 'oracle.user') && auth.hydrate()}
/>

{@render children()}