# Incident Response

## Severity

| Level | Description                                                                  | Response Target          |
| ----- | ---------------------------------------------------------------------------- | ------------------------ |
| P0    | App unavailable, plaintext regression, or suspected transport-key compromise | Immediate                |
| P1    | Users cannot connect to configured MUDs or the mTLS route is unhealthy       | Under 1 hour             |
| P2    | HUD, panels, aliases, triggers, or settings broken                           | Under 4 hours            |
| P3    | Documentation or cosmetic issue                                              | Next planned maintenance |

## First Checks

```bash
pm2 status
pm2 logs luminari-web-client
curl http://localhost:5191/health
```

For local development:

```bash
npm run dev
```

For the Cloudflare production transport:

```bash
curl -fsS https://web.luminarimud.com/health
curl -fsS https://mud-status.luminarimud.com/mtls-health.json | jq
npx wrangler deployments status --env-file /dev/null
```

On the MUD host:

```bash
sudo systemctl is-active \
  apache2.service \
  luminari-web-gateway.service \
  stunnel@luminari-mud.service
sudo ss -Hnt state established \
  '( sport = :4100 or sport = :5191 )'
```

Do not copy application frames, terminal output, credentials, commands, or RP
text into an incident ticket. Use service state, certificate metadata,
aggregate counts, content-free error classes, and deployment IDs.

## Common Incidents

### Server Does Not Start

**Symptoms**: `npm start` or PM2 exits, health check fails.

**Resolution**:

1. Run `npm run build`.
2. Check `dist/server/index.js` exists.
3. Check whether `PORT` is already in use.
4. Review server logs for TypeScript build or runtime errors.

### Browser Cannot Open WebSocket

**Symptoms**: App loads, connect action fails, browser console shows WebSocket errors.

**Resolution**:

1. Check production `/health` and the separate mTLS status document.
2. Confirm the current Worker deployment contains `MUD_ORIGIN_MTLS`.
3. Confirm Apache and `luminari-web-gateway.service` are active.
4. Confirm `mud-origin.luminarimud.com` resolves directly to the intended host.
5. Check aggregate Apache and gateway logs without enabling payload logging.
6. For development, confirm the Vite proxy in `vite.config.ts` and
   `VITE_WS_URL` if using a non-default target.

### Production Mutual TLS Fails

**Symptoms**: `/health` and static assets work, but every fresh `/ws` attempt
gets the generic connection failure; the mTLS status document is stale or
reports an alert; or the external security workflow fails.

**Resolution**:

1. Keep the route fail closed. Do not point the Worker at public port `4100`.
2. Check `apache2`, `luminari-web-gateway`, `certbot.timer`, and
   `luminari-mtls-crl.timer`.
3. Check the server, Worker, client-CA, and CRL states in
   `mtls-health.json`.
4. Confirm the Worker binding ID matches `wrangler.jsonc` and the tracked public
   certificate.
5. Run the authorized host health service and aggregate monitor.
6. Check exact origin DNS, exact hostname validation, certificate dates, CRL
   `nextUpdate`, and client-certificate serial/revocation state.
7. Roll back only to a known-good secure Worker version. If none works, leave
   web login unavailable while repairing the route.
8. Follow [mtls-transport.md](mtls-transport.md) for renewal, rotation, and
   secure rollback.

### Plaintext Worker Regression

**Symptoms**: a new Cloudflare/public peer connects directly to server-side
port `4100`, a production Worker version has no managed mTLS binding, or a
packet capture shows invented web-session markers outside TLS.

**Resolution**:

1. Treat this as P0 and stop new web logins by deploying a known-good secure
   version or failing `/ws` closed.
2. Preserve deployment IDs, timestamps, socket metadata, and a bounded
   invented-data capture; do not collect real player payloads.
3. Distinguish the known legacy direct-Telnet peers from Worker traffic. Do not
   disconnect unrelated legacy players unless separately authorized.
