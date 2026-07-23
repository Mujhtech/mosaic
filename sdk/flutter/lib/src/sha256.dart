import 'dart:convert';
import 'dart:typed_data';

// Small SHA-256 implementation kept private so Configuration Delivery can
// retain Mosaic's Dart 3.3 minimum without depending on a newer crypto package.
String mosaicSha256Hex(List<int> input) {
  final bytes = BytesBuilder(copy: false)..add(input);
  final bitLength = input.length * 8;
  bytes.addByte(0x80);
  while ((bytes.length + 8) % 64 != 0) {
    bytes.addByte(0);
  }
  final lengthBytes = ByteData(8)
    ..setUint32(0, bitLength ~/ 0x100000000, Endian.big)
    ..setUint32(4, bitLength & 0xffffffff, Endian.big);
  bytes.add(lengthBytes.buffer.asUint8List());

  var h0 = 0x6a09e667;
  var h1 = 0xbb67ae85;
  var h2 = 0x3c6ef372;
  var h3 = 0xa54ff53a;
  var h4 = 0x510e527f;
  var h5 = 0x9b05688c;
  var h6 = 0x1f83d9ab;
  var h7 = 0x5be0cd19;
  final message = bytes.takeBytes();
  final words = Uint32List(64);

  for (var offset = 0; offset < message.length; offset += 64) {
    final block = ByteData.sublistView(message, offset, offset + 64);
    for (var index = 0; index < 16; index += 1) {
      words[index] = block.getUint32(index * 4, Endian.big);
    }
    for (var index = 16; index < 64; index += 1) {
      final x = words[index - 15];
      final y = words[index - 2];
      final s0 = _rotateRight(x, 7) ^ _rotateRight(x, 18) ^ (x >>> 3);
      final s1 = _rotateRight(y, 17) ^ _rotateRight(y, 19) ^ (y >>> 10);
      words[index] = _sum32(words[index - 16], s0, words[index - 7], s1);
    }

    var a = h0;
    var b = h1;
    var c = h2;
    var d = h3;
    var e = h4;
    var f = h5;
    var g = h6;
    var h = h7;
    for (var index = 0; index < 64; index += 1) {
      final s1 = _rotateRight(e, 6) ^ _rotateRight(e, 11) ^ _rotateRight(e, 25);
      final choice = (e & f) ^ ((~e) & g);
      final temporary1 =
          _sum32(h, s1, choice, _sha256Constants[index], words[index]);
      final s0 = _rotateRight(a, 2) ^ _rotateRight(a, 13) ^ _rotateRight(a, 22);
      final majority = (a & b) ^ (a & c) ^ (b & c);
      final temporary2 = _sum32(s0, majority);
      h = g;
      g = f;
      f = e;
      e = _sum32(d, temporary1);
      d = c;
      c = b;
      b = a;
      a = _sum32(temporary1, temporary2);
    }
    h0 = _sum32(h0, a);
    h1 = _sum32(h1, b);
    h2 = _sum32(h2, c);
    h3 = _sum32(h3, d);
    h4 = _sum32(h4, e);
    h5 = _sum32(h5, f);
    h6 = _sum32(h6, g);
    h7 = _sum32(h7, h);
  }

  return <int>[h0, h1, h2, h3, h4, h5, h6, h7]
      .map((value) => value.toUnsigned(32).toRadixString(16).padLeft(8, '0'))
      .join();
}

String mosaicSha256String(String value) => mosaicSha256Hex(utf8.encode(value));

int _rotateRight(int value, int amount) => ((value.toUnsigned(32) >>> amount) |
        (value.toUnsigned(32) << (32 - amount)))
    .toUnsigned(32);

int _sum32(int first, int second,
        [int third = 0, int fourth = 0, int fifth = 0]) =>
    (first + second + third + fourth + fifth).toUnsigned(32);

const List<int> _sha256Constants = <int>[
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
];
