# Worker mTLS Public Certificates

`luminari-web-worker-current.pem` is the public half of the client identity
currently scheduled for the production Cloudflare Worker. It is intentionally
tracked so the repository's scheduled security workflow can enforce 30-, 14-,
and 7-day expiry gates.

The matching private key is not stored here. It is restricted to the
Cloudflare Worker secret binding and the root-only production PKI backup. A
rotation must replace this public certificate in the same change that records
the new fingerprint and deployment evidence.

Current identity:

- Cloudflare certificate ID: `6015b318-1e10-4584-aa26-6673afd1e5d4`
- Subject: `O=LuminariMUD, CN=luminari-web-worker-20260729-b`
- Serial: `1001`
- Valid through: `2026-10-27 10:36:17 UTC`
- SHA-256:
  `D6:15:F5:DE:EB:B3:A2:B9:29:81:DD:81:13:65:50:2E:BF:BE:10:2B:FE:90:8D:B2:16:35:4F:47:4E:4D:47:2B`

Rotation evidence:

- Identity `a`, serial `1000`, was valid alongside identity `b` during the
  bounded 2026-07-29 overlap.
- Route-free canary version `e50cee20-f44c-4845-b250-99133829bb8c` completed a
  fresh managed-mTLS connection with identity `b`.
- Serial `1000` was then revoked as superseded. Apache and stunnel returned
  zero application bytes to it after CRL reload, while serial `1001` continued
  to pass.
