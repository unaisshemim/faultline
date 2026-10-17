# Microsoft connections

The Integrations page uses Microsoft's authorization-code flow with PKCE and
browser-bound, single-use state. Outlook and Teams are connected separately.
Access/refresh tokens remain on the backend, encrypted with AES-256-GCM in
`data/microsoft/`; this directory is git-ignored. Disconnect deletes the local
connection. Microsoft consent is managed separately in the user's account.

## Local setup

1. Register Company Brain in Microsoft Entra. Choose your organization only or
   organizational directories, matching `MICROSOFT_TENANT_ID`. Teams requires a
   work/school account. Personal Microsoft accounts are not supported here.
2. Under Authentication, add a **Web** redirect URI:
   `http://localhost:5173/api/integrations/microsoft/callback`.
3. Add delegated Microsoft Graph permissions: `User.Read`, `Mail.Read`,
   `Calendars.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Chat.Read`,
   and `ChatMessage.Send`.
   Microsoft or your organization's policy may require admin consent.
4. Create a client secret. In the project's `.env`, set `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET` (the secret value), and `MICROSOFT_TENANT_ID`
   (directory ID for single tenant; `organizations` for organizational accounts).
5. Generate a token encryption key with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
   and set `MICROSOFT_TOKEN_KEY`. Retain this key across restarts; changing it
   makes stored connections unreadable.
6. Restart the API. Open `http://localhost:5173/#/integrations` and choose
   Connect Outlook or Connect Teams. The browser host must match the callback
   host so the state cookie returns correctly.

`APP_URL` controls the return URL; `MICROSOFT_REDIRECT_URI` must exactly match
the Entra registration. Sign-in errors/cancellation return to Integrations.
Neither app secrets nor tokens are sent to the frontend.

## Scope

This remains a single-user localhost app. Connection grants read access to
Outlook email/calendar and Teams conversations the connected user participates
in. The Chats page loads conversations and message history with pagination and
sends plain-text messages as that user only when they explicitly select Send.
Teams access tokens refresh on demand; rotated refresh tokens are encrypted.
Existing connections without chat scopes require reconnection. The employee
simulator stays separate.

Sending is not automatically retried. Identical request IDs are deduplicated
in-process for 30 minutes. Unconfirmed delivery requires inspecting the refreshed
conversation before sending again. This does not provide durable exactly-once
delivery across API restarts. No background ingestion, automatic follow-ups,
bots, subscriptions, or founder AI access to real conversations is enabled.

Before hosting for multiple users, add app authentication and per-user storage.
Do not expose the unauthenticated local API publicly.

References: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
and [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).
