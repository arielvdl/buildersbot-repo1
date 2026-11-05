#!/usr/bin/perl
# Re-applies the Builders Bot rename to a file after a merge from upstream Builders Bot.
#
# The clone keeps the upstream project name in package scopes, file names, URL schemes
# and environment variables, and uses Builders Bot in identifiers and in prose. So the
# rule is narrow on purpose: an `BuildersBot` that continues into a capital letter is an
# identifier and becomes `BuildersBot`; a standalone `BuildersBot` is prose and becomes
# `Builders Bot`. Lowercase `buildersbot` and `BUILDERSBOT_` stay as they are.
#
# HTTP header names keep `BuildersBot`: a header name cannot hold a space, and `fetch`, `Headers`
# and Node refuse a name with a space before they send anything. Released hosts, phones
# and the Worker also read the upstream names. A header name is `X-BuildersBot-` and a capital
# letter anywhere, or `BuildersBot-` and one of the published names in `@published` below
# (`"BuildersBot-Timestamp"`). Add a new published header name to that list.
# Other text with a dash is prose and is still renamed, also in quotes: the German
# `"BuildersBot-Website"` becomes `"Builders Bot-Website"`, and `im BuildersBot-Browser` and
# `dist/BuildersBot-Host-arm64.pkg` change too.
#
# Never pass a vendored or checksummed file through this filter: `vendor/**`, the patches and
# overrides that `native-runtime.lock.json` lists. A renamed patch no longer matches its sha256 and
# the package step fails. `scripts/native-runtime-lock-files.test.ts` fails when that happens.
#
# The Linux server and its Docker image also keep the install folder and the AppImage file that
# docker/Dockerfile copies: unquoted shell, systemd units, AppArmor profiles and Dockerfile lines use
# them, and a space breaks each of these. The upstream names stay in the list too, so a merge from
# upstream keeps `/opt/BuildersBot` and `BuildersBot.AppImage`, which the install folder's symlink and the
# migration still answer. scripts/check-linux-image-names.ts reads this list.
#
# Usage: perl scripts/builders-bot-rename.pl < file
local $/;
my $s = <>;
my $header = "\x{1}BUILDERSBOT_HEADER\x{1}";
my @published = qw(
  Protocol-Version App-Version Capabilities Timestamp Signature Logo-Version
  Hosting-Developer-Key Host-Id Host-Token
);
my @kept_paths = ("/opt/BuildersBot", "BuildersBot.AppImage", "/opt/BuildersBot", "BuildersBot.AppImage");
my $published = join "|", map { quotemeta } @published;
for my $index (0 .. $#kept_paths) {
  my $path = quotemeta $kept_paths[$index];
  $s =~ s/(?<![A-Za-z0-9])$path(?![A-Za-z0-9])/\x{1}BUILDERSBOT_PATH_$index\x{1}/g;
}
$s =~ s/(?<=X-)BuildersBot(?=-[A-Z])/$header/g;
$s =~ s/(?<![A-Za-z0-9-])BuildersBot(?=-(?:$published)\b)/$header/g;
$s =~ s/BuildersBot(?=[A-Z])/BuildersBot/g;
$s =~ s/\bBuildersBot\b/Builders Bot/g;
$s =~ s/\Q$header\E/BuildersBot/g;
$s =~ s/\x{1}BUILDERSBOT_PATH_(\d+)\x{1}/$kept_paths[$1]/g;
print $s;
