{
  description = "Shell-native AI coding agent frontend";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llm-agents.url = "github:numtide/llm-agents.nix";
  };

  outputs = { self, nixpkgs, llm-agents }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      piPackage = llm-agents.packages.${system}.pi;
      piPackageRevision = llm-agents.rev or llm-agents.dirtyRev or "unknown";
      slamPackage = pkgs.callPackage ./nix/slam.nix {
        inherit piPackage piPackageRevision;
        src = self;
      };
    in {
		packages.${system} = {
			default = slamPackage;
			pi = piPackage;
			slam = slamPackage;
		};

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          bat
          biome
          fzf
          nodejs_22
          piPackage
          zsh
        ];

      };

      checks.${system}.source-inputs = pkgs.runCommand "slam-source-inputs" {} ''
        test -f ${self}/package.json
        test -x ${piPackage}/bin/pi
        touch $out
      '';
    };
}
