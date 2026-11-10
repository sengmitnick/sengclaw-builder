"""Extract only fixed, regular role-package members into a new build directory."""

from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile


def extract(archive, output):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Skill staging directory already exists')
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if not members or len(members) > 10000 or sum(m.file_size for m in members) > 64 * 1024 * 1024:
            raise ValueError('Skill archive size is invalid')
        seen, roles = set(), set()
        for member in members:
            name = member.filename
            plain = name[:-1] if member.is_dir() else name
            relative = PurePosixPath(plain)
            mode = member.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if (not plain or '\\' in name or ':' in name or any(ord(c) < 32 or ord(c) == 127 for c in name)
                    or relative.is_absolute() or relative.as_posix() != plain
                    or any(p in ('', '.', '..') for p in plain.split('/'))
                    or relative.parts[0] not in ('product', 'development')
                    or (len(relative.parts) == 1 and not member.is_dir())
                    or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or (kind == stat.S_IFDIR and not member.is_dir())
                    or plain.casefold() in seen or member.flag_bits & 1):
                raise ValueError('Skill archive contains an unsafe member')
            seen.add(plain.casefold())
            roles.add(relative.parts[0])
        if roles != {'product', 'development'}:
            raise ValueError('Skill archive must contain both role packages')
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.skill-stage-', dir=output.parent) as temporary:
            stage = Path(temporary) / 'packages'
            stage.mkdir()
            for member in members:
                target = stage.joinpath(*PurePosixPath(member.filename).parts)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(member) as incoming, target.open('xb') as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
                    target.chmod(0o755 if (member.external_attr >> 16) & 0o111 else 0o644)
            stage.rename(output)
    return output


if __name__ == '__main__':
    try:
        extract(sys.argv[1], sys.argv[2])
    except (ValueError, OSError, zipfile.BadZipFile, IndexError):
        raise SystemExit('Locked Skill archive extraction failed') from None
