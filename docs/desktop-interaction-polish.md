# Desktop interaction polish

The owned `shell-composer-20261108` task starts from signed v0.0.18 main `b9856e85cc9f721f011ac10d41daa4ed3c2b52c9`. It includes the user's subsequent playlist, Focus/Media separation, Escape and Familiar rail requests. The embedded Coven computer agent remains an independently owned implementation in `open-sesame-computer-agent`; this UI update does not claim that unfinished engine integration is delivered.

## Shell input

In Console → Shells, the bottom bar targets the selected local or SSH PTY. Its placeholder, accessible label, intent icon and send action identify the shell. Ordinary text, calculations, links, absolute paths, bang history and natural-language-looking shell commands remain shell input. Spaces and quoting are preserved; line endings are converted to terminal returns and Send adds a final return. Enter sends, Shift Enter inserts a line, and the expanded editor uses Command/Control Enter. Tab completion and shell history remain available in the terminal surface.

Explicit reserved slash commands such as `/note`, `/projects` and `/agent` retain their application meaning. A lone `/` opens the command menu. A disconnected, opening, absent or external web terminal never falls through to note creation or an agent. Web terminals accept input within their own embedded surface. Sending binds the selected pane and its unique live backend session before the request; changed or reconnected targets are refused. A pending acknowledgement cannot clear a different pane or newly edited draft, and repeated sends are suppressed while one is pending.

Each pane keeps a separate local draft. The ordinary capture draft and attachment metadata are restored on leaving Shells or opening the launcher. No new command-history log is created. Drafts use the existing application's local storage boundary; successful input is removed only after acknowledgement. Existing text already typed directly in the terminal remains part of that terminal's input line. The PTY connection waits briefly for layout, with a 100 ms fallback when background WebKit paint callbacks are suspended; a hidden widget can no longer remain indefinitely in Opening before its backend request.

## Focus and Media

Focus now owns Agenda and Calendar directly. The separate Media activity contains Music, YouTube and Local media, remembers its last tab independently and migrates the previous saved playback choice. Existing `/music`, `/youtube` and `/media` links keep their specific destinations; `/entertainment` opens the dedicated Media activity. Spotify account entry uses the new Media activity. Changing views does not remount players, restart the timer or replace terminal sessions.

The timer uses one compact view/duration toolbar, a flat countdown surface, readable topic rows and a consistent primary action. Wide widgets place the session agenda beside the timer rather than stacking everything below a very large clock. Small layouts keep the two-column clock/topic arrangement and compact controls. Existing running-session edit guards, duration allocation and local calendar behavior remain.

## Playlists

YouTube, YouTube Music and local Media share rail spacing, search, text hierarchy, current-item selection, control sizing and pagination. YouTube's sort control sits in the header, leaving the search field the full rail width; the menu is anchored to that header. Title wrapping, channel/date metadata, keyboard reorder controls and accessible search remain. Page capacity reads the actual flex-list space and shared row size, with stable footer reservation. A small player opens its playlist over the entire widget content, keeping native WKWebView content behind the sheet. The sheet owns focus, temporarily makes its sibling panes inert, restores their previous state on close and uses tighter controls at very short heights. Its own close action and Escape return to the player; no toolbar or capture footer can squeeze the episode list to zero height.

## Escape and Familiar rail

Escape dismisses an active local menu, dialog, link editor or expanded capture editor first, then collapses the focused widget, including its input and terminal surfaces. The trusted native panel forwards Escape from embedded provider WKWebViews to the same application dismissal stack; native sheets, modal authentication and display menus retain their own event handling. Collapse preserves drafts, running PTYs, playback and capture. Modified Escape and composition events are left alone. Escape is never a shortcut for quitting other applications.

The Familiar rail defaults to approximately 20 percent less width, with its larger portraits preserved. Its discreet separator supports scaled pointer dragging, drag-to-collapse and drag-to-reopen, keyboard arrows, Home to close, End to widen, Enter/Space to toggle and double-click to restore the default. Width is remembered locally, clamped to leave conversation space and restored after a temporarily smaller display. Escape, pointer cancellation, focus loss or a view change cancels an in-progress resize.

## Evidence boundaries

Focused JavaScript regressions exercise routing, exact PTY identity/bytes, draft and acknowledgement races, independent navigation, measured playlist capacity, Escape ownership and rail pointer/keyboard behavior with synthetic transports. The unified Mac suite separately exercises real PTYs, origin restrictions, process cleanup, local OCR, native authentication and compilation/signature checks. The isolated Safari fixture contains no live provider, account, capture or shell. Exact source identities, original failures, hosted checks, visual observations, packaging and installed acceptance belong to the common-Git receipt, not an inferred pass from compilation.
