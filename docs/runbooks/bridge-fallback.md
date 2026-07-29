# Bridge Fallback Runbook

Use this runbook when an operator asks whether a standalone WebSocket-to-TCP
bridge should be introduced for Luminari Web traffic.

## Default Answer

Keep the first-party React app on the integrated Luminari Web proxy.

The app's `/ws` endpoint is a JSON application protocol. A bridge that forwards
bytes cannot validate browser messages, negotiate MSDP for the app, map game
state, throttle commands inside the app session, or send the documented
connection-status messages.

## Triage Questions

1. Is the user using the first-party React app?
2. Is the requested route the existing `/ws` endpoint?
3. Does the user need HUD, panels, aliases, triggers, MSDP state, reconnect
   cleanup, or structured connection statuses?
4. Is the operator trying to expose arbitrary browser-selected host and port
   routing?
5. Would any bridge recording, TCP dump, packet capture, or verbose logging
   include player commands or terminal transcripts?

If the answer to questions 1, 2, or 3 is yes, do not replace `/ws` with a
bridge. Keep or restore the integrated proxy.

If the answer to question 4 or 5 is yes, reject the bridge fallback until the
operator supplies target curation and privacy controls.

## Acceptable Bridge Use

A bridge can be considered only for a separate raw terminal or transport path.
It must not be presented as the first-party app backend.

Required controls:

- Fixed or mapped target destinations.
- No arbitrary user-supplied host and port forwarding.
- TLS or a trusted private network boundary.
- Authentication or authorization before opening TCP.
- Rate limits and connection limits.
- Connect, write, idle, and shutdown timeouts.
- Egress firewall rules that block private infrastructure and metadata-service
  addresses unless the deployment is intentionally private.
- Process supervision and health checks.
- Logs that omit player command text and terminal transcripts by default.
- Disabled bridge recording, TCP dump, packet capture, and byte-stream debug
  output for player sessions.

## Rejection Criteria

Reject the bridge fallback when:

- It would receive the first-party app's `/ws` traffic.
- It would require the React app to stop using JSON browser messages.
- It would bypass public-mode origin checks or destination allowlists.
- It would accept arbitrary public users as an open proxy.
- It would rely on recording or TCP dump for normal operation.
- It would move Telnet/MSDP state mapping out of the integrated proxy without a
  separate protocol implementation session.
- The operator cannot explain rollback to the integrated proxy.

## Safe Operating Boundary

For the integrated proxy:

- Keep `PROXY_PUBLIC_MODE=true` for public production.
- Set `PROXY_ALLOWED_ORIGINS` to the public HTTPS origin.
- Add only vetted routes to `PROXY_ALLOWED_DESTINATIONS`.
- Keep `PROXY_ALLOW_CUSTOM_DESTINATIONS=false` unless external abuse controls
  are in place.
- Probe `/health` through the public origin.

For a separate bridge:

- Publish a separate route, hostname, or service name.
- Document that the route is terminal-only or transport-only.
- Keep bridge target maps outside the browser's control.
- Keep transcript capture disabled unless an incident procedure explicitly
  authorizes it.
- Rotate logs according to the operator's privacy policy.

## Investigation Steps

When a connection incident mentions a bridge:

1. Confirm whether the affected client is the first-party React app or a
   separate raw terminal client.
2. If the React app is pointed at a bridge, roll back `/ws` to the integrated
   proxy.
3. Check `PROXY_ALLOWED_ORIGINS` for the browser origin.
4. Check the requested host and port against curated presets and
   `PROXY_ALLOWED_DESTINATIONS`.
5. Check for banned service ports, unsafe DNS answers, private networks,
   loopback, link-local, reserved addresses, and metadata-service targets.
6. Check connect timeout, idle timeout, HTTP rate limit, WebSocket connection
   limit, and command throttle symptoms.
7. Review logs for policy codes and stable status details only; do not collect
   player command text as routine evidence.
8. If a separate bridge is failing, check its target map, auth layer, timeout
   settings, reverse-proxy upgrade behavior, and egress firewall.

## Rollback

Rollback target:

- Restore public traffic for the first-party app to the integrated Luminari Web
  server.
- Confirm `/health` returns 200 through the public origin.
- Confirm `/api/settings` returns runtime settings.
- Confirm `/ws` accepts the configured public origin and rejects an unexpected
  origin.
- Confirm a curated preset can attempt a connection.

Rollback triggers:

- The bridge receives JSON app messages and cannot connect users.
- HUD or panel state disappears because MSDP state is no longer emitted.
- The bridge logs player command text or terminal transcripts by default.
- The bridge allows arbitrary host and port forwarding.
- Public-mode policy rejections are bypassed instead of fixed.

## Escalation

Escalate as P0 when the app is unavailable or `/ws` cannot be restored to the
integrated proxy.

Escalate as P1 when users cannot connect to configured MUDs, public origins are
misconfigured, destination allowlists are wrong, or a bridge fallback is
blocking the supported app path.

Escalate as P2 when panels, MSDP state, aliases, triggers, or reconnect cleanup
regress while terminal text still works.

Escalate as a privacy incident if logs, bridge recordings, TCP dumps, packet
captures, or support artifacts contain player command text, credentials typed
inside the MUD, private roleplay, private hostnames, or other sensitive session
content.
