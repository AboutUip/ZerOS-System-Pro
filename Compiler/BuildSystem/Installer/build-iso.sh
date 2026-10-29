#!/bin/bash
# Build the ZerOS installer ISO from a Debian netinst image.
# Runs on Linux/WSL. All host paths are derived from this script's location.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="$HERE/work"
OUT="$HERE/out"
LOGO="$HERE/assets/zeros-pro.png"
LOGO_GRUB="$HERE/assets/zeros-pro-grub.png"
NETINST_NAME="debian-13.7.0-amd64-netinst.iso"
NETINST_URLS=(
  "https://deb.debian.org/debian-cd/current/amd64/iso-cd/$NETINST_NAME"
  "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$NETINST_NAME"
  "https://mirrors.tuna.tsinghua.edu.cn/debian-cd/current/amd64/iso-cd/$NETINST_NAME"
)
SHA_URLS=(
  "https://deb.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS"
  "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS"
  "https://mirrors.tuna.tsinghua.edu.cn/debian-cd/current/amd64/iso-cd/SHA256SUMS"
)
NETINST="$WORK/$NETINST_NAME"
SHA_FILE="$WORK/SHA256SUMS"
ISO="$OUT/zeros-standard-amd64.iso"
TARGET="$HERE/target-install.sh"
PRESEED_SRC="$HERE/preseed.cfg"
SRC_TAR="$WORK/zeros/src.tar.gz"

