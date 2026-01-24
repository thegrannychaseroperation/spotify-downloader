export type FlacTagMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  date?: string;
  trackNumber?: string;
};

export type FlacPicture = {
  buffer: Uint8Array;
  mimeType: string;
};

type FlacBlock = {
  type: number;
  data: Uint8Array;
};

const STREAMINFO_BLOCK_TYPE = 0;
const VORBIS_COMMENT_BLOCK_TYPE = 4;
const PICTURE_BLOCK_TYPE = 6;
const VENDOR_STRING = "spotify-downloader";

const textEncoder = new TextEncoder();
const FLAC_HEADER_BYTES = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function encodeString(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function buildVorbisCommentBlock(metadata: FlacTagMetadata): Uint8Array {
  const comments: string[] = [];
  if (metadata.title) comments.push(`TITLE=${metadata.title}`);
  if (metadata.artist) comments.push(`ARTIST=${metadata.artist}`);
  if (metadata.album) comments.push(`ALBUM=${metadata.album}`);
  if (metadata.date) comments.push(`DATE=${metadata.date}`);
  if (metadata.trackNumber) comments.push(`TRACKNUMBER=${metadata.trackNumber}`);

  const vendorBytes = encodeString(VENDOR_STRING);
  const commentBytes = comments.map((comment) => encodeString(comment));
  const totalLength = 4
    + vendorBytes.length
    + 4
    + commentBytes.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  writeUint32LE(view, offset, vendorBytes.length);
  offset += 4;
  buffer.set(vendorBytes, offset);
  offset += vendorBytes.length;
  writeUint32LE(view, offset, commentBytes.length);
  offset += 4;

  for (const bytes of commentBytes) {
    writeUint32LE(view, offset, bytes.length);
    offset += 4;
    buffer.set(bytes, offset);
    offset += bytes.length;
  }

  return buffer;
}

function buildPictureBlock(picture: FlacPicture): Uint8Array {
  const mimeBytes = encodeString(picture.mimeType);
  const descriptionBytes = encodeString("Cover (front)");
  const dataLength = picture.buffer.length;
  const totalLength = 4
    + 4
    + mimeBytes.length
    + 4
    + descriptionBytes.length
    + 4
    + 4
    + 4
    + 4
    + 4
    + dataLength;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  writeUint32BE(view, offset, 3);
  offset += 4;
  writeUint32BE(view, offset, mimeBytes.length);
  offset += 4;
  buffer.set(mimeBytes, offset);
  offset += mimeBytes.length;
  writeUint32BE(view, offset, descriptionBytes.length);
  offset += 4;
  buffer.set(descriptionBytes, offset);
  offset += descriptionBytes.length;
  writeUint32BE(view, offset, 0);
  offset += 4;
  writeUint32BE(view, offset, 0);
  offset += 4;
  writeUint32BE(view, offset, 0);
  offset += 4;
  writeUint32BE(view, offset, 0);
  offset += 4;
  writeUint32BE(view, offset, dataLength);
  offset += 4;
  buffer.set(picture.buffer, offset);

  return buffer;
}

function parseBlocks(source: Uint8Array): { blocks: FlacBlock[]; audioOffset: number } | null {
  if (
    source.length < 4
    || source[0] !== FLAC_HEADER_BYTES[0]
    || source[1] !== FLAC_HEADER_BYTES[1]
    || source[2] !== FLAC_HEADER_BYTES[2]
    || source[3] !== FLAC_HEADER_BYTES[3]
  ) {
    return null;
  }

  const blocks: FlacBlock[] = [];
  let offset = 4;
  while (offset + 4 <= source.length) {
    const header = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0, false);
    const isLast = (header & 0x80000000) !== 0;
    const blockType = (header >> 24) & 0x7f;
    const blockLength = header & 0x00ffffff;
    offset += 4;
    if (offset + blockLength > source.length) return null;
    const data = source.slice(offset, offset + blockLength);
    blocks.push({ type: blockType, data });
    offset += blockLength;
    if (isLast) break;
  }

  return { blocks, audioOffset: offset };
}

function buildBlockHeader(type: number, isLast: boolean, length: number): Uint8Array {
  const value = (isLast ? 0x80000000 : 0) | ((type & 0x7f) << 24) | (length & 0x00ffffff);
  const buffer = new Uint8Array(4);
  const view = new DataView(buffer.buffer);
  writeUint32BE(view, 0, value);
  return buffer;
}

export function applyFlacTags(
  source: Uint8Array,
  metadata?: FlacTagMetadata | null,
  cover?: FlacPicture | null,
): Uint8Array {
  const hasMetadata = Boolean(metadata && Object.values(metadata).some(Boolean));
  const hasCover = Boolean(cover && cover.buffer.length > 0);
  if (!hasMetadata && !hasCover) return source;

  const parsed = parseBlocks(source);
  if (!parsed) return source;

  const streamInfo = parsed.blocks.find((block) => block.type === STREAMINFO_BLOCK_TYPE);
  if (!streamInfo) return source;

  const otherBlocks = parsed.blocks.filter((block) =>
    block.type !== STREAMINFO_BLOCK_TYPE && block.type !== VORBIS_COMMENT_BLOCK_TYPE && block.type !== PICTURE_BLOCK_TYPE
  );

  const newBlocks: FlacBlock[] = [{ type: STREAMINFO_BLOCK_TYPE, data: streamInfo.data }];

  if (hasMetadata && metadata) {
    newBlocks.push({ type: VORBIS_COMMENT_BLOCK_TYPE, data: buildVorbisCommentBlock(metadata) });
  }

  if (hasCover && cover) {
    newBlocks.push({ type: PICTURE_BLOCK_TYPE, data: buildPictureBlock(cover) });
  }

  newBlocks.push(...otherBlocks);

  const audioData = source.slice(parsed.audioOffset);
  const totalLength = 4 + newBlocks.reduce((sum, block) => sum + 4 + block.data.length, 0) + audioData.length;
  const output = new Uint8Array(totalLength);
  output.set(FLAC_HEADER_BYTES, 0);

  let offset = 4;
  newBlocks.forEach((block, index) => {
    const isLast = index === newBlocks.length - 1;
    const header = buildBlockHeader(block.type, isLast, block.data.length);
    output.set(header, offset);
    offset += header.length;
    output.set(block.data, offset);
    offset += block.data.length;
  });

  output.set(audioData, offset);
  return output;
}
