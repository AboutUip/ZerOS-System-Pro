#!/bin/bash
# Lite install path: no ZerOS source in the ISO.
# Installs git, clones the repository, applies the small overlay for files that
# are not in git yet, then hands off to the normal target installer.
set -euo pipefail

LOG=/var/log/zeros-bootstrap.log
GIT_URL="${ZEROS_GIT_URL:-https://github.com/AboutUip/ZerOS-System-Pro.git}"
GIT_REF="${ZEROS_GIT_REF:-main}"
DEST=/opt/zeros-src
OVERLAY=/opt/zeros-overlay.tar.gz

exec > >(tee -a "$LOG") 2>&1
echo "== ZerOS lite bootstrap start: $(date -u +%Y-%m-%dT%H:%M:%SZ) =="

apt_update() {
  apt-get -o Acquire::Retries=5 update
}

use_fallback_mirror() {
  echo "switching apt mirror to deb.debian.org"
  for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$file" ] || continue
    sed -i 's|mirrors.tuna.tsinghua.edu.cn|deb.debian.org|g' "$file" || true
  done
}

if ! apt_update; then
  use_fallback_mirror
  apt_update || { echo "apt update failed"; exit 1; }
fi

echo "Installing git ..."
if ! apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ca-certificates; then
  use_fallback_mirror
  apt_update || true
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ca-certificates \
    || { echo "could not install git"; exit 1; }
fi

echo "Cloning $GIT_URL ($GIT_REF) ..."
rm -rf "$DEST"
if ! git clone --depth 1 --branch "$GIT_REF" "$GIT_URL" "$DEST"; then
  echo "branch clone failed; retrying default branch"
  rm -rf "$DEST"
  git clone --depth 1 "$GIT_URL" "$DEST" || { echo "git clone failed"; exit 1; }
fi

echo "Applying build-system overlay ..."
[ -s "$OVERLAY" ] || { echo "missing overlay: $OVERLAY"; exit 1; }
tar -xzf "$OVERLAY" -C "$DEST"

[ -f "$DEST/Compiler/BuildSystem/Installer/target-install.sh" ] \
  || { echo "target installer missing after clone/overlay"; exit 1; }

echo "Handing off to target installer ..."
exec bash "$DEST/Compiler/BuildSystem/Installer/target-install.sh"
