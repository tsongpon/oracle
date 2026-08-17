export interface FeedbackItem {
	id: string;
	from: string;
	fromColor: string;
	to: string;
	toName: string;
	submittedAt: string;
	cycle: string;
	status: 'submitted' | 'draft' | 'pending';
	excerpt: string;
	category: 'collaboration' | 'delivery' | 'leadership' | 'craft';
	rating: number;
}

export interface FeedbackCycle {
	id: string;
	name: string;
	dueDate: string;
	completed: number;
	total: number;
	status: 'active' | 'upcoming' | 'closed';
}

export interface Teammate {
	id: string;
	name: string;
	role: string;
	team: string;
	avatarColor: string;
	feedbackGiven: number;
	feedbackReceived: number;
}

const EXCERPTS = [
	'Avery consistently unblocks the team. Their RFC on the data layer saved us weeks of rework.',
	'Jordan raised the bar for design quality this cycle — the new component library is a game changer.',
	'Sam quietly absorbed the on-call rotation so the rest of us could ship. Much appreciated.',
	'Clear, calm communication during the incident retrospective. Helped us turn a tough page.',
	'Brought fresh ideas to the roadmap planning session and made space for quieter voices.'
];

const CATEGORIES: FeedbackItem['category'][] = ['collaboration', 'delivery', 'leadership', 'craft'];

const STATUSES: FeedbackItem['status'][] = ['submitted', 'submitted', 'draft', 'pending'];

function pick<T>(arr: T[], i: number): T {
	return arr[i % arr.length];
}

export const mockTeammates: Teammate[] = [
	{
		id: 'u_2',
		name: 'Jordan Patel',
		role: 'Product Designer',
		team: 'Design Systems',
		avatarColor: '#0ea5e9',
		feedbackGiven: 7,
		feedbackReceived: 12
	},
	{
		id: 'u_3',
		name: 'Sam Rivera',
		role: 'Senior Engineer',
		team: 'Platform',
		avatarColor: '#10b981',
		feedbackGiven: 9,
		feedbackReceived: 8
	},
	{
		id: 'u_4',
		name: 'Mia Okafor',
		role: 'Engineering Manager',
		team: 'Platform',
		avatarColor: '#f59e0b',
		feedbackGiven: 11,
		feedbackReceived: 15
	},
	{
		id: 'u_5',
		name: 'Leo Tanaka',
		role: 'Data Scientist',
		team: 'Insights',
		avatarColor: '#ec4899',
		feedbackGiven: 5,
		feedbackReceived: 6
	}
];

export const mockCycles: FeedbackCycle[] = [
	{
		id: 'c_2026h2',
		name: '2026 H2 360 Review',
		dueDate: 'Sep 30, 2026',
		completed: 4,
		total: 7,
		status: 'active'
	},
	{
		id: 'c_2027h1',
		name: '2027 H1 Peer Feedback',
		dueDate: 'Mar 15, 2027',
		completed: 0,
		total: 8,
		status: 'upcoming'
	},
	{
		id: 'c_2026h1',
		name: '2026 H1 360 Review',
		dueDate: 'Apr 4, 2026',
		completed: 8,
		total: 8,
		status: 'closed'
	}
];

export function buildRecentFeedback(currentUserName: string): FeedbackItem[] {
	const items: FeedbackItem[] = [];
	for (let i = 0; i < 5; i++) {
		const to = pick(mockTeammates, i + 1);
		items.push({
			id: `fb_${i + 1}`,
			from: currentUserName,
			fromColor: '#4f46e5',
			to: to.id,
			toName: to.name,
			submittedAt: ['2h ago', '1d ago', '3d ago', '5d ago', '1w ago'][i] ?? 'recently',
			cycle: '2026 H2 360 Review',
			status: pick(STATUSES, i),
			excerpt: pick(EXCERPTS, i),
			category: pick(CATEGORIES, i),
			rating: 4 + ((i + 1) % 2)
		});
	}
	return items;
}