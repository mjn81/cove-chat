// Hand-written declarations for the Go types in client-desktop/internal/popup (the Wails generator is not run
// in CI). `wails generate module` would emit models.ts instead; delete this file if you regenerate.
export namespace popup {
	export interface Item {
		id: string;
		title: string;
		body: string;
		kind: string;
		channel_id?: string;
		tag?: string;
		theme: string;
		lang: string;
		dir: string;
		ttl_ms: number;
	}
	export interface Request {
		title: string;
		body: string;
		kind: string;
		channel_id: string;
		tag: string;
		theme: string;
		lang: string;
		ttl_ms: number;
	}
}
