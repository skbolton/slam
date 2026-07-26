{ lib, buildNpmPackage, nodejs_22, makeWrapper, bat, fzf, piPackage, piPackageRevision, src }:

buildNpmPackage {
  npmDepsFetcherVersion = 2;
  pname = "slam";
  version = (lib.importJSON (src + "/package.json")).version;
  inherit src;

  nodejs = nodejs_22;
  npmDepsHash = "sha256-rfLr5/GDkRzYNhrMGgWZDkpcD5XGOdo69uGURq/gO9o=";
  npmFlags = [ "--ignore-scripts" ];

  nativeBuildInputs = [ makeWrapper ];

  npmBuildScript = "build";

  preBuild = ''
    export SLAM_BUILD_VERSION=$version
    export SLAM_PI_VERSION=${piPackage.version}
    export SLAM_PI_PACKAGE_REVISION=${piPackageRevision}
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/slam $out/share/slam $out/bin
    cp -r dist package.json node_modules $out/lib/slam/
    cp slam.plugin.zsh $out/share/slam/slam.plugin.zsh
    makeWrapper ${nodejs_22}/bin/node $out/bin/slam \
      --add-flags $out/lib/slam/dist/index.js \
      --set SLAM_PI ${piPackage}/bin/pi \
      --set SLAM_BAT ${bat}/bin/bat \
      --set SLAM_FZF ${fzf}/bin/fzf
    runHook postInstall
  '';

  meta = {
    description = "Shell-native AI coding agent frontend";
    license = lib.licenses.mit;
    mainProgram = "slam";
    platforms = [ "x86_64-linux" ];
  };
}
