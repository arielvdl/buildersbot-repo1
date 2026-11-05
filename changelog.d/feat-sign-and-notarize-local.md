### Added

- `scripts/sign-and-notarize-macos.sh` signs and notarizes a local DMG in one command. The Developer
  ID identities and the notary credentials live in the login keychain with the items partitioned, so
  no step asks for a keychain password any more.
