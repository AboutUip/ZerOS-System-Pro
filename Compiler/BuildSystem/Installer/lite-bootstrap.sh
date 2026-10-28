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

MIRROR_FALLBACKS=(
  mirrors.ustc.edu.cn
  deb.debian.org
)

apt_update() {
  apt-get -o Acquire::Retries=5 update
}

remove_cdrom_sources() {
  local file
  for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
    [ -f "$file" ] || continue
    sed -i -E '/^[[:space:]]*(deb|deb-src)[[:space:]]+cdrom:/d' "$file" || true
    if grep -qE '^[[:space:]]*URIs:[[:space:]]*cdrom:' "$file"; then
      rm -f "$file"
    fi
  done
}

use_fallback_mirror() {
  local host="$1" file
  echo "switching apt mirror to $host"
  for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
    [ -f "$file" ] || continue
    sed -i -E "s#(https?://)(deb\.debian\.org|security\.debian\.org|mirrors\.tuna\.tsinghua\.edu\.cn|mirrors\.aliyun\.com|mirrors\.ustc\.edu\.cn)#\1$host#g" "$file" || true
  done
}

remove_cdrom_sources
use_fallback_mirror "mirrors.aliyun.com"

apt_ok=0
if apt_update; then
  apt_ok=1
fi
if [ "$apt_ok" -eq 0 ]; then
  for host in "${MIRROR_FALLBACKS[@]}"; do
    use_fallback_mirror "$host"
    if apt_update; then
      apt_ok=1
      break
    fi
  done
fi
[ "$apt_ok" -eq 1 ] || { echo "apt update failed"; exit 1; }

echo "Installing git ..."
if ! apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ca-certificates; then
  installed=0
  for host in "${MIRROR_FALLBACKS[@]}"; do
    use_fallback_mirror "$host"
    apt_update || true
    if apt-get -o Acquire::Retries=5 install -y --no-install-recommends git ca-certificates; then
      installed=1
      break
    fi
  done
  [ "$installed" -eq 1 ] || { echo "could not install git"; exit 1; }
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
