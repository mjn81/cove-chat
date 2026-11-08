// Hand-written declarations for the Go types in client-desktop/internal/popup (the Wails generator is not run
// in CI). `wails generate module` would emit models.ts instead; delete this file if you regenerate.
export namespace popup {
	export interface Item {
		id: string;
		title: string;
		body: string;
		subtitle?: string;
		avatar?: string;
		initial?: string;
		tone: number;
		system?: boolean;
		kind: string;
		channel_id?: string;
		tag?: string;
		theme: string;
		lang: string;
		tokens?: Record<string, string>;
		dir: string;
		corner?: string;
		ttl_ms: number;
	}
	export interface Request {
		title: string;
		body: string;
		subtitle: string;
		avatar: string;
		initial: string;
		tone: number;
		system: boolean;
		kind: string;
		channel_id: string;
		tag: string;
		theme: string;
		lang: string;
		tokens?: Record<string, string>;
		ttl_ms: number;
	}
}
