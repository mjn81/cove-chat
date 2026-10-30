/** One signed-in device, as returned by `GET /api/sessions`. Field names mirror the backend JSON. */
export interface SessionInfo {
	id: string;
	device_name: string;
	app_name: string;
	platform: string;
	ip: string;
	city?: string;
	country?: string;
	created_at: string;
	last_active_at: string;
	/** True for the session that made the request, i.e. "this device". */
	current: boolean;
}
