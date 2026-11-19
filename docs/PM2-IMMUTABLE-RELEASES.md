# Portal immutable PM2 release procedure (release HOLD)

CI validates pull requests and packages a separate candidate artifact from the
exact `main` build. The legacy workflow's production jobs and legacy mutation
entrypoints are fenced off. Artifact publication does not activate production.
Keep the staging and production release roots, PM2 daemons, databases, and
secrets separate. Do not run a production cutover until the acceptance gates in
the [checkpoint](PRODUCTION-COMPLETION-CHECKPOINT.md) pass.

## Host layout and checks

Use a dedicated non-root portal account and private root containing `releases/`
and `shared/pm2/`. Keep DB, upload/storage paths, and logs outside `releases/`.
Configure all persistent application paths to absolute shared locations before
cutover; the scripts do not relocate existing data. Use an external `0600` or
`0400` env file. Configure the portal vhost to `127.0.0.1:3062`, but first verify
listener ownership and saved tenant assignments. Do not terminate or move a
process to free that port. Confirm the installed Node supports `node:sqlite`.

Obtain the candidate and expected SHA/digest from the same trusted, successful
GitHub run. Extract into a private staging directory. With `ROOT`, `ENV_FILE`,
`PAYLOAD`, `SHA`, and `DIGEST` set to verified values:

```bash
export PM2_HOME="$ROOT/shared/pm2"
bash scripts/prepare-pm2-release.sh "$SHA" "$DIGEST" "$PAYLOAD" "$ROOT/releases"
ALO_RELEASE_AUTHORIZED=1 bash scripts/activate-pm2-release.sh \
  "$ROOT" "$ENV_FILE" activate "$SHA" "$DIGEST"
ALO_RELEASE_AUTHORIZED=1 bash scripts/activate-pm2-release.sh \
  "$ROOT" "$ENV_FILE" rollback 'operator-approved reason'
```

The activator checks an existing external SQLite database in read-only mode,
rechecks the source digest and copied assets, serializes activation, verifies
HTTP release identity (including the activation UUID), readiness, login and a
static chunk, then atomically updates `current`. On a single fixed-port host,
there is a brief interruption while PM2 replaces the listener; the atomic
pointer alone does not provide zero-downtime traffic switching. Workers start
after the panel smoke check. If activation fails, the script attempts to start
and verify the previously recorded release and returns nonzero even if recovery
succeeds. Manual rollback uses only the recorded known-good predecessor. Failed
candidates stay on disk. No application rollback alters the database schema.

`shared/activation.log` records outcomes; PM2 owns private process logs. If
`shared/pending` remains, do not retry blindly. Under the same activation lock,
inspect the journal, `current`, known-good records, PM2 process paths, and the
actual health identity. Reconcile to the last verified release and confirm
health before clearing the journal. Never clear the lock by deleting its file:
`flock` releases when the owning process exits.

Back up the real database and demonstrate an isolated restore before approving
any separate schema change. Keep changes compatible with both the active and
previous applications (expand before deployment, contract after the rollback
window). Do not point this SQLite build at MySQL or replace the live database.

## Workflow enablement

`pm2-staging` and `pm2-production` remain disabled unless the repository opt-in
variables `ALO_PM2_STAGING_ENABLED` and `ALO_PM2_PRODUCTION_ENABLED` are set to
`1`. Configure separate, restricted runners with labels `alo-portal-staging`
and `alo-portal-production`; scope each environment's `ALO_PM2_ROOT` and
`ALO_PM2_ENV_FILE` to that host. Configure required reviewers and a `main`-only
deployment branch rule on the production environment **before** setting the
production opt-in. The repository cannot install or attest those controls.
A staging smoke from the same dispatch is a prerequisite, not a substitute for
the full acceptance record attached to `release_ticket`.

Run `bash scripts/audit-pm2-release-host.sh ROOT ENV_FILE` for a read-only
inventory without exposing env values. The host audit does not verify DNS, TLS
renewal, firewall policy, or alert delivery; check those separately.

### Promotion and GitHub administration

The build publishes independent SHA-256 values for the archive and its payload.
The hosted build rehearses extraction and preparation even for PRs. Only a
`main` run uploads a promotable candidate. Staging and production consume the
same archive and digests from the same run; neither rebuilds. The runner hashes
a private copy before extraction, then checks the manifest commit and payload.

The production job additionally depends on a GitHub-hosted policy check. It
requires a nonempty required-reviewer rule with self-review disallowed, and
exactly one deployment-branch rule: `main` (no tag rule). An inaccessible
policy API fails closed. Configure these settings through a repository admin;
keep `ALO_PM2_PRODUCTION_ENABLED` unset until all acceptance evidence is signed
off. Put staging and production runners in separately restricted runner groups
and non-root accounts; do not put production credentials on either staging or
routing runners. Public-routing diagnostics additionally require
`ALO_PM2_ROUTING_ENABLED=1` and a dedicated `alo-portal-routing` runner.
