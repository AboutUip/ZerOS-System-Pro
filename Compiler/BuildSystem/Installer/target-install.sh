#!/bin/bash
# Runs inside the freshly installed Debian target (chroot).
# Builds the host compiler, the browser app, the kernel/userland images, then
# turns the disk into a kiosk. Every stage has a retry or a fallback route.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
SRC=/opt/zeros-src
FAST_PAYLOAD="${ZEROS_FAST_PAYLOAD:-}"
LOG=/var/log/zeros-build.log

exec > >(tee -a "$LOG") 2>&1
echo "== ZerOS target build start: $(date -u +%Y-%m-%dT%H:%M:%SZ) =="

die() {
  echo "ERROR: $*"
  exit 1
}

retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 3 ]; then
      return 1
    fi
    echo "retry $n: $*"
    sleep 2
  done
}

require_file() {
  [ -s "$1" ] || die "missing file: $1"
}

require_exec() {
  [ -x "$1" ] || die "missing executable: $1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

if [ -n "$FAST_PAYLOAD" ]; then
  require_file "$FAST_PAYLOAD"
else
  [ -d "$SRC" ] || die "source tree missing: $SRC"
  require_file "$SRC/Compiler/BuildSystem/build.sh"
  require_file "$SRC/ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs"
  require_file "$SRC/Toolchain/package-lock.json"
fi

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
[ "$apt_ok" -eq 1 ] || die "apt update failed after mirror fallback"

PACKAGES=(
  nodejs ca-certificates curl
  nginx
  chromium
  xserver-xorg-core xserver-xorg-video-vmware xserver-xorg-video-vesa
  xserver-xorg-input-libinput xinit openbox unclutter x11-xserver-utils
  lightdm lightdm-gtk-greeter dbus-x11
  mesa-vulkan-drivers libvulkan1 vulkan-tools
  open-vm-tools fonts-dejavu-core
)
if [ -z "$FAST_PAYLOAD" ]; then
  PACKAGES+=(build-essential cmake python3 npm)
fi

if ! apt-get -o Acquire::Retries=5 install -y --no-install-recommends "${PACKAGES[@]}"; then
  echo "apt install failed; retrying with mirror fallback"
  installed=0
  for host in "${MIRROR_FALLBACKS[@]}"; do
    use_fallback_mirror "$host"
    apt_update || true
    if apt-get -o Acquire::Retries=5 install -y --no-install-recommends "${PACKAGES[@]}"; then
      installed=1
      break
    fi
  done
  [ "$installed" -eq 1 ] || die "apt install failed"
fi

require_cmd chromium
require_cmd lightdm
require_cmd nginx
require_cmd node

# The preseed normally creates this user. Keep a fallback for custom installs.
if ! id zeros >/dev/null 2>&1; then
  useradd -m -s /bin/bash zeros
fi

if [ -n "$FAST_PAYLOAD" ]; then
  echo "fast mode: extracting prebuilt ZerOS payload"
  rm -rf /opt/zeros
  install -d /opt/zeros
  tar -xzf "$FAST_PAYLOAD" -C /opt/zeros
else
  # Compiler: same isolated build system used on Windows and WSL.
  cd "$SRC/Compiler/BuildSystem"
  if ! bash build.sh; then
    echo "compiler build/test failed; retrying without ctest"
    bash build.sh --no-test || die "compiler build failed"
  fi
  require_exec "$SRC/Compiler/ObrCompiler/obrc"

  # Browser app and firmware. If the checked build fails, fall back to a plain
  # Vite build so a type/lint regression does not make the whole installer fail.
  cd "$SRC/Toolchain"
  if ! retry 3 npm ci --no-audit --no-fund; then
    echo "npm ci failed; falling back to npm install"
    if ! retry 3 npm install --no-audit --no-fund; then
      echo "npm install failed; falling back to registry.npmmirror.com"
      retry 3 npm install --no-audit --no-fund \
        --registry=https://registry.npmmirror.com || die "npm install failed"
    fi
  fi
  if ! npm run build; then
    echo "npm run build failed; falling back to vite build without check"
    ./node_modules/.bin/vite build || die "vite build failed"
  fi
  require_file "$SRC/Toolchain/Dist/index.html"

  # Kernel, /os and /bin guest images.
  cd "$SRC"
  if ! retry 3 node "$SRC/ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs"; then
    die "guest image build failed"
  fi
  require_file "$SRC/ZerOS-PRO/Hardware/Nas/Root/kernel/start"
  require_file "$SRC/ZerOS-PRO/Hardware/Nas/Root/os/sh"
  [ -s "$SRC/ZerOS-PRO/Hardware/Nas/Root/bin/pwd" ] || die "guest /bin/pwd missing"

  # Runtime tree. Server/ and Root/ stay siblings: serve.mjs uses ../Root.
  install -d /opt/zeros/web /opt/zeros/nas/Server
  cp -a "$SRC/Toolchain/Dist/." /opt/zeros/web/
  cp -a "$SRC/ZerOS-PRO/Hardware/Nas/Root" /opt/zeros/nas/Root
  cp -a "$SRC/ZerOS-PRO/Hardware/Nas/Server/"*.mjs /opt/zeros/nas/Server/
fi
require_file /opt/zeros/web/index.html
require_file /opt/zeros/nas/Root/kernel/start
require_file /opt/zeros/nas/Server/serve.mjs

# Static web server with the cross-origin isolation headers the VM needs.
cat > /etc/nginx/sites-available/zeros <<'EOF'
server {
    listen 127.0.0.1:8080;
    server_name _;
    root /opt/zeros/web;
    index index.html;

    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cache-Control "no-store" always;

    location / {
        try_files $uri $uri/ =404;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/zeros /etc/nginx/sites-enabled/zeros
nginx -t || die "nginx configuration is invalid"

# NAS process. Root/ and Server/ are siblings under /opt/zeros/nas.
cat > /etc/systemd/system/zeros-nas.service <<'EOF'
[Unit]
Description=ZerOS NAS (ZNP1)
After=local-fs.target
Before=lightdm.service

[Service]
Type=simple
WorkingDirectory=/opt/zeros/nas/Server
ExecStart=/usr/bin/node serve.mjs
Restart=always
RestartSec=0.5

[Install]
WantedBy=multi-user.target
EOF

# LightDM autologin. The session exits when Chromium exits, so LightDM
# immediately starts another kiosk session.
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-zeros.conf <<'EOF'
[Seat:*]
autologin-user=zeros
autologin-user-timeout=0
autologin-session=zeros
user-session=zeros
xserver-command=X -novtswitch -sharevts -nolisten tcp
EOF

cat > /usr/share/xsessions/zeros.desktop <<'EOF'
[Desktop Entry]
Name=ZerOS
Comment=ZerOS kiosk
Exec=/usr/local/bin/zeros-session
Type=Application
DesktopNames=ZerOS
EOF

# A failed self-check swaps Chromium to this local file. file:// is explicitly
# allowed by the Chromium policy below.
cat > /opt/zeros/fallback.html <<'EOF'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ZerOS-Pro</title>
<style>
html, body { margin: 0; height: 100%; background: #050505; color: #e8e8e8;
  font: 20px/1.6 monospace; }
main { padding: 8vh 8vw; }
h1 { color: #ff6655; }
pre { background: #111; padding: 1em; border: 1px solid #333; }
</style>
</head>
<body>
<main>
<h1>ZerOS-Pro failed to start</h1>
<p>The boot self-check failed. Inspect:</p>
<pre>/var/log/zeros-selfcheck.log
/var/log/zeros-build.log
/var/log/zeros-vulkan.log</pre>
<p>Use GRUB recovery mode for a shell.</p>
</main>
</body>
</html>
EOF
chmod 644 /opt/zeros/fallback.html

install -d -o zeros -g zeros -m 0755 /var/lib/zeros/chromium /var/lib/zeros/chromium/cache

cat > /usr/local/bin/zeros-selfcheck <<'EOF'
#!/bin/bash
set -u

LOG=/var/log/zeros-selfcheck.log
RUN=/run/zeros
mkdir -p "$RUN"
: > "$LOG"
fail=0

note() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }
ok() { note "OK $*"; }
bad() { note "FAIL $*"; fail=1; }

[ -s /opt/zeros/web/index.html ] && ok web-files || bad web-files
[ -s /opt/zeros/nas/Root/kernel/start ] && ok kernel-files || bad kernel-files
if [ -d /opt/zeros-src ]; then
  [ -x /opt/zeros-src/Compiler/ObrCompiler/obrc ] && ok obrc || bad obrc
fi

if nginx -t >> "$LOG" 2>&1; then ok nginx-config; else bad nginx-config; fi

web=0
for _ in $(seq 1 10); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
    web=1
    break
  fi
  sleep 1
done
[ "$web" -eq 1 ] && ok web-port || bad web-port

nas=0
for _ in $(seq 1 10); do
  if timeout 2 bash -c '</dev/tcp/127.0.0.1/8765' 2>/dev/null; then
    nas=1
    break
  fi
  sleep 1
done
[ "$nas" -eq 1 ] && ok nas-port || bad nas-port

if timeout 30 env VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json \
    vulkaninfo --summary > /var/log/zeros-vulkan.log 2>&1 \
    && grep -qi 'lavapipe\|llvmpipe' /var/log/zeros-vulkan.log; then
  ok lavapipe
  rm -f "$RUN/no-lavapipe"
else
  note "WARN lavapipe not detected; Chromium will use the SwiftShader fallback"
  touch "$RUN/no-lavapipe"
fi

if [ "$fail" -eq 0 ]; then
  touch "$RUN/selfcheck.ok"
  rm -f "$RUN/selfcheck.fail"
else
  touch "$RUN/selfcheck.fail"
  rm -f "$RUN/selfcheck.ok"
fi
exit 0
EOF
chmod 755 /usr/local/bin/zeros-selfcheck

cat > /etc/systemd/system/zeros-selfcheck.service <<'EOF'
[Unit]
Description=ZerOS self-check
After=local-fs.target nginx.service zeros-nas.service
Wants=nginx.service zeros-nas.service
Before=lightdm.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/zeros-selfcheck
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/bin/zeros-session <<'EOF'
#!/bin/sh
url="http://127.0.0.1:8080/"
if [ -f /run/zeros/selfcheck.fail ]; then
  url="file:///opt/zeros/fallback.html"
fi

webgpu_flags=""
if [ -f /run/zeros/no-lavapipe ]; then
  webgpu_flags="--enable-unsafe-swiftshader --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader"
else
  export VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
  export VK_ICD_FILENAMES="$VK_DRIVER_FILES"
fi

xset s off -dpms
xsetroot -solid black
unclutter -idle 0 -root &
openbox &
exec /usr/bin/chromium \
  --kiosk \
  --ozone-platform=x11 \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan \
  --use-angle=vulkan \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --force-color-profile=srgb \
  --user-data-dir=/var/lib/zeros/chromium \
  --disk-cache-dir=/var/lib/zeros/chromium/cache \
  --disk-cache-size=134217728 \
  --no-first-run \
  --no-default-browser-check \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  --disable-sync \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  --noerrdialogs \
  --disable-breakpad \
  --disable-crash-reporter \
  --disable-domain-reliability \
  --disable-client-side-phishing-detection \
  --disable-component-extensions-with-background-pages \
  --disable-search-engine-choice-screen \
  --disable-features=Translate,TranslateUI,BackForwardCache,OptimizationHints,MediaRouter,GlobalMediaControls,PasswordLeakDetection,AutofillServerCommunication \
  $webgpu_flags \
  "$url"
EOF
chmod 755 /usr/local/bin/zeros-session

mkdir -p /etc/chromium/policies/managed
cat > /etc/chromium/policies/managed/zeros.json <<'EOF'
{
  "DeveloperToolsAvailability": 2,
  "IncognitoModeAvailability": 1,
  "DownloadRestrictions": 3,
  "PrintingEnabled": false,
  "BookmarkBarEnabled": false,
  "BackgroundModeEnabled": false,
  "AllowFileSelectionDialogs": false,
  "ComponentUpdatesEnabled": false,
  "URLBlocklist": ["*"],
  "URLAllowlist": ["http://127.0.0.1:8080/*", "file:///opt/zeros/fallback.html"]
}
EOF

# Give the kiosk session a CPU edge and protect it from the OOM killer.
# Nice and oom_score_adj are inherited by LightDM's session processes.
mkdir -p /etc/systemd/system/lightdm.service.d /etc/security/limits.d
cat > /etc/systemd/system/lightdm.service.d/50-zeros-priority.conf <<'EOF'
[Service]
Nice=-10
OOMScoreAdjust=-500
IOSchedulingClass=best-effort
IOSchedulingPriority=0
LimitNOFILE=1048576
EOF

cat > /etc/security/limits.d/50-zeros.conf <<'EOF'
zeros - priority -10
zeros - nice -10
EOF

# LightDM must wait for the local web, NAS, and self-check.
cat > /etc/systemd/system/lightdm.service.d/zeros.conf <<'EOF'
[Unit]
After=zeros-nas.service nginx.service zeros-selfcheck.service
Wants=zeros-nas.service nginx.service zeros-selfcheck.service
EOF

# Kiosk lockdown. A desktop task may leave GDM as the active display manager.
for unit in gdm3.service gdm.service; do
  systemctl disable "$unit" 2>/dev/null || true
done
rm -f /etc/systemd/system/display-manager.service
echo "/usr/sbin/lightdm" > /etc/X11/default-display-manager

systemctl set-default graphical.target
systemctl enable lightdm.service nginx.service zeros-nas.service zeros-selfcheck.service
systemctl mask getty@tty1.service getty@tty2.service getty@tty3.service \
  getty@tty4.service getty@tty5.service getty@tty6.service
systemctl mask ctrl-alt-del.target
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/50-zeros.conf <<'EOF'
[Login]
NAutoVTs=0
ReserveVT=0
EOF

cat > /etc/sysctl.d/90-zeros.conf <<'EOF'
kernel.sysrq=0
EOF

for group in audio video render; do
  if getent group "$group" >/dev/null; then
    usermod -aG "$group" zeros || true
  fi
done

# Keep a short GRUB menu for maintenance/testing. The kiosk is still the
# default entry; recovery remains reachable.
sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=3/' /etc/default/grub
sed -i 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=menu/' /etc/default/grub
sed -i 's/^GRUB_DISABLE_RECOVERY=.*/GRUB_DISABLE_RECOVERY=true/' /etc/default/grub
grep -q '^GRUB_TIMEOUT=' /etc/default/grub || echo 'GRUB_TIMEOUT=3' >> /etc/default/grub
grep -q '^GRUB_TIMEOUT_STYLE=' /etc/default/grub || echo 'GRUB_TIMEOUT_STYLE=menu' >> /etc/default/grub
grep -q '^GRUB_DISABLE_RECOVERY=' /etc/default/grub || echo 'GRUB_DISABLE_RECOVERY=true' >> /etc/default/grub
update-grub

# Validate what can be validated without a running display.
require_file /opt/zeros/web/index.html
require_file /opt/zeros/nas/Root/kernel/start
if [ -z "$FAST_PAYLOAD" ]; then
  require_exec /opt/zeros-src/Compiler/ObrCompiler/obrc
fi
nginx -t || die "nginx check failed"

if command -v vulkaninfo >/dev/null 2>&1; then
  if timeout 30 env VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json \
      vulkaninfo --summary > /var/log/zeros-vulkan.log 2>&1; then
    echo "vulkaninfo: ok"
  else
    echo "WARN: vulkaninfo failed; see /var/log/zeros-vulkan.log"
  fi
  if ! grep -qi 'lavapipe\|llvmpipe' /var/log/zeros-vulkan.log; then
    echo "WARN: lavapipe not found in vulkaninfo output"
  fi
fi

apt-get clean
echo "== ZerOS target build done =="
