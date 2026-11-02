#!/usr/bin/perl
# Re-applies the Builders Bot rename to a file after a merge from upstream Open Bot.
#
# The upstream project writes its own name in every case, `[Oo]pen[Bb]ot`, and this filter turns each
# shape into ours. A host becomes `buildersbot.culturabuilder.com` (a site,
# `sites.buildersbot.culturabuilder.com`). An environment prefix, `[O]PEN[B]OT_`, becomes
# `BUILDERSBOT_`. An identifier keeps no space, because shell, systemd, AppArmor, Dockerfile and C++
# names cannot hold one: a capital letter after the name, or a lowercase name, becomes
# `BuildersBot`/`buildersBot`. A standalone capitalised name is prose and becomes `Builders Bot`.
#
# A header name is `X-BuildersBot-` and a capital letter anywhere, or the published name in
# `@published` below. Add a new published header name to that list. Other text with a dash is prose
# and still becomes `Builders Bot`: the German `"[O]pen[B]ot-Website"` becomes `"Builders Bot-Website"`,
# and `im [O]pen[B]ot-Browser` and `dist/BuildersBot-Host-arm64.pkg` change too.
#
# Never pass a vendored or checksummed file through this filter: `vendor/**`, the patches and
# overrides that `native-runtime.lock.json` lists. A renamed patch no longer matches its sha256 and
# the package step fails. `scripts/native-runtime-lock-files.test.ts` fails when that happens.
#
# Usage: perl scripts/builders-bot-rename.pl < file
local $/;
my $s = <>;
my $header = "\x{1}BUILDERSBOT_HEADER\x{1}";
my @published = qw(
  Protocol-Version App-Version Capabilities Timestamp Signature Logo-Version
  Hosting-Developer-Key Host-Id Host-Token
);
my $published = join "|", map { quotemeta } @published;
my $name = "[Oo]pen[Bb]ot";
my $lower = "[o]pen[Bb]ot";
my $upper = "[O]pen[B]ot";
my $allCaps = "[O]PEN[B]OT";
$s =~ s/$name\.run/buildersbot.culturabuilder.com/g;
$s =~ s/$name\.site/sites.buildersbot.culturabuilder.com/g;
$s =~ s/$allCaps/BUILDERSBOT/g;
$s =~ s/$lower/buildersbot/g;
$s =~ s/(?<=X-)$upper(?=-[A-Z])/$header/g;
$s =~ s/(?<![A-Za-z0-9-])$upper(?=-(?:$published)\b)/$header/g;
$s =~ s/(?<=\/opt\/)$upper(?=\/)/BuildersBot/g;
$s =~ s/$upper(?=[A-Z])/BuildersBot/g;
$s =~ s/$upper(?=\.(?:exe|AppImage))/BuildersBot/g;
$s =~ s/\b$upper\b/Builders Bot/g;
$s =~ s/$upper/BuildersBot/g;
$s =~ s/\Q$header\E/BuildersBot/g;
print $s;
