# Worker-to-MUD Mutual-TLS Transport

## Purpose and Boundary

This runbook owns the production transport between the Cloudflare Worker and
the LuminariMUD host. The active route is:

```text
Browser at web.luminarimud.com
  | HTTPS / WSS
  v
Cloudflare Worker luminari-web
  | managed mTLS Fetcher binding over WSS
  v
mud-origin.luminarimud.com:443
  | Apache exact-name and exact-path authorization
  v
127.0.0.1:5191
  | Luminari Node gateway and MudSession
  v
127.0.0.1:4100
  | Telnet on host loopback only
  v
LuminariMUD
```

The browser still sees the logical destination `luminarimud.com:4100`.
Browser data cannot select the origin URL, gateway address, or loopback
backend.

Public port `4100` remains available for legacy direct Telnet players. Those
connections are plaintext and are outside this web-transport remediation.
Never describe direct Telnet as encrypted.

## Production Inventory

| Item                    | Production value                                            |
| ----------------------- | ----------------------------------------------------------- |
| Worker                  | `luminari-web`                                              |
| Browser origin          | `https://web.luminarimud.com`                               |
| Managed binding         | `MUD_ORIGIN_MTLS`                                           |
| Current certificate ID  | `6015b318-1e10-4584-aa26-6673afd1e5d4`                      |
| mTLS origin             | `https://mud-origin.luminarimud.com/gateway/ws`             |
| Public status           | `https://mud-status.luminarimud.com/mtls-health.json`       |
| Apache config           | `/etc/apache2/conf-enabled/luminari-mud-origin-status.conf` |
| Gateway service         | `luminari-web-gateway.service`                              |
| Gateway release         | `/opt/luminari-web-gateway/current`                         |
| Gateway listener        | `127.0.0.1:5191`                                            |
| Fixed MUD backend       | `127.0.0.1:4100`                                            |
| Client PKI              | `/root/luminari-mtls-pki`                                   |
| Installed client CRL    | `/etc/stunnel/luminari-worker-client-crl.pem`               |
| Scheduled external gate | `.github/workflows/mtls-security.yml`                       |

The exact-name Apache vhost requires a valid client certificate during the
initial TLS handshake and authorizes only `/gateway/ws`. The separate status
vhost publishes aggregate, content-free health without requiring a client
certificate.

The parallel stunnel listener on `54443` is intentionally retained as an
independent certificate, CRL, raw-Telnet-rejection, and TLS-version probe. The
Worker does not use it for player traffic.

## Owners

M. Ben Avraham is the accountable production operator for the public
certificate, client CA, Worker client identity, Cloudflare binding, deployment,
alerts, and incident response.

## Normal Health Checks

Run the public checks without credentials:

```bash
curl --fail --silent --show-error \
  https://mud-status.luminarimud.com/mtls-health.json | jq

curl --fail --silent --show-error \
  https://web.luminarimud.com/health | jq
```

Healthy transport state has:

- top-level `status: "ok"`;
- server, Worker, client-CA, and CRL states all `ok`;
- handshake status `ok`;
- a status timestamp no more than 45 minutes old; and
- the `mtls-security` GitHub Actions workflow passing.

On the MUD host, run:

```bash
sudo systemctl is-active \
  apache2.service \
  luminari-web-gateway.service \
  stunnel@luminari-mud.service \
  certbot.timer \
  luminari-mtls-crl.timer

sudo systemctl show \
  -p ActiveState \
  -p SubState \
  -p NRestarts \
  apache2.service \
  luminari-web-gateway.service \
  stunnel@luminari-mud.service

sudo ss -ltn \
  '( sport = :443 or sport = :5191 or sport = :54443 or sport = :4100 )'

sudo systemctl start luminari-mtls-health.service
sudo systemctl start luminari-mtls-monitor.service
```

The gateway listener must be loopback-only. During one active web session,
there should be one established server-side connection on port `5191` and one
loopback peer on port `4100`. A Cloudflare/public peer connected directly to
port `4100` is a plaintext-regression incident. Known legacy Telnet players are
the only expected non-loopback port-`4100` peers.

