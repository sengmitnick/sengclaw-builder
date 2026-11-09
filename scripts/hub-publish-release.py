"""Publish four immutable signed Hub artifacts through the GitHub runner network."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

REPOSITORY = 'sengmitnick/sengclaw-builder'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(artifacts, output, run, jobs, source, version, enterprise):
    if not re.fullmatch(r'[a-f0-9]{40}', source) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid immutable release input')
    if enterprise not in {'seng', 'finloop'}:
        raise ValueError('Invalid enterprise')
    if (run['repository']['full_name'] != REPOSITORY or run['event'] != 'workflow_dispatch'
            or run['path'] != '.github/workflows/hub-desktop.yml' or run['head_branch'] != 'main'
            or run['status'] != 'completed' or run['conclusion'] != 'success'):
        raise ValueError('Build must be a successful trusted manual Hub run')
    expected = {f'{platform} ({enterprise}, {edition})'
                for platform in ['macos', 'windows'] for edition in ['product', 'development']}
    if {job['name'] for job in jobs['jobs']} != expected or any(
            job['conclusion'] != 'success' for job in jobs['jobs']):
        raise ValueError('All four edition/platform jobs must pass')
    receipts = list(artifacts.rglob('release.json')) + list(artifacts.rglob('hub-windows-receipt.json'))
    if len(receipts) != 4:
        raise ValueError('Expected exactly four signing receipts')
    packages = {}
    for receipt in receipts:
        data = json.loads(receipt.read_text(encoding='utf-8-sig'))
        edition, platform = data['edition'], data['platform']
        key = edition, platform
        if key in packages or edition not in {'product', 'development'} or platform not in {'macos', 'windows'}:
            raise ValueError('Duplicate or invalid edition/platform')
        expected_name = '工作助手' + ('产品版' if edition == 'product' else '研发版')
        if (data['version'] != version or data['enterprise'] != enterprise
                or data['bundle_id'] != f'com.sengclaw.hub.{enterprise}.{edition}'
                or data['product_name'] != expected_name
                or data.get('source_commit', data.get('source_sha')) != source):
            raise ValueError('Receipt identity or immutable source mismatch')
        if platform == 'macos':
            if (data['status'] != 'Accepted' or not data['notary_id'] or data['team'] != '87WNRG9285'
                    or data['architecture'] != 'arm64'):
                raise ValueError('Apple signing/notarization failed')
        elif (data['signature_status'] != 'Valid' or data['timestamped'] is not True or data['architecture'] != 'x64'
              or data['bundled_tool_versions'] != 'passed' or 'passed' not in data['portable_sidecar_startup']
              or data['signed_files'] != [expected_name + '.exe', 'hub-sidecar.exe', 'meegle.exe', 'lark-cli.exe']):
            raise ValueError('Windows signing or startup checks failed')
        original = data.get('archive', data.get('package'))
        if Path(original).name != original:
            raise ValueError('Invalid archive name')
        candidates = list(receipt.parent.rglob(original))
        if len(candidates) != 1 or digest(candidates[0]) != data['sha256'].lower():
            raise ValueError('Signed archive checksum mismatch')
        role = 'Product' if edition == 'product' else 'Development'
        suffix = 'macOS-arm64.zip' if platform == 'macos' else 'Windows-x64-portable.zip'
        filename = f'Work-Assistant-{role}-{version}-{suffix}'
        output.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidates[0], output / filename)
        receipt_name = filename.removesuffix('.zip') + '.receipt.json'
        (output / receipt_name).write_text(json.dumps({**data, 'download_file': filename,
            'builder_commit': run['head_sha'], 'build_run_id': run['id']}, ensure_ascii=False, indent=2) + '\n')
        packages[key] = {'edition': edition, 'platform': platform, 'file': filename,
                         'sha256': data['sha256'].lower(), 'receipt': receipt_name, 'original_archive': original}
    manifest = {'version': version, 'enterprise': enterprise, 'source_commit': source,
                'builder_commit': run['head_sha'], 'build_url': run['html_url'],
                'packages': [packages[key] for key in sorted(packages)]}
    (output / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in sorted(output.iterdir())
                                             if p.name != 'SHA256SUMS'))
    return manifest


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True)


def publish(output, tag):
    releases = json.loads(gh('api', f'repos/{REPOSITORY}/releases?per_page=100'))
    matches = [release for release in releases if release['tag_name'] == tag]
    if len(matches) != 1 or not matches[0]['draft']:
        raise ValueError('Refuse to overwrite a published or missing release')
    release_id = matches[0]['id']
    for file in sorted(output.iterdir()):
        subprocess.run(['gh', 'release', 'upload', tag, str(file), '--repo', REPOSITORY, '--clobber'], check=True)
    current = json.loads(gh('api', f'repos/{REPOSITORY}/releases/{release_id}'))
    files = {p.name: p for p in output.iterdir()}
    if not current['draft'] or {a['name'] for a in current['assets']} != set(files):
        raise ValueError('Draft assets differ from the complete verified release')
    for asset in current['assets']:
        if asset['state'] != 'uploaded' or asset['digest'] != 'sha256:' + digest(files[asset['name']]):
            raise ValueError('Server upload digest mismatch')
    subprocess.run(['gh', 'release', 'edit', tag, '--repo', REPOSITORY, '--draft=false', '--latest=false'], check=True)
    print(f'https://github.com/{REPOSITORY}/releases/tag/{tag}')


if __name__ == '__main__':
    run = json.loads(Path('build-run.json').read_text())
    jobs = json.loads(Path('build-jobs.json').read_text())
    version, enterprise, source = (os.environ[key] for key in ['VERSION', 'ENTERPRISE', 'SOURCE_SHA'])
    output = Path('release-stage')
    prepare(Path('artifacts'), output, run, jobs, source, version, enterprise)
    publish(output, f'work-assistant-v{version}-{enterprise}')
