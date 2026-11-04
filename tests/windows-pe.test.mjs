import assert from 'node:assert/strict';
import test from 'node:test';
import {isPortableExecutable, signingPayloadName} from '../scripts/windows-pe.mjs';

test('NSIS temporary uninstaller is accepted by PE content and staged as EXE', () => {
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(80, 0x3c);
  pe.writeUInt32LE(0x00004550, 80);
  assert.equal(isPortableExecutable(pe), true);
  assert.equal(signingPayloadName('C:\\Temp\\nsu123.tmp'), 'payload.exe');
  assert.equal(signingPayloadName('plugin.DLL'), 'payload.dll');
});
test('Signing rejects non-PE and malformed PE headers', () => {
  assert.equal(isPortableExecutable(Buffer.from('not a program')), false);
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(0xffffffff, 0x3c);
  assert.equal(isPortableExecutable(pe), false);
  pe.writeUInt32LE(80, 0x3c);
  assert.equal(isPortableExecutable(pe), false);
});
