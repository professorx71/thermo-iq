#!/usr/bin/env bash
set -Eeuo pipefail

tag=${1:?usage: deploy_release.sh vX.Y.Z sha256 /opt/install-root}
expected_hash=${2:?usage: deploy_release.sh vX.Y.Z sha256 /opt/install-root}
root=${3:?usage: deploy_release.sh vX.Y.Z sha256 /opt/install-root}

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: invalid release tag: $tag" >&2
  exit 2
fi
if [[ ! "$expected_hash" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: invalid SHA-256 digest" >&2
  exit 2
fi
if [[ ! "$root" =~ ^/opt/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ || "$root" =~ (^|/)\.\.?(/|$) ]]; then
  echo "ERROR: install root must be a safe path under /opt" >&2
  exit 2
fi

archive="/tmp/thermoiq-${tag}.tar.gz"
helper="/tmp/thermoiq-deploy-release.sh"
release_dir="$root/releases/$tag"
incoming="$root/releases/.incoming-${tag}-$$"

for command in docker tar sha256sum curl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "ERROR: required command '$command' is not installed" >&2
    exit 1
  }
done
docker compose version >/dev/null

if [[ ! -f "$root/.env" ]]; then
  echo "ERROR: $root/.env is missing. Create it from .env.cloud.example and configure credentials first." >&2
  exit 1
fi
chmod 600 "$root/.env"
if [[ -e "$root/current" && ! -L "$root/current" ]]; then
  echo "ERROR: $root/current exists but is not a symlink; refusing to replace it." >&2
  exit 1
fi
if [[ ! -f "$archive" ]]; then
  echo "ERROR: uploaded package not found: $archive" >&2
  exit 1
fi
printf '%s  %s\n' "$expected_hash" "$archive" | sha256sum --check --status || {
  echo "ERROR: package checksum mismatch; nothing was installed." >&2
  exit 1
}

mkdir -p "$root/data" "$root/releases"

# What is running now, so a failed release can be rolled back to it:
#   old_target     - a previous release directory ($root/current symlink)
#   legacy_compose - a pre-release install: either the cloud/ layout or the
#                    original flat layout (docker-compose.yml in $root)
old_target=''
legacy_compose=''
if [[ -L "$root/current" ]]; then
  old_target=$(readlink -f "$root/current" || true)
elif docker inspect pbf-temp-dashboard >/dev/null 2>&1; then
  if [[ -f "$root/cloud/docker-compose.yml" ]]; then
    legacy_compose="$root/cloud/docker-compose.yml"
  elif [[ -f "$root/docker-compose.yml" ]]; then
    legacy_compose="$root/docker-compose.yml"
  fi
fi

# Keep the image the running container uses. The new build reuses the same
# image name, so without this a rollback would have to rebuild the old code.
image_repo='pbf-temp-dashboard-dashboard'
rollback_image="$image_repo:rollback"
have_rollback_image=0
if running_image=$(docker inspect --format '{{.Image}}' pbf-temp-dashboard 2>/dev/null) &&
   [[ -n "$running_image" ]]; then
  docker tag "$running_image" "$rollback_image"
  have_rollback_image=1
  echo "Saved running image as $rollback_image"
fi

cleanup() {
  if [[ -d "$incoming" ]]; then
    rm -rf -- "$incoming"
  fi
}
trap cleanup EXIT

# A release folder for this version may already exist:
#   - same package  -> reuse it (redeploy / rollback to a known release)
#   - other package -> an earlier build of this version that was never kept
#                      live (deploy skipped or rolled back). Move it aside and
#                      install the new build. Never touch the LIVE release.
if [[ -d "$release_dir" ]]; then
  stored_hash=$(cat "$release_dir/.release-sha256" 2>/dev/null || true)
  if [[ "$stored_hash" == "$expected_hash" &&
        -f "$release_dir/cloud/docker-compose.yml" &&
        -L "$release_dir/.env" && -L "$release_dir/data" ]]; then
    echo "Reusing installed release $tag (same package)."
  else
    live_dir=$(readlink -f "$root/current" 2>/dev/null || true)
    if [[ -n "$live_dir" && "$live_dir" == "$(readlink -f "$release_dir")" ]]; then
      echo "ERROR: $tag is live with a different package; release a new version instead." >&2
      exit 1
    fi
    replaced="$root/releases/.replaced-${tag}-$(date +%Y%m%d%H%M%S)-$$"
    echo "Replacing an earlier, non-live build of $tag (kept at $replaced)."
    mv -- "$release_dir" "$replaced"
  fi
fi
if [[ ! -d "$release_dir" ]]; then
  mkdir "$incoming"
  tar -xzf "$archive" -C "$incoming"
  payload="$incoming/thermoiq-$tag"
  if [[ ! -f "$payload/cloud/docker-compose.yml" ]]; then
    echo "ERROR: package does not contain the expected ThermoIQ project." >&2
    exit 1
  fi
  if [[ -e "$payload/.release-sha256" ]]; then
    echo "ERROR: package contains a reserved release metadata path." >&2
    exit 1
  fi
  ln -s "$root/.env" "$payload/.env"
  ln -s "$root/data" "$payload/data"
  printf '%s\n' "$expected_hash" > "$payload/.release-sha256"
  mv -- "$payload" "$release_dir"
fi

compose_file="$release_dir/cloud/docker-compose.yml"
echo "Building $tag ..."
docker compose -f "$compose_file" build --pull

switch_current() {
  local target=$1
  local link="$root/.current-${tag}-$$"
  ln -s "$target" "$link"
  mv -Tf "$link" "$root/current"
}

wait_healthy() {
  # The compose healthcheck first runs ~30 s after start; allow up to ~2 min.
  local attempt status
  for attempt in {1..60}; do
    status=$(docker inspect --format '{{.State.Health.Status}}' pbf-temp-dashboard 2>/dev/null || true)
    if [[ "$status" == healthy ]] && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8000/; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Start the previous deployment again from its compose file. Prefer the saved
# image (fast, exact previous code); fall back to rebuilding from source.
restart_previous() {
  local compose=$1
  if (( have_rollback_image )); then
    docker tag "$rollback_image" "$image_repo:latest" &&
      docker compose -f "$compose" up -d --no-build --force-recreate &&
      return 0
    echo "WARNING: restoring the saved image failed; rebuilding the previous code." >&2
  fi
  docker compose -f "$compose" up -d --build --force-recreate
}

rollback() {
  if [[ -n "$old_target" && -d "$old_target" ]]; then
    echo "ERROR: health check failed; restoring $old_target" >&2
    switch_current "$old_target"
    if restart_previous "$root/current/cloud/docker-compose.yml" && wait_healthy; then
      echo "Previous release is healthy again." >&2
    else
      echo "ERROR: automatic rollback did not pass health checks; inspect Docker on the VPS." >&2
    fi
  elif [[ -n "$legacy_compose" ]]; then
    echo "ERROR: health check failed; restoring the pre-release deployment ($legacy_compose)." >&2
    # Remove the 'current' link so the next deploy detects the legacy install again.
    rm -f -- "$root/current"
    if restart_previous "$legacy_compose" && wait_healthy; then
      echo "Previous deployment is healthy again." >&2
    else
      echo "ERROR: automatic rollback did not pass health checks; inspect Docker on the VPS." >&2
    fi
  else
    echo "ERROR: first deployment failed health checks; stopping the new service." >&2
    docker compose -f "$compose_file" down || true
  fi
}

switch_current "$release_dir"
if ! docker compose -f "$root/current/cloud/docker-compose.yml" up -d --no-build; then
  rollback
  exit 1
fi
if ! wait_healthy; then
  rollback
  exit 1
fi

rm -f -- "$archive" "$helper"
echo "$tag is healthy at $root/current."
echo "Persistent configuration and data remain at $root/.env and $root/data."