4. Drain every session created by the regressed Worker.
5. Restore managed mTLS, repeat the full browser/socket/capture gates, and
   reopen `ONBOARD-SEC-001` until an evidence-backed closure review passes.

### Suspected Worker Client-Key Compromise

**Symptoms**: an unexpected holder appears to authenticate, private-key
handling controls were bypassed, or Cloudflare/operator credentials that could
manage the identity may be exposed.

**Resolution**:

1. Keep the application fail closed; never fall back to plaintext.
2. Issue and deploy a replacement client identity from a trusted root session.
3. Revoke the suspected certificate, regenerate/install the CRL, and reload
   Apache and stunnel.
4. Delete the compromised managed certificate from Cloudflare.
5. Rotate affected operator credentials and inspect aggregate deployment and
   handshake metadata.
6. Run the external security gate and record the incident without player
   content.
7. Use the exact ordering in [mtls-transport.md](mtls-transport.md).

### MUD Connection Fails

**Symptoms**: WebSocket connects but MUD status reports an error or closes.

**Resolution**:

1. In Cloudflare production, confirm the gateway can reach fixed backend
   `127.0.0.1:4100`; browser values cannot select a different route.
2. Confirm the MUD service and listener are healthy.
3. Confirm the gateway listener remains `127.0.0.1:5191`.
4. For an ordinary Node deployment, confirm the configured host and port, try
   a curated preset, and check outbound network access.
5. In ordinary public Node mode, confirm the route is curated or present in
   `PROXY_ALLOWED_DESTINATIONS`, the port is not banned, and DNS resolves only
   to safe public addresses.
6. Review content-free policy, DNS, TCP, timeout, or connection-reset errors
   without collecting player command text.

### Public Proxy Policy Rejects Connections

**Symptoms**: Browser can open the app, but `/ws` closes immediately or connect attempts report policy errors.

**Resolution**:

1. Confirm `PROXY_PUBLIC_MODE=true` for public production.
2. Confirm `PROXY_ALLOWED_ORIGINS` exactly matches the deployed HTTPS origin.
3. Confirm the reverse proxy forwards WebSocket upgrades and preserves the `Origin` header.
4. Confirm the MUD host and port are in `shared/app-settings.ts` or `PROXY_ALLOWED_DESTINATIONS`.
5. Confirm `PROXY_ALLOW_CUSTOM_DESTINATIONS=true` was not enabled as a shortcut around missing allowlist entries.
6. Check for banned ports, direct IP literals, unsafe DNS answers, and metadata-service hostnames.
7. Run `node --import tsx --test tests/proxy-deployment-policy.test.ts` after any policy change.

### Bridge Fallback Misroutes App Traffic

**Symptoms**: Terminal or panel state stops working after a bridge is introduced, or the bridge receives JSON app messages.

**Resolution**:

1. Restore the first-party React app's `/ws` route to the integrated Luminari Web proxy.
2. Confirm `/health`, `/api/settings`, and `/ws` are served by the same integrated deployment.
3. Use [bridge-fallback.md](bridge-fallback.md) before considering a separate raw terminal bridge.
4. Keep bridge recording, TCP dump, packet capture, and verbose byte logging disabled for player traffic.
5. Escalate as a privacy incident if logs or support artifacts include player commands, credentials typed inside the MUD, private roleplay, private hostnames, or terminal transcripts.

### HUD Data Missing

**Symptoms**: Terminal works but HUD or panel values stay empty.

**Resolution**:

1. Confirm the MUD negotiated MSDP.
2. Check the MSDP variable mapping in the UI settings.
3. Compare requested variables with `docs/prev_prd/PRD.md` and the current
   protocol feature checklist.
4. Treat unsupported variables as expected gaps unless the current PRD or a completed session explicitly adds support for them.
5. If the Room, Map, or Quests tabs show explicit unavailable or override-only states, verify whether `ROOM`, `ROOM_EXITS`, `MINIMAP`, or `QUEST_INFO` are actually emitted by the server before treating the UI as broken.
