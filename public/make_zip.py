import zipfile, pathlib

def main():
    root = pathlib.Path(__file__).resolve().parent
    out = root / "asgard-crm-static.zip"
    if out.exists(): out.unlink()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p in root.rglob("*"):
            if p.is_dir(): 
                continue
            if p.name == out.name:
                continue
            z.write(p, arcname=str(p.relative_to(root)))
    print("OK:", out)

if __name__ == "__main__":
    main()
