// Generador autónomo de iconos PNG sin dependencias externas usando zlib
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(filePath, width, height) {
  // Generar imagen RGBA: Fondo azul médico (#0284c7 = 2, 132, 199), borde suave y cruz médica blanca con reloj
  const rawBytes = [];
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.44;

  for (let y = 0; y < height; y++) {
    rawBytes.push(0); // Filtro None
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Dentro del círculo base
        // Dibujar Cruz Médica Blanca en el centro
        const armWidth = width * 0.16;
        const armLength = width * 0.52;
        const inHBar = Math.abs(dy) <= armWidth / 2 && Math.abs(dx) <= armLength / 2;
        const inVBar = Math.abs(dx) <= armWidth / 2 && Math.abs(dy) <= armLength / 2;

        if (inHBar || inVBar) {
          rawBytes.push(255, 255, 255, 255); // Blanco puro
        } else {
          // Gradiente sutil azul médico / cian
          const grad = Math.min(1, Math.max(0, (y / height)));
          const red = Math.round(2 + grad * 14);
          const green = Math.round(132 - grad * 30);
          const blue = Math.round(199 - grad * 20);
          rawBytes.push(red, green, blue, 255);
        }
      } else {
        // Transparente fuera
        rawBytes.push(0, 0, 0, 0);
      }
    }
  }

  const uncompressed = Buffer.from(rawBytes);
  const compressed = zlib.deflateSync(uncompressed);

  // Armar chunks PNG (IHDR, IDAT, IEND)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);  // bit depth
  ihdrData.writeUInt8(6, 9);  // RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  const ihdrCrc = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdrChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdrData,
    Buffer.from([(ihdrCrc >>> 24) & 0xff, (ihdrCrc >>> 16) & 0xff, (ihdrCrc >>> 8) & 0xff, ihdrCrc & 0xff])
  ]);

  // IDAT
  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressed.length, 0);
  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  const idatChunk = Buffer.concat([
    idatLength,
    Buffer.from('IDAT'),
    compressed,
    Buffer.from([(idatCrc >>> 24) & 0xff, (idatCrc >>> 16) & 0xff, (idatCrc >>> 8) & 0xff, idatCrc & 0xff])
  ]);

  // IEND
  const iendCrc = crc32(Buffer.from('IEND'));
  const iendChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    Buffer.from([(iendCrc >>> 24) & 0xff, (iendCrc >>> 16) & 0xff, (iendCrc >>> 8) & 0xff, iendCrc & 0xff])
  ]);

  const pngFile = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(filePath, pngFile);
  console.log(`Icono generado: ${filePath} (${width}x${height})`);
}

const dir = path.join(__dirname);
writePng(path.join(dir, 'icon-192.png'), 192, 192);
writePng(path.join(dir, 'icon-512.png'), 512, 512);
writePng(path.join(dir, 'apple-touch-icon.png'), 180, 180);
