# Nginx and unified Docker Compose deployment

User request2026-11-28: use nginx for frontend/backend proxying, organized into one Docker Compose YAML per project. This extends the ongoing registration delivery; previously approved account policies/first-login remain.

## Design decision
One public nginx service serves built frontend assets and proxies backend routes; the existing nonroot backend is internal-only. This avoids a second static server while keeping deployments in one command. Existing standalone Docker image remains available for compatibility/CI. All existing SQLite volume keys and normal host ports remain unchanged. No product-domain/auth behavior changes solely for proxying.

## Contract
- One root docker-compose.yml per repository. Only nginx publishes the application port; backend exposes internally. Feedback mailpit remains optional profile and its local testmail port.
- React nginx serves dist with SPA deep-link fallback, assets return404 ifmissing. Proxy /api/ /oauth/ /.well-known/ and exact/prefix/mcp without stripping paths. Preserve Feedback /f/ and CDP /collect,/t.js. ES serves server/web assets similarly. Sentiment serves /static/ assets directly but forwards server-rendered entry routes so empty-install bootstrap remains authoritative.
- Proxy Host=$http_host preserves port; keepOrigin/Cookie/Authorization andresponsecookies. Overwrite X-Forwarded-For/X-Real-IP from connectionpeer; do not accept caller-provided forwarded authority/proto. Configure canonical ACCESS_PUBLIC_URL matchingthebrowser; existinglegacy PUBLIC_URL variables remaincompatible and conflictingoverrides stillfail existingvalidation.
- HTTP1.1; proxybufferingoff, requestbufferingoff and >=300s readtimeout forMCP/streaming; preservebackend401challenges anddiscoveryURLs.
- Logs use URI withoutquerystring soOAuthcodes/state are notlogged. Do notlogcredentials orheaders. /healthz identifiesnginx only; integration health verifiesbackendthroughproxy too.
- Nonloopback ES/Sentiment firstadminsetup stillneedsACCESS_SETUP_TOKEN (32–512characters); nginx doesnotfakeloopback ortrustXFF forbootstrap.
- Sentiment hasonecompose: defaultapi+nginx; optional inference profile forGPUmodel+worker. Worker token remainsrequiredatworkerstartup; defaultwebalone mustnotrequireGPUorworkercredentials. Preserveexistingmodel/data mounts andaccess-data volume. Removeobsoletecompose.web.yml andupdatecommands.

## Verification
DockercomposeconfigJSON confirmsonepublicapplicationservice andvolumeconsistency; nginx-t checksconfig. Buildbothservices andstartowneddisposablecomposeproject. Realbrowser/HTTPthroughnginx verifiesassets/deeplinks/firstlogin/closed-approval-openregistration/review/login/cookies,canonicalOrigin rejection/OAuthmetadata/MCPunauthorizedchallenge. SpecialCDPtracker/collection andfeedbackpublicformsmoketests. Verifyquerystringsnotinaccesslogs, backendportsnotpublished. Existingfullbackend/frontendtestresultsremainvalidforunchangedproductcode; rerunaffectedchecksifproxyrevealsbugs. GPUmodel execution requiresNVIDIA/data andisnotclaimedonthisMac. Documentexactevidence; PRmerge/deleteunderexistingauthorization.

## Official references
https://nginx.org/en/docs/http/ngx_http_proxy_module.html
https://docs.docker.com/compose/how-tos/profiles/
