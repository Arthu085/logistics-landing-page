import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/deploy.sh', import.meta.url).pathname;
const image = `docker.io/nexo/logistics-landing-page@sha256:${'b'.repeat(64)}`;
const revision = 'a'.repeat(40);

async function runMockDeploy(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'logistics-deploy-test-'));
  const log = join(directory, 'calls.log');
  await writeFile(join(directory, 'kubectl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALLS_LOG"
case "$*" in
  *'get deployment/logistics service/logistics pods'*) exit 1 ;;
  *'rollout status'*) exit "$MOCK_ROLLOUT_STATUS" ;;
  *'wait --for=condition=Ready pod -l app=logistics'*)
    if [[ "$MOCK_OLD_POD_TERMINATING" == 1 ]]; then
      printf 'error: timed out waiting for the condition on pods/logistics-old-terminating\\n' >&2
      exit 1
    fi
    ;;
  *'get deployment logistics -o jsonpath='*) printf '%s' "$MOCK_IMAGE" ;;
  *'port-forward'*) exec sleep 60 ;;
  *'apply -f -') cat >/dev/null ;;
esac
`, { mode: 0o755 });
  await writeFile(join(directory, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CALLS_LOG"
for url do :; done
case "$url" in
  */healthz) printf 'ok\\n' ;;
  */version.json) printf '{"revision":"%s"}\\n' "$MOCK_REVISION" ;;
  */) printf '<title>Nexo Logística</title>\\n' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [script, image], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        CALLS_LOG: log,
        MOCK_IMAGE: image,
        MOCK_ROLLOUT_STATUS: '0',
        MOCK_OLD_POD_TERMINATING: '0',
        MOCK_REVISION: revision,
        EXPECTED_REVISION: revision,
        ...overrides,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { ...result, calls: await readFile(log, 'utf8') };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('deploy rejects mutable tags, non-Docker-Hub registries and injected arguments', () => {
  for (const ref of ['docker.io/nexo/logistics:latest', `ghcr.io/nexo/site@sha256:${'b'.repeat(64)}`, `${image}\n--context=other`]) {
    const result = spawnSync('bash', [script, ref], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /immutable Docker Hub image reference/);
  }
});

test('deploy checks immutable image, rollout, HTTP and commit on the dedicated context', async () => {
  const result = await runMockDeploy();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment successful/);
  assert.match(result.calls, /rollout status deployment\/logistics --timeout=180s/);
  assert.match(result.calls, /get deployment logistics -o jsonpath=/);
  assert.match(result.calls, /http:\/\/127\.0\.0\.1:18080\/healthz/);
  assert.match(result.calls, /http:\/\/127\.0\.0\.1:18080\/version\.json/);
  for (const call of result.calls.split('\n').filter((line) => line.startsWith('--context'))) {
    assert.ok(call.startsWith('--context kind-logistics '));
  }
  assert.doesNotMatch(result.calls, /get deployment\/logistics service\/logistics pods/);
});

test('a failed rollout prevents the HTTP success check', async () => {
  const result = await runMockDeploy({ MOCK_ROLLOUT_STATUS: '1' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.calls, /port-forward|http:\/\//);
  assert.doesNotMatch(result.stdout, /Deployment successful/);
});

test('a completed rollout succeeds while an old pod is still terminating', async () => {
  const result = await runMockDeploy({ MOCK_OLD_POD_TERMINATING: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment successful/);
  assert.match(result.calls, /rollout status deployment\/logistics --timeout=180s/);
  assert.match(result.calls, /http:\/\/127\.0\.0\.1:18080\/healthz/);
  assert.match(result.calls, /http:\/\/127\.0\.0\.1:18080\/version\.json/);
  assert.doesNotMatch(result.calls, /wait --for=condition=Ready pod -l app=logistics/);
});

test('a ready application from the wrong commit still fails deployment', async () => {
  const result = await runMockDeploy({ MOCK_REVISION: 'c'.repeat(40) });
  assert.equal(result.status, 1);
  assert.match(result.calls, /version\.json/);
  assert.doesNotMatch(result.stdout, /Deployment successful/);
});

test('a completed rollout with the wrong image digest still fails deployment', async () => {
  const result = await runMockDeploy({ MOCK_IMAGE: `docker.io/nexo/logistics-landing-page@sha256:${'c'.repeat(64)}` });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.calls, /port-forward|http:\/\//);
  assert.doesNotMatch(result.stdout, /Deployment successful/);
});