Inspect only content-free operational logs:

```bash
sudo journalctl \
  -u luminari-web-gateway.service \
  -u stunnel@luminari-mud.service \
  --since '30 minutes ago' \
  --no-pager

sudo tail -n 200 \
  /var/log/apache2/luminari-mud-origin-status-error.log \
  /var/log/apache2/luminari-mud-origin-status-access.log
```

Do not enable frame, byte, command, credential, onboarding, RP-profile, or
terminal-transcript logging.

## Deploy and Validate

Before a Worker deployment:

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run build
npm run cloudflare:dry-run
```

The Wrangler dry run must show only the static-assets binding and
`MUD_ORIGIN_MTLS`. `wrangler.jsonc` must contain no direct TCP origin,
certificate PEM secret, or plaintext fallback.

Record the current deployment and host baseline:

```bash
npx wrangler deployments status --env-file /dev/null
sudo systemctl show -p ActiveState -p SubState -p NRestarts \
  apache2.service luminari-web-gateway.service stunnel@luminari-mud.service
sudo ss -Hnt state established \
  '( sport = :4100 or sport = :5191 )'
```

Deploy:

```bash
npm run cloudflare:deploy
npx wrangler deployments status --env-file /dev/null
```

Then verify:

1. `/health`, assets, and `/api/settings` through the production custom domain.
2. A fresh invented-data protocol-v2 browser login.
3. All 14 RP entries at desktop, `390 x 844`, and `360 x 740`.
4. An invented private RP save and exact reload.
5. `look`, graceful `quit`, and a clean return to the character menu.
6. Empty browser page-error and console-error buffers.
7. One gateway and one loopback-MUD socket while connected.
8. Zero gateway/loopback-MUD sockets after closing the browser.
9. No new Worker/public peer on port `4100`.
10. Passing public health, certificate, no-client-certificate, and raw-Telnet
    gates.

Deploying a Worker version can disconnect existing sessions. Before closing a
transport finding, identify and intentionally drain every connection created
by the prior plaintext Worker. Do not disconnect unrelated legacy Telnet
players.

## Rollback

### Secure rollback

Prefer the last known-good secure Worker version:

```bash
npx wrangler rollback <secure-version-id> \
  --name luminari-web \
  --message 'Secure transport rollback: <reason>' \
  --yes \
  --env-file /dev/null
