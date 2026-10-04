import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(mobile, "security/forks.json"), "utf8"));
const fail = message => { throw new Error(`Security fork refused: ${message}`); };

function bytes(root, name) {
  const file = resolve(root, name);
  if (file === root || !file.startsWith(root + sep)) fail("archive path outside project");
  let path = root;
  for (const part of name.split("/")) {
    path = resolve(path, part);
    if (lstatSync(path).isSymbolicLink()) fail("symlinked archive content");
  }
  if (!lstatSync(file).isFile()) fail("non-file archive content");
  return readFileSync(file);
}

export function verifySecurityForks(projectRoot = mobile) {
  const root = resolve(projectRoot);
  const lock = JSON.parse(bytes(root, "package-lock.json"));
  const metadata = JSON.parse(bytes(root, "package.json"));
  for (const spec of manifest.packages) {
    const distribution = bytes(root, spec.archive);
    if (createHash("sha256").update(distribution).digest("hex") !== spec.archive_sha256 ||
      "sha512-" + createHash("sha512").update(distribution).digest("base64") !== spec.archive_integrity) fail("modified archive integrity changed");
    if ("sha512-" + createHash("sha512").update(bytes(root, spec.upstream_archive)).digest("base64") !== spec.upstream_integrity) fail("upstream archive integrity changed");
    if (metadata.dependencies?.[spec.upstream_name] !== "file:./" + spec.archive || metadata.overrides?.[spec.upstream_name] !== "$" + spec.upstream_name) fail("fork dependency override changed");
    const entry = lock.packages?.["node_modules/" + spec.upstream_name];
    if (entry?.name !== spec.name || entry.version !== spec.version || entry.resolved !== "file:" + spec.archive || entry.integrity !== spec.archive_integrity || entry.link) fail("fork lock identity changed");
  }
  return { status: "pinned_modified_fork_archives_verified", upstream_advisory_gate: "open", dependency_audit_gate: "separate_raw_audit_required", packages: manifest.packages.map(spec => spec.name) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail("unexpected arguments");
    console.log(JSON.stringify(verifySecurityForks()));
  } catch (error) {
    console.error(error.message?.startsWith("Security fork refused:") ? error.message : "Security fork refused: incomplete archive inspection");
    process.exitCode = 1;
  }
}
