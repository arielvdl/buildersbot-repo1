### Changed

- Builders Bot does not check for app updates in this version. Settings → Updates says "Updates are
  not available in this version of Builders Bot yet." Before, a build with an update file read the
  release feed of the Builders Bot project and could download and install an Builders Bot release over
  Builders Bot.
- A hosted or self-installed Linux server and the Servers panel no longer ask for releases.
  `sudo buildersbot update` says that updates are not available, and the server install script stops
  before it downloads anything.
- When a server cannot update itself, Server Settings asks the host administrator for a compatible
  Builders Bot release. Before, it named the release page of the Builders Bot project. While there is no
  release feed, every server shows this text: before, a hosted, self-installed, container or shared
  Mac server said that the host installs updates.
- Container servers need an image that you built from `docker/Dockerfile` (`BUILDERSBOT_IMAGE`) and
  never pull one. `buildersbot-instance upgrade` and updates from the app are not available. Before,
  they pulled the image of the Builders Bot project.
- The Nix package is not available in this version. Before, it installed the Builders Bot release.
- The macOS Host Manager of shared Macs finds no release and installs nothing. Before, it could
  download the Builders Bot release.

### Fixed

- The Windows installer now protects the Builders Bot workspace and data folders
  (`%USERPROFILE%\Builders Bot` and `%APPDATA%\Builders Bot`). Before, it protected only the Builders Bot
  folders, so an installation in a Builders Bot data folder could lose its data at the next update.
