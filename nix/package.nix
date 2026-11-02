# Builders Bot from its release: the AppImage on Linux and the app ZIP on macOS.
#
# Builders Bot has no release feed yet (phase 0 of the update design), so this package has no source
# and stops with a message. Before, it downloaded the upstream Builders Bot release, and `sources.json`
# had the hashes of that release. The source comes back with the Builders Bot release feed;
# `bun scripts/nix-sources.ts` then writes the version and the hashes of a Builders Bot release.
#
# Builders Bot does not update itself from the Nix store (`isNixStoreInstall` in
# src/main/update-service.ts). Nix replaces the whole package instead.
{
  lib,
  stdenvNoCC,
  appimageTools,
  buildFHSEnv,
  makeBinaryWrapper,
  unzip,
  sources,
}:

let
  pname = "buildersbot";
  inherit (sources) version;

  src = throw "Builders Bot has no release feed yet, so the Nix package is not available in this version.";

  meta = {
    description = "Local-first multi-agent desktop workspace for Codex, Claude, Grok and other coding agents";
    homepage = "https://buildersbot.culturabuilder.com";
    license = lib.licenses.unfree;
    maintainers = [
      {
        name = "CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA";
        email = "licenses@culturabuilder.com";
      }
    ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ];
    mainProgram = "buildersbot";
  };

  # The AppImage's `AppRun` adds `--no-sandbox` when the system refuses an unprivileged user
  # namespace, and its desktop entry passes `--no-sandbox` too. Builders Bot must keep the Electron sandbox
  # (build/linux/buildersbot.apparmor), so the FHS environment starts the Electron binary directly.
  # Its libraries and the bundled cua-driver find the usual Linux paths there.
  contents = appimageTools.extract {
    inherit pname version src;
    # The bundled Sunshine needs the Ubuntu libraries of scripts/hosting/packages.txt, and this
    # environment was not checked against them. Without the runtime directory, Builders Bot shows remote
    # desktop as unavailable and does not try to start it.
    postExtract = ''
      rm -rf $out/resources/remote-desktop-runtime
    '';
  };

  linux = buildFHSEnv (
    appimageTools.defaultFhsEnvArgs
    // {
      inherit pname version meta;
      targetPkgs = pkgs: appimageTools.defaultFhsEnvArgs.targetPkgs pkgs ++ [ pkgs.libsecret ];
      runScript = "${contents}/buildersbot";
      extraInstallCommands = ''
        install -Dm444 ${contents}/buildersbot.desktop $out/share/applications/buildersbot.desktop
        substituteInPlace $out/share/applications/buildersbot.desktop \
          --replace-fail 'Exec=AppRun --no-sandbox %U' 'Exec=buildersbot %U'
        # The AppImage has only a 1600x1600 icon, a size that no icon theme lists.
        install -Dm444 ${contents}/buildersbot.png $out/share/pixmaps/buildersbot.png
      '';
    }
  );

  darwin = stdenvNoCC.mkDerivation {
    inherit
      pname
      version
      src
      meta
      ;

    nativeBuildInputs = [
      makeBinaryWrapper
      unzip
    ];

    sourceRoot = ".";

    # The app is signed and notarized. Stripping or patching it would break the signature.
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall
      mkdir -p $out/Applications
      cp -R "Builders Bot.app" $out/Applications/
      makeWrapper "$out/Applications/Builders Bot.app/Contents/MacOS/Builders Bot" $out/bin/buildersbot
      runHook postInstall
    '';
  };
in
if stdenvNoCC.hostPlatform.isDarwin then darwin else linux