die() {
  echo "error: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

need xorriso
need curl
need openssl
need tar
need gzip
need sha256sum
need stat
need awk
need grep

mkdir -p "$WORK/zeros" "$OUT"

fetch_sha() {
  if [[ -s "$SHA_FILE" ]]; then
    return 0
  fi
  echo "Fetching SHA256SUMS ..."
  local url
  for url in "${SHA_URLS[@]}"; do
    rm -f "$SHA_FILE"
    if curl -L --fail --retry 2 --connect-timeout 20 --max-time 120 -o "$SHA_FILE" "$url"; then
      return 0
    fi
  done
  return 0
}

verify_netinst() {
  local expected actual size
  [[ -s "$NETINST" ]] || return 1
  size="$(stat -c%s "$NETINST" 2>/dev/null || echo 0)"
  [[ "$size" -gt 500000000 ]] || return 1
  [[ -s "$SHA_FILE" ]] || {
    echo "warning: SHA256SUMS unavailable; checked size only" >&2
    return 0
  }
  expected="$(awk -v n="$NETINST_NAME" '$2 == n { print $1; exit }' "$SHA_FILE")"
  if [[ -z "$expected" ]]; then
    echo "warning: $NETINST_NAME not listed in SHA256SUMS" >&2
    return 0
  fi
  actual="$(sha256sum "$NETINST" | awk '{ print $1 }')"
  [[ "$expected" == "$actual" ]]
}

download_netinst() {
  local url
  for url in "${NETINST_URLS[@]}"; do
    echo "Downloading $url"
    rm -f "$NETINST"
    if curl -L --fail --retry 3 --connect-timeout 20 --max-time 1800 \
        -o "$NETINST" "$url"; then
      if verify_netinst; then
        echo "netinst verified"
        return 0
      fi
      echo "verification failed: $url" >&2
    fi
  done
  return 1
}

fetch_sha
if [[ -s "$NETINST" ]] && ! verify_netinst; then
  echo "Existing netinst failed verification; removing it." >&2
  rm -f "$NETINST"
fi
if [[ ! -s "$NETINST" ]]; then
  download_netinst || die "could not download a verified Debian netinst"
fi

echo "Building source archive ..."
build_source() {
  rm -rf "$WORK/zeros"
  mkdir -p "$WORK/zeros"
  tar -C "$REPO" \
    --exclude='./.git' \
    --exclude='./.cursor' \
    --exclude='./Compiler/BuildSystem/Installer/work' \
    --exclude='./Compiler/BuildSystem/Installer/out' \
    --exclude='./Toolchain/node_modules' \
    --exclude='./Toolchain/Dist' \
    --exclude='./Toolchain/Zap' \
    --exclude='./ZerOS-PRO/Hardware/Nas/Root' \
    --exclude='./Compiler/ObrCompiler/build' \
    --exclude='./Compiler/BuildSystem/build' \
    --exclude='./Compiler/BuildSystem/out' \
    --exclude='./Compiler/ObrCompiler/obrc' \
    --exclude='*.exe' \
    --exclude='*.o' \
    --exclude='*.obj' \
    --exclude='*.zap' \
    --exclude='*.pdb' \
    --exclude='*.ilk' \
    --exclude='*.exp' \
    --exclude='*.vsix' \
    -czf "$SRC_TAR" .
}
if ! build_source; then
  echo "tar failed; retrying source archive once" >&2
  build_source || die "could not build source archive"
fi

SRC_LIST="$WORK/src-list.txt"
tar -tzf "$SRC_TAR" > "$SRC_LIST" || die "could not list source archive"

for path in \
  ./Compiler/BuildSystem/Installer/target-install.sh \
  ./Compiler/BuildSystem/build.sh \
  ./Compiler/ObrCompiler/src/obrc.cpp \
  ./ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs \
  ./ZerOS-PRO/Resource/Bin/pwd.obr \
  ./ZerOS-PRO/Resource/Font/sarasa-mono-sc.ttf \
  ./Toolchain/package-lock.json \
  ./Toolchain/vite.config.ts \
  ./eslint.config.js; do
  if ! grep -Fqx -- "$path" "$SRC_LIST"; then
    die "source archive is missing $path"
  fi
done

if grep -qE \
    '(^|/)node_modules/|^\./ZerOS-PRO/Hardware/Nas/Root/|^\./Toolchain/(Dist|Zap)/|^\./Compiler/ObrCompiler/build/|^\./Compiler/BuildSystem/(build|out)/|^\./Compiler/BuildSystem/Installer/(work|out)/' \
    "$SRC_LIST"; then
  die "source archive contains ignored build output"
fi

bash -n "$TARGET" || die "target-install.sh has a syntax error"

echo "Preparing preseed ..."
HASH="$(openssl passwd -6 -salt zeros zeros)"
sed "s|__ZEROS_PASSWORD_HASH__|$HASH|g" "$PRESEED_SRC" > "$WORK/preseed.cfg"
grep -q '__ZEROS_PASSWORD_HASH__' "$WORK/preseed.cfg" && die "preseed password placeholder was not replaced"
grep -q 'target-install.sh' "$WORK/preseed.cfg" || die "preseed does not call target-install.sh"

echo "Extracting boot configuration ..."
rm -f "$WORK/isolinux.cfg" "$WORK/grub.cfg"
xorriso -osirrox on -indev "$NETINST" \
  -extract /isolinux/isolinux.cfg "$WORK/isolinux.cfg" \
  -extract /boot/grub/grub.cfg "$WORK/grub.cfg" >/dev/null
[[ -s "$WORK/isolinux.cfg" ]] || die "isolinux.cfg missing from netinst"
[[ -s "$WORK/grub.cfg" ]] || die "grub.cfg missing from netinst"
chmod u+w "$WORK/isolinux.cfg" "$WORK/grub.cfg"

cat > "$WORK/isolinux.cfg" <<'EOF'
ui vesamenu.c32
menu title ZerOS-Pro Installer
menu background splash.png
menu color title * #ff4d3dff *
menu color border * #00000000 #00000000 none
menu color sel * #ffffffff #ff4d3dff *
menu color hotsel 1;7;37;40 #ffffffff #ff4d3dff *
menu color tabmsg * #ffffffff #00000000 *
menu color help 37;40 #ffdddd00 #00000000 none
menu vshift 10
menu rows 8
menu helpmsgrow 14
menu cmdlinerow 16
menu timeoutrow 16
menu tabmsgrow 18
menu tabmsg Press ENTER to install ZerOS-Pro
prompt 0
timeout 50
default zeros
label zeros
  menu label ^Install ZerOS-Pro (erases disk)
  kernel /install.amd/vmlinuz
  append auto=true priority=critical preseed/file=/cdrom/preseed.cfg vga=788 initrd=/install.amd/initrd.gz --- quiet
EOF
grep -q '^default zeros' "$WORK/isolinux.cfg" || die "isolinux default was not set"
grep -q '^timeout 50' "$WORK/isolinux.cfg" || die "isolinux timeout was not set"
grep -q 'preseed/file=/cdrom/preseed.cfg' "$WORK/isolinux.cfg" || die "isolinux preseed path missing"

cat > "$WORK/grub.cfg" <<'EOF'
set default="0"
set timeout=5
if loadfont $prefix/font.pf2 ; then
  set gfxmode=800x600
  set gfxpayload=keep
  insmod efi_gop
  insmod efi_uga
  insmod video_bochs
  insmod video_cirrus
  insmod gfxterm
  terminal_output gfxterm
fi
insmod png
if background_image /boot/grub/zeros-pro.png; then
  set color_normal=light-gray/black
  set menu_color_normal=white/black
  set menu_color_highlight=black/light-gray
fi
menuentry 'Install ZerOS-Pro (erases disk)' {
    set background_color=black
    linux /install.amd/vmlinuz auto=true priority=critical preseed/file=/cdrom/preseed.cfg vga=788 --- quiet
    initrd /install.amd/initrd.gz
}
EOF
grep -q "menuentry 'Install ZerOS-Pro" "$WORK/grub.cfg" || die "grub ZerOS-Pro entry missing"
grep -q 'preseed/file=/cdrom/preseed.cfg' "$WORK/grub.cfg" || die "grub preseed path missing"

remaster() {
  local mode="$1"
  rm -f "$ISO"
  xorriso -indev "$NETINST" -outdev "$ISO" \
    -volid ZEROS_PRO \
    -map "$WORK/preseed.cfg" /preseed.cfg \
    -map "$WORK/zeros" /zeros \
    -map "$WORK/isolinux.cfg" /isolinux/isolinux.cfg \
    -map "$WORK/grub.cfg" /boot/grub/grub.cfg \
    -map "$LOGO" /isolinux/splash.png \
    -map "$LOGO_GRUB" /boot/grub/zeros-pro.png \
    -boot_image any "$mode"
}

boot_ok() {
  xorriso -indev "$ISO" -report_el_torito plain 2>/dev/null > "$WORK/boot-report.txt" || return 1
  grep -q 'El Torito boot img.*BIOS' "$WORK/boot-report.txt" \
    && grep -q 'El Torito boot img.*UEFI' "$WORK/boot-report.txt"
}

echo "Remastering ISO ..."
if ! remaster replay || ! boot_ok; then
  echo "boot replay failed; trying -boot_image any keep" >&2
  if ! remaster keep || ! boot_ok; then
    die "remaster did not produce a BIOS+UEFI bootable ISO"
  fi
fi

echo "Checking boot catalog ..."
grep -E 'El Torito (boot img|catalog)' "$WORK/boot-report.txt"

echo "Checking injected files ..."
rm -f "$WORK/verify-preseed.cfg" "$WORK/verify-isolinux.cfg" \
  "$WORK/verify-grub.cfg" "$WORK/verify-src.tar.gz"
xorriso -osirrox on -indev "$ISO" \
  -extract /preseed.cfg "$WORK/verify-preseed.cfg" \
  -extract /isolinux/isolinux.cfg "$WORK/verify-isolinux.cfg" \
  -extract /boot/grub/grub.cfg "$WORK/verify-grub.cfg" \
  -extract /zeros/src.tar.gz "$WORK/verify-src.tar.gz" >/dev/null

grep -q 'Compiler/BuildSystem/Installer/target-install.sh' "$WORK/verify-preseed.cfg" \
  || die "ISO preseed points at the wrong target script"
grep -q '^default zeros' "$WORK/verify-isolinux.cfg" \
  || die "ISO isolinux default is wrong"
grep -q "menuentry 'Install ZerOS" "$WORK/verify-grub.cfg" \
  || die "ISO grub menu is missing the ZerOS entry"
tar -tzf "$WORK/verify-src.tar.gz" > "$WORK/verify-src-list.txt" \
  || die "could not list ISO source archive"
grep -Fqx -- './Compiler/BuildSystem/Installer/target-install.sh' \
  "$WORK/verify-src-list.txt" \
  || die "ISO source archive is missing target-install.sh"

echo "Self-check OK; writing checksum ..."
sha256sum "$ISO" > "$ISO.sha256"

echo
echo "ISO: out/$(basename "$ISO")"
echo "SHA256: $(awk '{ print $1 }' "$ISO.sha256")"
echo "Source archive: work/zeros/src.tar.gz"
echo "Preseed: work/preseed.cfg"
ls -lh "$ISO" "$ISO.sha256" "$SRC_TAR"
