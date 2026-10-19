# Source provenance

Browser base: https://github.com/andvolodko/mu-online-solo-classic at `fb5d6aed769e6384a2f25164e75eded456307be7`.

Server analyzed: https://github.com/EmanuelCatania/Mu-Linux-0.97k at `fdfa008b4beb2905b9b0e144a7d6bb7713627766`.

Clone them into ignored `upstream/browser` and `upstream/server`, then check out those immutable commits before generating patches/audit evidence. Upstream repositories, game assets, binaries, WASM bundles, databases and credentials are not included here.

Candidate replacement C++ files are in client-overlay; apply browser-online.patch once to the browser base. See README.md and REPORT.th.md for verification limits. Preserve upstream license notices in licenses/ when redistributing modified files.
