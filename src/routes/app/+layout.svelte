<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { children } = $props();

	let menuOpen = $state(false);

	const navItems = [
		{ href: '/app', label: 'Dashboard', icon: 'home' },
		{ href: '/app/feedback', label: 'My Feedback', icon: 'inbox' },
		{ href: '/app/team', label: 'Team', icon: 'team' },
		{ href: '/app/cycles', label: 'Cycles', icon: 'cycle' },
		{ href: '/app/reports', label: 'Reports', icon: 'chart' }
	];

	onMount(() => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
		}
	});

	async function handleLogout() {
		await auth.logout();
		await goto('/login', { replaceState: true });
	}

	function initials(name: string) {
		return name
			.split(' ')
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	// Derive a stable avatar color from the employee id (Employee has no
	// avatarColor field, unlike the old mock User type).
	const AVATAR_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
	function colorFor(id: string) {
		let hash = 0;
		for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
		return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
	}
</script>

{#if auth.isAuthenticated && auth.user}
	<div class="app-shell">
		<aside class="sidebar" class:open={menuOpen}>
			<div class="sidebar-head">
				<div class="brand-mark" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 28 28" fill="none">
						<circle cx="14" cy="14" r="13" stroke="white" stroke-width="1.5" opacity="0.45" />
						<circle cx="14" cy="14" r="8" stroke="white" stroke-width="1.5" opacity="0.7" />
						<circle cx="14" cy="14" r="3" fill="white" />
					</svg>
				</div>
				<div class="brand-text">
					<div class="brand-name">360 Feedback</div>
					<div class="brand-sub">Workspace</div>
				</div>
			</div>

			<nav class="nav">
				{#each navItems as item}
					<a
						href={item.href}
						class="nav-item"
						class:active={item.href === '/app'}
						onclick={() => (menuOpen = false)}
					>
						<span class="nav-icon" aria-hidden="true">
							{#if item.icon === 'home'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path d="M3 11.5L12 4l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
								</svg>
							{:else if item.icon === 'inbox'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path d="M4 13h4l2 3h4l2-3h4M4 13v6a1 1 0 001 1h14a1 1 0 001-1v-6M4 13l2-7h12l2 7" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
								</svg>
							{:else if item.icon === 'team'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/>
									<path d="M3 20c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
									<circle cx="17" cy="9" r="2.4" stroke="currentColor" stroke-width="1.6"/>
									<path d="M16 14.5c2.5 0 5 1.4 5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
								</svg>
							{:else if item.icon === 'cycle'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path d="M20 12a8 8 0 11-2.3-5.6M20 4v3.5h-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
							{:else if item.icon === 'chart'}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
									<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
								</svg>
							{/if}
						</span>
						<span class="nav-label">{item.label}</span>
					</a>
				{/each}
			</nav>

			<div class="sidebar-foot">
				<div class="user-card">
					<div class="avatar" style="background:{colorFor(auth.user.id)}">
						{initials(auth.user.name)}
					</div>
					<div class="user-meta">
						<div class="user-name">{auth.user.name}</div>
						<div class="user-role">{auth.user.title}</div>
					</div>
					<button
						class="logout-btn"
						onclick={handleLogout}
						aria-label="Sign out"
						title="Sign out"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
							<path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</button>
				</div>
			</div>
		</aside>

		{#if menuOpen}
			<button class="scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
		{/if}

		<div class="main">
			<header class="topbar">
				<button class="menu-btn" onclick={() => (menuOpen = true)} aria-label="Open menu">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
						<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
					</svg>
				</button>
				<div class="topbar-title">Dashboard</div>
				<div class="topbar-spacer"></div>
				<button class="btn btn-primary" onclick={() => goto('/app/feedback/new')}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
					New feedback
				</button>
			</header>

			<main class="content">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	<div class="loading-shell">
		<div class="spinner-lg" aria-label="Loading"></div>
	</div>
{/if}

<style>
	.app-shell {
		display: grid;
		grid-template-columns: 256px 1fr;
		min-height: 100vh;
		background: var(--color-bg);
	}

	/* Sidebar */
	.sidebar {
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		padding: var(--space-5) var(--space-4);
		position: sticky;
		top: 0;
		height: 100vh;
		gap: var(--space-4);
	}

	.sidebar-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
	}

	.brand-mark {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: linear-gradient(135deg, #6366f1, #4338ca);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.brand-name {
		font-size: 15px;
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.2;
	}

	.brand-sub {
		font-size: 11px;
		color: var(--color-text-subtle);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		overflow-y: auto;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: 14px;
		font-weight: 500;
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.nav-item:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.nav-item.active {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		font-weight: 600;
	}

	.nav-icon {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
	}

	.sidebar-foot {
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.user-card {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2);
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.user-meta {
		flex: 1;
		min-width: 0;
	}

	.user-name {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-role {
		font-size: 11px;
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.logout-btn {
		background: transparent;
		border: none;
		color: var(--color-text-subtle);
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		transition:
			background var(--transition-fast),
			color var(--transition-fast);
	}

	.logout-btn:hover {
		background: var(--color-surface-2);
		color: var(--color-danger);
	}

	/* Main */
	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.topbar {
		height: 64px;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: saturate(180%) blur(12px);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 0 var(--space-6);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.topbar-title {
		font-size: 16px;
		font-weight: 600;
	}

	.topbar-spacer {
		flex: 1;
	}

	.menu-btn {
		display: none;
		background: transparent;
		border: none;
		color: var(--color-text);
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		place-items: center;
	}

	.content {
		padding: var(--space-8);
		flex: 1;
		max-width: 1280px;
		width: 100%;
		margin: 0 auto;
	}

	.scrim {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		z-index: 30;
		border: none;
	}

	.loading-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.spinner-lg {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 860px) {
		.app-shell {
			grid-template-columns: 1fr;
		}

		.sidebar {
			position: fixed;
			left: 0;
			top: 0;
			z-index: 40;
			width: 280px;
			transform: translateX(-100%);
			transition: transform var(--transition);
			box-shadow: var(--shadow-lg);
		}

		.sidebar.open {
			transform: translateX(0);
		}

		.menu-btn {
			display: grid;
		}

		.scrim {
			display: block;
		}

		.content {
			padding: var(--space-5);
		}
	}
</style>