# Controlled staging profile

Selected profile: existing Windows single host, loopback backend and NGINX TLS/authenticated gateway.
These assets do not install, expose, provision or deploy a service. Activation requires operator authorization.

1. Keep one Node process/database executor, backend at 127.0.0.1:3000. No cluster/PM2 workers or overlapping rolling restart.
2. Use the approved release build; copy frontend/dist to the operator NGINX prefix's html/aurvin.
3. Place the trusted certificate, private key and salted password file in conf/operator under that external prefix. Keep them outside Git; restrict ACLs to the service/operator accounts. No password or private key is supplied here.
4. Copy this nginx.conf to conf/nginx.conf under the prefix. Include the installed distribution's mime.types. Use frontend VITE_API_BASE=/api for the release build.
5. From that prefix, run nginx -t. Syntax success is not proof of access/streaming/restore.
6. Only after authorization, start the gateway. Keep its default 127.0.0.1:8443 listener for local validation. Private remote exposure requires an approved private listener, firewall and trusted certificate name; record before opening access.
7. Verify unauthenticated UI and API both deny access, backend direct port cannot be reached remotely, and operations routes remain local-only. CORS is not authentication; do not trust client user IDs or forwarded headers.
8. P10 runs and records delayed fixture streaming through this actual gateway, including no-cache headers, incremental chunk timing, disconnect, total timeout and drain/crash drills.
9. Configure a 45-second process hard-stop after the application shutdown request. Windows requires explicit app.close()/IPC and tested Ctrl-C behavior, not assumed SIGTERM delivery.
10. Follow docs/aurvin-phase-1/operations.md for maintenance, retention, backup/restore, migration and rollback. All actual results belong in staging-evidence.md.

No Azure offering is certified. Do not point the native-only adapter at unidentified Cosmos/DocumentDB or treat mongodump as a universal Azure backup mechanism.

The exact `location = /api/voice` block is **dictation-only**. Voice session/token REST routes remain under `/api/` and inside this gateway's basic-auth boundary; current application authentication is deferred, and gateway basic auth is not application authentication. Live media and reliable controls connect directly to the admitted LiveKit URL using a scoped token; its signaling/media/TURN paths are separate from this HTTP proxy. Protected HTTP staging is not WebRTC or access certification. There must be no unauthenticated public voice. Obtain separate approval before DNS, certificates, firewall rules, server activation, or LiveKit reachability changes; this example provides no LiveKit listener or credentials. See [Live voice WebRTC operations](../../docs/live-voice-webrtc/operations.md). The 1260-second proxy read timeout applies only to the dictation socket; it is not a quota and does not authorize enabling flags. Do not start this gateway from the voice runbook.

The existing authenticated HTTPS gateway is **not an admitted Calendar transport**. Do not forward or enlarge plugin access, reinterpret admin's HTTPS guard, or enable Google Calendar on this profile. Keep Calendar disabled here until separately approved scope and security work. No NGINX activation or OAuth provisioning is part of this document.
