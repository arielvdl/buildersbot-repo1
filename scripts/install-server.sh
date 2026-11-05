#!/bin/bash
# Installs Builders Bot as a self-hosted server on a Linux computer with no screen:
#
#   sudo bash scripts/install-server.sh
#
# Options (after `sudo bash -s --`):
#   --user <name>             The user that runs Builders Bot and its agents. Default: the user of the
#                             installed server, else buildersbot, which the install makes when it does
#                             not exist.
#   --auth-api-url <origin>   Another account server, for development. Default: the one of the
#                             installed server, else the one in the build.
#   --display-size <W>x<H>    The size of the virtual display that computer use reads, from 640x480
#                             to 2576x2576. Default: the one of the installed server, else 1280x800.
#
# This file only downloads the latest release and checks it against the release manifest, the
# manifest that the Linux desktop updater reads. The install steps come from that release
# (resources/hosting/buildersbot-server-setup), so they always match the build that they install.
# See docs/self-hosted-server.md.
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

# The release feed. Builders Bot has no release feed yet, so the install stops before it downloads
# anything. Never set it to the upstream Builders Bot releases: they would install Builders Bot as root.
RELEASES=""
service_user=""
auth_api_url=""
display_size=""

fail() {
  echo "$*" >&2
  exit 1
}

fetch() {
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --retry 3 "$@"
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --user)
      [ "$#" -ge 2 ] || fail "Add a user name after --user."
      service_user=$2
      shift 2
      ;;
    --auth-api-url)
      [ "$#" -ge 2 ] || fail "Add a URL after --auth-api-url."
      auth_api_url=$2
      shift 2
      ;;
    --display-size)
      [ "$#" -ge 2 ] || fail "Add a size, such as 1920x1080, after --display-size."
      display_size=$2
      shift 2
      ;;
    -h | --help)
      sed -n '2,18p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[ -n "$RELEASES" ] || fail "The Builders Bot server install is not available in this version. Nothing was downloaded."

[ "$(uname -s)" = Linux ] || fail "This install is for Linux. Download the desktop app at https://buildersbot.culturabuilder.com."
[ "$(id -u)" -eq 0 ] || fail "Run this with sudo."
[ -d /run/systemd/system ] || fail "Builders Bot needs systemd."
command -v apt-get >/dev/null || fail "Builders Bot needs Ubuntu 24.04 or a newer Ubuntu or Debian."
# shellcheck disable=SC1091
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  echo "Builders Bot is tested on Ubuntu 24.04. This is ${PRETTY_NAME:-an unknown system}; the install continues." >&2
fi
case $(uname -m) in
  x86_64) architecture=x86_64 manifest=latest-linux.yml ;;
  aarch64) architecture=arm64 manifest=latest-linux-arm64.yml ;;
  *) fail "Builders Bot has no release for this machine." ;;
esac

missing=()
for command in curl openssl; do command -v "$command" >/dev/null || missing+=("$command"); done
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get -o DPkg::Lock::Timeout=600 update
  apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends ca-certificates "${missing[@]}"
fi

work=$(mktemp -d /var/tmp/buildersbot-install.XXXXXX)
trap 'rm -rf "$work"' EXIT
manifest=$(fetch "$RELEASES/latest/download/$manifest")
version=$(sed -n 's/^version: *//p' <<<"$manifest" | head -n 1)
path=$(sed -n 's/^path: *//p' <<<"$manifest" | head -n 1)
sha512=$(sed -n 's/^sha512: *//p' <<<"$manifest" | head -n 1)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The release manifest has no valid version."
# A manifest written before the rename names `BuildersBot-...`. Both are the same file.
case $path in
  "Builders Bot-$version-$architecture.AppImage" | "BuildersBot-$version-$architecture.AppImage") ;;
  *) fail "The release manifest names another file." ;;
esac
[[ $sha512 =~ ^[A-Za-z0-9+/]{86}==$ ]] || fail "The release manifest has no valid SHA-512."

echo "Downloading Builders Bot $version..."
fetch --output "$work/BuildersBot.AppImage" "$RELEASES/download/v$version/$path"
[ "$(openssl dgst -sha512 -binary "$work/BuildersBot.AppImage" | openssl base64 -A)" = "$sha512" ] ||
  fail "The download does not match the release manifest."
chmod 0700 "$work/BuildersBot.AppImage"
(cd "$work" && ./BuildersBot.AppImage --appimage-extract >/dev/null)

setup="$work/squashfs-root/resources/hosting/buildersbot-server-setup"
[ -f "$setup" ] || fail "Builders Bot $version cannot install as a server. Try again after the next release."
# A release before --display-size refuses a fourth argument.
if [ -n "$display_size" ] && ! grep -q BUILDERSBOT_DISPLAY_SIZE "$setup"; then
  fail "Builders Bot $version has no --display-size. Install without it, or try again after the next release."
fi
bash "$setup" "$service_user" "$work/squashfs-root" "$auth_api_url" ${display_size:+"$display_size"}

cat <<'EOF'

Next, sign in with your Builders Bot account:

  sudo buildersbot login

Other commands: buildersbot status, buildersbot logs, sudo buildersbot update. Run "buildersbot help" for all.
EOF
