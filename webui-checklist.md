Cove Web UI Checklist

Done Tasks

[x] Integrate react-resizable-panels for core 3-pane layout.

[x] Fix react-resizable-panels sizing dragging issues (updated primitive Separator UI).

[x] Configure TailwindCSS tokens to perfectly mimic Discord (e.g., #313338, #2b2d31).

[x] Migrate ChatArea.tsx styling and layout to TailwindCSS matching Discord's layout.

[x] Replace all UI Emojis with Lucide React Icons (Sidebar placeholders, NewConversationModal, Chat Area).

[x] Setup global Zustand state management (useStore.ts) to replace legacy Context APIs.

[x] Fix all Typescript build errors related to @/components/ui/ path mapping and aliases in Vite.

Pending Tasks

Right Sidebar

[ ] Rename the top label from "Cove Server" to "Cove Client".

[ ] Add Server Version tag (e.g. V1.0.0) by referencing a REST API from the Go backend.

[ ] Ensure the right sidebar UI is properly scrollable for overflowing Groups and Channels.

[ ] Add unread messages numerical counter to the right side of Groups / DMs.

[ ] "Find or start conversation" button padding expansion and click functionality.

[ ] Reconfigure "New conversation modal" for Direct Messages: Remove the "OK" button and replace with search bar featuring auto-dropdown; clicking a user immediately creates the DM.

[ ] Reconfigure + icon behaviour: The plus icon next to "Direct Messages" and "Channels" should automatically preload the exact channel type tab inside the New Conversation modal.

[ ] Add a connection indicator component indicating WebSockets state (Connecting / Connected / Disconnected).

[ ] Update online-status circle to overlay properly on the bottom left avatar circle.

[ ] Modify the "Settings" (Gear Icon) to open up an exact Settings Modal placeholder.

Core Architecture

[ ] Refactor WebSockets connection handler into a SharedWorker ensuring multiple browser tabs reuse the single websocket connection.

[ ] Migrate all core data events (except where REST makes sense, like file-uploads or initial sync) to flow through WebSockets.

[ ] Resolve any newly introduced TypeScript build errors (tsc).