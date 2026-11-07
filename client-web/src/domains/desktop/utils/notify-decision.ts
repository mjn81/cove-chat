/** Inputs for deciding how an incoming message from someone else is surfaced. */
export interface MessageNotifyInput {
	/** The conversation open in the main window, if any. */
	activeChannelId: string | undefined;
	messageChannelId: string;
	/** True while the desktop window is hidden in the tray. */
	windowHidden: boolean;
	pageVisible: boolean;
	pageFocused: boolean;
}

/** What to do with an incoming message. */
export interface MessageNotifyPlan {
	/** The user is looking at this conversation: mark it read instead of counting it as unread. */
	viewing: boolean;
	/** Show a notification popup. */
	showPopup: boolean;
}

/**
 * Decides whether an incoming message counts as seen and whether it gets a popup. A window hidden in the tray
 * shows nothing, so the conversation that was open before it was hidden must not suppress notifications: nobody
 * is looking at it.
 */
export function planMessageNotification(i: MessageNotifyInput): MessageNotifyPlan {
	const viewing = !i.windowHidden && i.activeChannelId === i.messageChannelId;
	const unseen = i.windowHidden || !i.pageVisible || !i.pageFocused;
	return { viewing, showPopup: !viewing && unseen };
}
