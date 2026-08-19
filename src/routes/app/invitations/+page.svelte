<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import {
		ApiClientError,
		createInvitation,
		type InvitationResponse
	} from '$lib/auth/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let submitting = $state(false);
	let formError = $state<string | null>(null);
	let invitation = $state<InvitationResponse | null>(null);
	let inviteLink = $state<string>('');
	let copied = $state(false);

	const organizationName = $derived(auth.user?.organization_name ?? '');

	onMount(async () => {
		if (!auth.isAuthenticated) {
			goto('/login', { replaceState: true });
			return;
		}
		// Re-hydrate so a stale cached user (e.g. role change) gets refreshed.
		await auth.hydrate();
		if (auth.user?.role !== 'org_admin') {
			goto('/app', { replaceState: true });
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;

		formError = null;
		invitation = null;
		inviteLink = '';
		copied = false;

		const token = auth.token;
		if (!token) {
			await auth.logout();
			goto('/login', { replaceState: true });
			return;
		}
		if (!organizationName) {
			formError = 'Could not determine your organization. Please reload or sign in again.';
			return;
		}

		submitting = true;
		try {
			const res = await createInvitation(token, { organization_name: organizationName });
			invitation = res;
			inviteLink = `${window.location.origin}/register?token=${encodeURIComponent(res.token)}`;
		} catch (err) {
			if (err instanceof ApiClientError) {
				switch (err.code) {
					case 'forbidden':
						// No longer an admin (or session stale).
						await auth.hydrate();
						if (auth.user?.role !== 'org_admin') {
							goto('/app', { replaceState: true });
							return;
						}
						formError = err.message || 'Only organization admins can create invitations.';
						break;
					case 'unauthorized':
						await auth.logout();
						goto('/login', { replaceState: true });
						return;
					case 'bad_request':
						formError =
							err.message && err.message !== 'invalid request body'
								? err.message
								: 'Please check your input and try again.';
						break;
					case 'network':
						formError = 'Could not reach the server. Check your connection and try again.';
						break;
					case 'server':
					case 'unknown':
					default:
						formError = 'Something went wrong. Please try again.';
						break;
				}
			} else {
				formError = 'Something went wrong. Please try again.';
			}
		} finally {
			submitting = false;
		}
	}

	async function copyLink() {
		if (!inviteLink) return;
		try {
			await navigator.clipboard.writeText(inviteLink);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Fallback: select-and-copy prompt
			window.prompt('Copy this link:', inviteLink);
		}
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}
</script>

<svelte:head>
	<title>Invitations · 360 Feedback</title>
</svelte:head>

<div class="page">
	<div class="page-head">
		<div class="page-head-text">
			<h1>Invitations</h1>
			<p class="page-sub">
				Generate a link that lets a teammate join your organization. Each link
				expires after 7 days and creates a regular <strong>user</strong> account
				(not an admin).
			</p>
		</div>
	</div>

	<div class="card form-card">
		<div class="form-head">
			<h2>Create invitation link</h2>
			<p>Invitees will join your organization and cannot change it.</p>
		</div>

		{#if formError}
			<div class="alert" role="alert">
				<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 6v5M10 14.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
				<span>{formError}</span>
			</div>
		{/if}

		<form onsubmit={handleSubmit} novalidate>
			<div class="field">
				<label class="field-label" for="organization_name">Organization</label>
				<input
					id="organization_name"
					class="input"
					type="text"
					value={organizationName}
					disabled
					readonly
				/>
				<span class="field-hint">Invitees join your organization. This cannot be changed.</span>
			</div>

			<div class="form-actions">
				<button type="submit" class="btn btn-primary" disabled={submitting || !organizationName}>
					{#if submitting}
						<span class="spinner" aria-hidden="true"></span>
						Generating…
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
							<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.5-1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
						Generate invitation link
					{/if}
				</button>
			</div>
		</form>
	</div>

	{#if invitation}
		<div class="card result-card">
			<div class="result-head">
				<div class="result-icon" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="11" fill="#e7f6ee" />
						<path d="M7 12.5l3.5 3.5L17 9" stroke="#0f9d58" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</div>
				<div>
					<h2>Invitation link ready</h2>
					<p>Share this link with your teammate. It expires on {formatDate(invitation.expires_at)}.</p>
				</div>
			</div>

			<div class="link-row">
				<input
					class="input link-input"
					type="text"
					value={inviteLink}
					readonly
					aria-label="Invitation link"
					onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<button type="button" class="btn btn-secondary" onclick={copyLink}>
					{#if copied}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
							<path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
						Copied
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
							<rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/>
							<path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
						</svg>
						Copy
					{/if}
				</button>
			</div>

			<dl class="result-meta">
				<div>
					<dt>Organization</dt>
					<dd>{invitation.organization_name}</dd>
				</div>
				<div>
					<dt>Expires</dt>
					<dd>{formatDate(invitation.expires_at)}</dd>
				</div>
				<div>
					<dt>Created</dt>
					<dd>{formatDate(invitation.created_at)}</dd>
				</div>
			</dl>

			<p class="result-note">
				Anyone with this link can register into your organization until it expires.
				Generate a new link any time — the old one stays valid until its expiry.
			</p>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
	}

	.page-head {
		margin-bottom: var(--space-6);
	}

	.page-head-text h1 {
		font-size: 26px;
		line-height: 1.2;
	}

	.page-sub {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 14px;
		max-width: 60ch;
	}

	.page-sub strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.card {
		padding: var(--space-6);
	}

	.form-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
	}

	.form-head h2 {
		font-size: 18px;
	}

	.form-head p {
		margin-top: var(--space-2);
		color: var(--color-text-muted);
		font-size: 13px;
	}

	.alert {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		background: var(--color-danger-soft);
		color: var(--color-danger);
		border: 1px solid #f8c7c2;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 13px;
		line-height: 1.45;
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 2px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.field-hint {
		font-size: 12px;
		color: var(--color-text-subtle);
	}

	.form-actions {
		display: flex;
		justify-content: flex-start;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.45);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.result-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		border-color: rgba(15, 157, 88, 0.3);
		background: #f6fbf8;
	}

	.result-head {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.result-icon {
		flex-shrink: 0;
	}

	.result-head h2 {
		font-size: 17px;
	}

	.result-head p {
		margin-top: var(--space-1);
		color: var(--color-text-muted);
		font-size: 13px;
		line-height: 1.5;
	}

	.link-row {
		display: flex;
		gap: var(--space-2);
		align-items: stretch;
	}

	.link-input {
		flex: 1;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12.5px;
		background: var(--color-surface);
	}

	.link-row .btn {
		flex-shrink: 0;
	}

	.result-meta {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
		margin: 0;
		padding: var(--space-4) 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.result-meta dt {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-subtle);
	}

	.result-meta dd {
		margin: var(--space-1) 0 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.result-note {
		font-size: 12px;
		color: var(--color-text-subtle);
		line-height: 1.55;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 560px) {
		.result-meta {
			grid-template-columns: 1fr;
			gap: var(--space-3);
		}
		.link-row {
			flex-direction: column;
		}
	}
</style>