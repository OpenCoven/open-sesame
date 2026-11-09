# Site feeds and iMessage controller

The private hosted studio includes site-feed creation and an interactive command tester. Live iMessage control runs on your Mac through the desktop companion. It is opt-in, is not connected by default, and requires the app to remain open. Provider credentials are never included in the website or source download.

## Site → RSS

In Reading, choose Add → Site → RSS and enter a blog or article-index URL. A bare domain assumes HTTPS. Open Sesame first accepts an existing RSS/Atom URL or discovers an advertised RSS/Atom feed. Otherwise it extracts same-origin article links, titles, available summaries, and available publication dates. Missing dates stay unknown. Expand Article selection to provide an optional CSS selector targeting article links. This override skips advertised-feed discovery.

The generated subscription lives in Reading and uses article URLs as stable identities. Read/later flags survive refresh. Select it under Feeds; Reading actions offers Pause/Resume and Download RSS. The export is a valid RSS 2.0 snapshot of retained entries, with a native Save dialog in the Mac app. It is not a public, continuously hosted RSS URL. Desktop checks site subscriptions every 15 minutes while open. Manual refresh is also available. Pausing excludes a feed from automatic/bulk refresh; an explicit `feed refresh` command can still refresh it.

Browser retrieval requires the publisher's CORS permission; the desktop helper can fetch public HTTP(S) pages with a 2 MB bound and verified TLS. JavaScript-only pages, signed-in pages, paywalls, or pages without article links need a published feed or another source. Open Sesame does not bypass those restrictions. This is a link-derived feed, not an invented full-text or publication-date service. Reading keeps at most 20 feeds and 200 entries on this device; exports reflect those retained entries.

## Commands

Open Reader → Options → iMessage controller. The tester applies commands to the current widget and explains failures. The same restricted parser handles provider messages.

| Command | Action |
| --- | --- |
| `feed add example.com/blog` | Discover or generate a site subscription |
| `feed follow example.com/rss.xml` | Follow an explicit RSS/Atom feed |
| `feeds` | List feeds and paused states |
| `feed pause Exact Feed Name` | Pause scheduled/bulk refresh |
| `feed resume Exact Feed Name` | Resume updates |
| `feed refresh https://example.com/blog` | Refresh one exact name, ID, or URL |
| `note A thought`, `task Review the draft` | Capture one Inbox item |
| `bookmark https://example.com` | Save one Inbox bookmark |
| `focus 25`, `focus pause` | Start/pause the current topic plan |
| `open reading` | Open Reading, Items, Agents, or Lockin |
| `size large` | Choose Small, Medium, Large, or Max |
| `status`, `help` | Inspect state or command help |

The optional prefix `open sesame` or `open sesame:` is accepted. Focus supports 15/20/25/30/45/60/90 minutes and respects topic limits. A running period must be paused before changing its duration. Commands do not launch shells, execute arbitrary code, operate VNC, delete data, or send messages to arbitrary recipients.

## BlueBubbles on the same Mac

1. Install/configure [BlueBubbles Server](https://docs.bluebubbles.app/server), with its required macOS permissions and Messages account, on the Mac running Open Sesame.
2. In Open Sesame's Connect iMessage disclosure, select BlueBubbles. Enter the exact allowed sender address and conversation GUID from BlueBubbles. No automatic conversation discovery or wildcard authorization is enabled.
3. To control Open Sesame from your own Apple ID's sent messages, enable **allow my own sent messages**. Those messages must start with `open sesame ` or `open sesame:` and must match the exact conversation. BlueBubbles's authenticated `isFromMe` event identifies this case; otherwise the exact sender address is checked.
4. Start receiver. Add the displayed `http://127.0.0.1:8766/bluebubbles/<secret>` URL as a BlueBubbles `new-message` webhook. Both processes must be on the same Mac. Keep this secret URL private; do not publish or tunnel the receiver.
5. Send `open sesame status` in that conversation, then inspect the controller's result. Try `open sesame feed add <blog-url>` next. This integration receives commands and shows their results in Open Sesame; it does not send BlueBubbles replies.

Stop closes the receiver. Starting it again rotates the secret, so update the webhook URL. Foreign browser origins, unknown senders, other conversations, unsupported events, and unapproved own-message events are rejected or ignored. Official payload reference: [BlueBubbles webhook example](https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks/python-web-server).

## Photon / Spectrum Stable

The optional adapter uses Photon's documented **Spectrum Stable** `spectrum-ts` message stream. It does not use the separate Photon 2.0 beta API or pretend to authorize a Photon account. A configured Photon project/provider is required. See [getting started](https://photon.codes/docs/spectrum-ts/getting-started) and [message handling](https://photon.codes/docs/spectrum-ts/messages).

1. Configure your Photon Stable project and iMessage provider. Identify your exact sender ID and conversation `space.id` using the provider's tools. Do not use a wildcard. The adapter ignores outbound events.
2. Select Photon in Open Sesame. Enter those same IDs and start receiver. Copy the displayed local receiver token.
3. Use Node.js 22 or later. From this source checkout, install the optional SDK: `npm install --prefix desktop --no-save --package-lock=false spectrum-ts`. This dependency is only for the separately run adapter, not for building Open Sesame.
4. Supply `PROJECT_ID`, `PROJECT_SECRET`, `OPEN_SESAME_CONTROLLER_TOKEN`, `OPEN_SESAME_ALLOWED_SENDER`, and `OPEN_SESAME_ALLOWED_CHAT` as environment variables through your normal secret manager or local terminal environment. Do not put secrets into tracked files or the hosted website.
5. Run `node desktop/photon-controller.mjs` on the same Mac. It uses only `http://127.0.0.1:8766` for local delivery. Start with `status` from the allowed sender/conversation.

The adapter delivers text commands, waits for a result, and replies only through the originating allowed message. It never relays arbitrary recipients. If a result takes over a minute, it replies that the command is queued and tells you to check Open Sesame. Failed deliveries are not automatically retried. Restarting the receiver requires updating the adapter's token and restarting it.

## Persistence and verification

The local receiver uses SQLite at `~/.local/share/Open Sesame/controller.sqlite`, with file permissions 0600. An existing legacy controller database is reused when the new location is absent, preserving duplicate detection and receipts across the rename. Both `open sesame` and the legacy command prefix are accepted. It stores message identity hashes, command text, processing state, timestamps, and short results so duplicate provider events are not applied again. It accepts at most 100 pending commands, 2,000 characters per command, and 64 KB per request. Changing sender/conversation/provider/own-message permissions cancels previously queued commands. A command interrupted while running is marked interrupted on restart and is not replayed; inspect the widget before sending it again. Completed receipts remain device-local until the database is removed; remove it only with the receiver stopped, which also resets duplicate detection.

`node scripts/check-controller.mjs`, `node scripts/check-site-feeds.mjs`, and `python3 -m unittest discover -s desktop/tests -v` cover the command engine, RSS generation/XML escaping, real loopback HTTP authorization, deduplication, queue bounds, permission changes, interruption, and existing native services. Frontend tests use DOM fixtures. The provider SDK transports, actual iMessage accounts, native macOS compilation/Save panel, and real browser rendering have not been verified in this environment. Rebuild and validate the Mac companion before relying on live control. No live iMessages were sent during development.
