// NSIS supplies its uninstaller as a .tmp file; inspect PE headers, not suffixes.
export function isPortableExecutable(bytes) {
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) return false;
  const offset = bytes.readUInt32LE(0x3c);
  return offset >= 64 && offset <= bytes.length - 4 && bytes.readUInt32LE(offset) === 0x00004550;
}

export function signingPayloadName(target) {
  return target.toLowerCase().endsWith('.dll') ? 'payload.dll' : 'payload.exe';
}