```

After rollback, repeat public health, fresh browser, and socket-topology checks.
A rollback is not successful merely because static assets load.

### Fail-closed operation

If the origin, certificate binding, Apache, gateway, or MUD route is unhealthy
and no known-good secure version is available, keep `/ws` unavailable with the
generic connection failure while repairing it. There is no automatic direct
port-`4100` retry.

### Plaintext security rollback

The pre-mTLS Worker version is a last-resort security rollback, not an ordinary
availability rollback. Deploying it restores plaintext credentials and player
content on the Worker-to-host leg. It requires:

1. an explicit, informed operator decision;
2. an incident record with reason, start time, and owner;
3. immediate player notice and a remediation deadline;
4. reopening `ONBOARD-SEC-001` at High severity; and
5. a new session drain and full closure review after secure service returns.

Never add a runtime environment flag that silently selects this path.

## Public Server-Certificate Renewal

Certbot owns the public ECDSA certificate for both exact SANs:

- `mud-origin.luminarimud.com`
- `mud-status.luminarimud.com`

The renewal timer and deploy hook install the renewed material and safely
reload the TLS services. Test renewal without exposing keys:

```bash
sudo certbot renew --dry-run
sudo apache2ctl configtest
sudo systemctl reload apache2.service
sudo systemctl start luminari-mtls-monitor.service
```

Verify both hostnames, the exact origin hostname, and the public health
document after every renewal. Do not replace the exact-name certificate with a
certificate whose hostname is broader or different.

## Worker Client-Certificate Rotation

Rotate before the current identity reaches the 30-day warning threshold. Use a
bounded overlap:

1. Issue a new client key and certificate from the root-only client CA with a
   new serial and short, documented lifetime.
2. Keep the private key mode `0600`, owned by root, and never print it or place
   it in Git, a shell trace, ordinary environment variables, or a regular local
   file.
3. Stream the certificate and key to Cloudflare through root-controlled
   mode-`0600` FIFOs:

   ```bash
   npx wrangler mtls-certificate upload \
     --cert <certificate-fifo> \
     --key <key-fifo> \
     --name <new-identity-name> \
     --env-file /dev/null
   ```

4. Add the returned certificate ID to `MUD_ORIGIN_MTLS` in `wrangler.jsonc`.
5. Update `ops/certificates/luminari-web-worker-current.pem` and its README
   with the public certificate, ID, subject, serial, expiry, and fingerprint.
6. Deploy a route-free or bounded candidate and prove a fresh application
   session with the successor identity.
7. Promote the successor to production and verify the custom domain.
8. Update the root-only `worker-current.crt` and `worker-current.key` symlinks.
9. Revoke the predecessor as superseded, regenerate/install the CRL, and reload
   Apache:

   ```bash
   sudo systemctl start luminari-mtls-crl.service
   sudo systemctl start luminari-mtls-monitor.service
   ```

10. Prove the predecessor receives zero HTTP or MUD application bytes and the
    successor still passes.
11. Delete the revoked predecessor from Cloudflare:

    ```bash
    npx wrangler mtls-certificate delete \
      --id <predecessor-certificate-id> \
      --env-file /dev/null
    ```

12. Run the scheduled `mtls-security` workflow and retain the successful run
    URL as evidence.

Do not revoke the predecessor until the successor has passed through the same
deployed Worker runtime used by production.

## Suspected Client-Key Compromise

1. Keep application traffic fail closed; do not switch to public Telnet.
2. Create and upload a replacement identity from a trusted root session.
3. Deploy the replacement binding and verify a fresh secure session.
4. Revoke the suspected certificate immediately.
5. Regenerate and install the CRL, then reload Apache and stunnel.
6. Delete the compromised identity from Cloudflare.
7. Inspect aggregate handshake metadata and deployment history without
   collecting player payloads.
8. Rotate Cloudflare/operator credentials if their exposure is plausible.
9. Record the incident and run the external security workflow.

If replacement cannot be completed safely, leave web login unavailable.

## Packet-Capture Evidence

Packet capture is an exceptional security-validation action. Use only invented
account, password, command, and RP values; bound the capture duration and
interface filter; and never publish the capture.

Retain accepted evidence under `/var/lib/luminari-mtls/evidence` as
`0600 root:root`. Record only packet count, byte count, SHA-256, exact marker
search result, time, and route. Delete temporary `/run` files after the
evidence copy is verified.

The absence of a marker is evidence only when the same invented marker is
proved to have traversed the live application during the capture.

## Alert and Drill Schedule

- Host aggregate monitor: every 15 minutes.
- External GitHub security gate: every 30 minutes.
- Client CRL refresh: weekly and immediately after revocation.
- Public certificate renewal: Certbot timer plus deploy hook.
- Certificate thresholds: 30, 14, and 7 days.
- Client-certificate rotation: before the 30-day threshold and at least once
  per certificate lifetime.
- Secure Worker rollback drill: once per quarter and after material relay
  changes.
- Alert-delivery drill: once per quarter using the workflow's
  `force_alert=true`, followed by a recovery run.

Drills must use invented data, must not collect application payloads, and must
record both the failure and recovery evidence.

## Related Documents

- [HTTP and WebSocket Contracts](../api/http-and-websocket.md)
- [Environments](../environments.md)
- [Deployment](../deployment.md)
- [Production Deployment](../deploy-production.md)
- [Incident Response](incident-response.md)
- [Transport Architecture](../ARCHITECTURE.md#managed-mtls-origin-decision)
- [Security Closure Evidence](../SECURITY-COMPLIANCE.md#onboard-sec-001-closure-evidence)
