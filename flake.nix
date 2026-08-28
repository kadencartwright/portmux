{
  description = "Persistent SSH port-forward manager with an OpenTUI interface";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          pnpm = pkgs.pnpm_10;
        in
        rec {
          portmux = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
            pname = "portmux";
            version = "0.1.0";
            src = self;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 4;
              hash = "sha256-62PN+hsHBJZH1ik9h6pYIc6coOocN8rLG0oFDyKXHNQ=";
            };

            nativeBuildInputs = [
              pkgs.bun
              pkgs.makeWrapper
              pkgs.nodejs
              pkgs.pnpmConfigHook
              pnpm
            ];

            env = {
              CI = "true";
              TURBO_TELEMETRY_DISABLED = "1";
            };

            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              rm -rf node_modules apps/portmux/node_modules packages/core/node_modules
              pnpm install --offline --prod --frozen-lockfile --ignore-scripts

              mkdir -p \
                "$out/share/portmux/apps/portmux" \
                "$out/share/portmux/packages/core" \
                "$out/bin"
              cp -R node_modules "$out/share/portmux/"
              cp -R apps/portmux/node_modules apps/portmux/dist \
                "$out/share/portmux/apps/portmux/"
              cp -R packages/core/package.json packages/core/src \
                "$out/share/portmux/packages/core/"

              makeWrapper ${pkgs.lib.getExe pkgs.bun} "$out/bin/portmux" \
                --add-flags "$out/share/portmux/apps/portmux/dist/portmux.js" \
                --prefix PATH : ${
                  pkgs.lib.makeBinPath (
                    [ pkgs.openssh ]
                    ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
                      pkgs.procps
                      pkgs.xdg-utils
                    ]
                  )
                }

              runHook postInstall
            '';

            meta = {
              description = "Persistent SSH port-forward manager with an OpenTUI interface";
              homepage = "https://github.com/kadencartwright/portmux";
              license = pkgs.lib.licenses.mit;
              mainProgram = "portmux";
              platforms = pkgs.lib.platforms.unix;
            };
          });

          default = portmux;
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/portmux";
          meta.description = "Persistent SSH port-forward manager with an OpenTUI interface";
        };
      });

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) portmux;
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.bun
              pkgs.gitleaks
              pkgs.nodejs
              pkgs.openssh
              pkgs.pnpm_10
            ];
          };
        }
      );

      formatter = forAllSystems (system: (import nixpkgs { inherit system; }).nixfmt);
    };
}
