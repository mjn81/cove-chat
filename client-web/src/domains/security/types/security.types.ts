/** Passcode lock state reported by the desktop shell. Field names mirror the Go `LockStatus` JSON. */
export interface LockStatus {
	enabled: boolean;
	locked: boolean;
	/** Idle minutes before auto-lock; 0 means never. */
	auto_lock_minutes: number;
	/** False when the OS has no credential store and secrets only last until the app quits. */
	secure_storage: boolean;
}
