"""Create reproducible extension and source ZIPs using explicit file lists."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def write_archive(destination, files):
    for filename in files:
        target = (ROOT / filename).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file():
            raise ValueError(f"Missing or invalid package file: {filename}")
    destination.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for filename in sorted(files):
            info = zipfile.ZipInfo(filename, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / filename).read_bytes())
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != files:
            raise ValueError("Package verification failed")
    print(f"Created {destination.name}: {len(files)} files, {destination.stat().st_size} bytes")


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8-sig"))
    version = manifest["version"]
    if not version or any(c not in "0123456789." for c in version):
        raise ValueError("Invalid extension version")
    files = {
        "manifest.json", "content.js", "background.js", "anuncio.css",
        "popup.html", "popup.css", "popup.js", "INSTALL.txt", "LICENSE",
        *manifest["icons"].values(),
    }
    destination = ROOT / "dist" / f"youtube-fast-skipper-{version}.zip"
    write_archive(destination, files)
    sources = files | {
        ".gitignore", ".gitattributes", ".editorconfig", "README.md",
        "CHANGELOG.md", "CONTRIBUTING.md", "package.json", "package-lock.json",
        "assets/logo.png",
    }
    for pattern in ("tests/*.cjs", "scripts/*.cjs", "scripts/*.py", ".github/workflows/*.yml", "docs/*.png"):
        sources.update(p.relative_to(ROOT).as_posix() for p in ROOT.glob(pattern))
    write_archive(ROOT / "dist" / f"youtube-fast-skipper-source-{version}.zip", sources)


if __name__ == "__main__":
    main()
