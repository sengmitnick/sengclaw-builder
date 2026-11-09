"""Publisher transport gates with explicitly synthetic signing receipt fixtures."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'scripts/hub-publish-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishGates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifacts, self.output = self.root / 'artifacts', self.root / 'publish'
        self.source = 'a' * 40
        self.run = dict(id=7, head_sha='b' * 40, html_url='https://github.com/example/run/7',
                        repository={'full_name': publisher.REPOSITORY}, event='workflow_dispatch',
                        path='.github/workflows/hub-desktop.yml', head_branch='main',
                        status='completed', conclusion='success')
        self.jobs = {'jobs': []}
        for platform in ['macos', 'windows']:
            for edition in ['product', 'development']:
                self.jobs['jobs'].append({'name': f'{platform} (finloop, {edition})', 'conclusion': 'success'})
                folder = self.artifacts / f'{platform}-{edition}'
                folder.mkdir(parents=True)
                package = folder / 'synthetic.zip'
                package.write_bytes(b'SYNTHETIC TRANSPORT FIXTURE; NOT A SIGNED EXECUTABLE')
                name = '工作助手' + ('产品版' if edition == 'product' else '研发版')
                data = dict(edition=edition, platform=platform, version='0.3.25', enterprise='finloop',
                            bundle_id=f'com.sengclaw.hub.finloop.{edition}', product_name=name,
                            source_commit=self.source, sha256=hashlib.sha256(package.read_bytes()).hexdigest(),
                            architecture='arm64' if platform == 'macos' else 'x64')
                if platform == 'macos':
                    data.update(archive=package.name, status='Accepted', notary_id='synthetic', team='87WNRG9285')
                else:
                    data.update(package=package.name, signature_status='Valid', timestamped=True,
                                bundled_tool_versions='passed', portable_sidecar_startup='passed',
                                signed_files=[name + '.exe', 'hub-sidecar.exe', 'meegle.exe', 'lark-cli.exe'])
                (folder / ('release.json' if platform == 'macos' else 'hub-windows-receipt.json')).write_text(json.dumps(data))

    def prepare(self):
        return publisher.prepare(self.artifacts, self.output, self.run, self.jobs,
                                 self.source, '0.3.25', 'finloop')

    def test_four_matching_receipts_produce_only_ten_explicit_assets(self):
        self.assertEqual(len(self.prepare()['packages']), 4)
        self.assertEqual(len(list(self.output.iterdir())), 10)

    def test_tampering_source_mismatch_and_failed_build_are_rejected(self):
        package = next(self.artifacts.rglob('synthetic.zip'))
        package.write_bytes(b'TAMPERED')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.prepare()
        self.run['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'successful trusted'):
            self.prepare()
        self.run['conclusion'] = 'success'
        self.source = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'source mismatch'):
            self.prepare()

    def test_missing_job_or_receipt_is_not_a_complete_release(self):
        self.jobs['jobs'].pop()
        with self.assertRaisesRegex(ValueError, 'All four'):
            self.prepare()

    def test_published_release_is_never_overwritten(self):
        with patch.object(publisher, 'gh', return_value='[{"tag_name":"production","draft":false}]'), \
                patch.object(publisher.subprocess, 'run') as mutate:
            with self.assertRaisesRegex(ValueError, 'Refuse to overwrite'):
                publisher.publish(self.output, 'production')
            mutate.assert_not_called()
