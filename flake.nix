{
  description = "Builders Bot: a local-first multi-agent desktop workspace";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      sources = lib.importJSON ./nix/sources.json;
      # nixpkgs-unstable has no x86_64-darwin. The overlay still builds it with nixpkgs 26.05.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      # Builders Bot is not free software (proprietary EULA), so nixpkgs refuses it by default. A user
      # who asks for this flake's package has asked for Builders Bot; other unfree packages stay refused.
      forEachSystem =
        f:
        lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate = pkg: lib.getName pkg == "buildersbot";
            }
          )
        );
    in
    {
      packages = forEachSystem (pkgs: {
        buildersbot = pkgs.callPackage ./nix/package.nix { inherit sources; };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.buildersbot;
      });

      # Builds Builders Bot with the user's nixpkgs. That nixpkgs must allow the unfree package.
      overlays.default = final: _prev: {
        buildersbot = final.callPackage ./nix/package.nix { inherit sources; };
      };

      formatter = forEachSystem (pkgs: pkgs.nixfmt);
    };
}
