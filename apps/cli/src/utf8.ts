/** Text from the end of a byte buffer that may have been cut inside a character: the leftover bytes of that one are dropped. */
export function decodeTail(bytes: Buffer): string {
  let start = 0;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString();
}
