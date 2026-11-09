import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './i18n/index'; // must be imported before the popup renders
import './index.css';
import './styles/emoji-font.css';
import { NotificationPopup } from './domains/desktop/components/notification-popup';

// Entry of popup.html: the page shown by the desktop app's notification popup window (see client-desktop).
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<NotificationPopup />
	</StrictMode>,
);
