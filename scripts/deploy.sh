#!/usr/bin/env bash
set -euo pipefail

image_ref=${1:?Usage: scripts/deploy.sh docker.io/user/repository@sha256:digest}
if [[ ! "$image_ref" =~ ^docker\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Deploy requires an immutable Docker Hub image reference.' >&2
  exit 1
fi
for tool in kubectl curl; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(dirname -- "$script_dir")
kube=(kubectl --context kind-logistics --namespace logistics)
log_file=$(mktemp)
forward_pid=''
cleanup() {
  result=$?
  if [[ -n "$forward_pid" ]]; then
    kill "$forward_pid" 2>/dev/null || true
    wait "$forward_pid" 2>/dev/null || true
  fi
  if (( result != 0 )); then
    cat "$log_file" >&2
    "${kube[@]}" get pods,services -o wide >&2 || true
    "${kube[@]}" get events --sort-by=.lastTimestamp >&2 || true
  fi
  rm -f "$log_file"
  exit "$result"
}
trap cleanup EXIT
kubectl --context kind-logistics cluster-info >/dev/null
kubectl --context kind-logistics apply -f "$project_dir/k8s/namespace.yaml"
sed "s|IMAGE_PLACEHOLDER|$image_ref|g" "$project_dir/k8s/app.yaml" | "${kube[@]}" apply -f -
"${kube[@]}" rollout status deployment/logistics --timeout=180s
actual_image=$("${kube[@]}" get deployment logistics -o jsonpath='{.spec.template.spec.containers[0].image}')
[[ "$actual_image" == "$image_ref" ]]
"${kube[@]}" port-forward service/logistics 18080:80 --address 127.0.0.1 >"$log_file" 2>&1 &
forward_pid=$!
ready=false
for attempt in {1..30}; do
  kill -0 "$forward_pid" 2>/dev/null || { cat "$log_file" >&2; exit 1; }
  if curl --fail --silent --max-time 3 http://127.0.0.1:18080/healthz | grep -qx ok; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]]
page=$(curl --fail --silent --max-time 10 http://127.0.0.1:18080/)
[[ "$page" == *'Nexo Logística'* ]]
if [[ -n "${EXPECTED_REVISION:-}" ]]; then
  [[ "$EXPECTED_REVISION" =~ ^[a-f0-9]{40}$ ]]
  version=$(curl --fail --silent --max-time 10 http://127.0.0.1:18080/version.json)
  [[ "$version" == "{\"revision\":\"$EXPECTED_REVISION\"}" ]]
fi
"${kube[@]}" get deployment/logistics service/logistics -o wide
"${kube[@]}" get pods -l app=logistics -o wide
printf 'Deployment successful: %s\nAccess: http://localhost:8080\n' "$image_ref"
