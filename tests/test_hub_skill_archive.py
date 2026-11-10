import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class SkillArchiveTests(unittest.TestCase):
    def setUp(self):
        script = ROOT / 'scripts/hub-extract-skills.py'
        self.assertTrue(script.is_file(), 'A safe fixed-root extractor is required')
        spec = importlib.util.spec_from_file_location('hub_skill_archive', script)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'input.zip'
        self.output = self.root / 'output'

    def archive_with(self, entries):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, mode in entries:
                info = zipfile.ZipInfo(name)
                info.external_attr = mode << 16
                archive.writestr(info, b'fixture')

    def test_valid_archive_preserves_executable_modes_for_both_roles(self):
        self.archive_with([('product/entry', stat.S_IFREG | 0o644),
                           ('development/scripts/helper', stat.S_IFREG | 0o755)])
        self.module.extract(self.archive, self.output)
        self.assertEqual(b'fixture', (self.output / 'product/entry').read_bytes())
        self.assertTrue((self.output / 'development/scripts/helper').stat().st_mode & 0o111)

    def test_invalid_roots_traversal_and_duplicate_names_leave_no_output(self):
        for invalid in ['../escape', '/absolute', 'product/../escape', 'C:/escape',
                        'product\\escape', 'credentials/token', 'product//entry']:
            self.archive_with([(invalid, stat.S_IFREG | 0o644)])
            with self.assertRaises(ValueError):
                self.module.extract(self.archive, self.output)
            self.assertFalse(self.output.exists(), invalid)
        self.archive_with([('product/entry', stat.S_IFREG | 0o644),
                           ('product/ENTRY', stat.S_IFREG | 0o644),
                           ('development/entry', stat.S_IFREG | 0o644)])
        with self.assertRaises(ValueError):
            self.module.extract(self.archive, self.output)
        self.assertFalse(self.output.exists())

    def test_symlinks_and_nonregular_members_are_not_extracted(self):
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o644):
            self.archive_with([('product/entry', mode), ('development/entry', stat.S_IFREG | 0o644)])
            with self.assertRaises(ValueError):
                self.module.extract(self.archive, self.output)
            self.assertFalse(self.output.exists())

    def test_existing_directory_is_preserved(self):
        self.archive_with([('product/entry', stat.S_IFREG | 0o644),
                           ('development/entry', stat.S_IFREG | 0o644)])
        self.output.mkdir()
        owned = self.output / 'user.txt'
        owned.write_text('preserve')
        with self.assertRaises(ValueError):
            self.module.extract(self.archive, self.output)
        self.assertEqual('preserve', owned.read_text())


if __name__ == '__main__':
    unittest.main()
