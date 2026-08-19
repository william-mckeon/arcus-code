// Declares <diffs-container> for TSX in this package. The declaration itself
// lives in packages/ui/src/custom-elements.d.ts and is referenced rather than
// duplicated, so there is still one source of truth.
//
// This was a symlink. Windows cannot create symlinks without Developer Mode or
// the create-symbolic-link privilege, so git checks them out as plain text
// files holding the target path -- which tsc then parses as source and rejects
// (TS1128). A triple-slash reference pulls the same declaration into the
// program on every platform and needs no symlink.
/// <reference path="../../ui/src/custom-elements.d.ts" />

export {}
