// Architectural render requests: detect them in chat, build the image prompt, format the reply.
// Helpers only; src/bot.js owns the queue, files and WhatsApp sending.
import sharp from 'sharp';
//
// Design (agreed with the user 2026-11-09):
// - A render needs a source image (sketch or an earlier render). Never fall back to text-to-image.
// - Furniture, positions, sizes, proportions, camera and openings must match the source exactly;
//   materials, light, mood and small decor are free. No text/signage in the picture.
// - Renders are not tied to a client; the prompt carries only the user's own words.

const RENDER_WORDS = '(?:เรนเดอร์|เรนเดอ|เรนดอร์|render|สร้างภาพ|ทำภาพ)';
const RENDER_START = new RegExp(`^(?:ช่วย|ขอ|ลอง)?\\s*${RENDER_WORDS}`, 'i');

/** Text (bot name already removed) asks for a new render. */
export function isRenderRequest(text) {
  return RENDER_START.test((text || '').trim());
}

/** The user's style/instruction words, without the "render this sketch" filler. */
export function renderInstruction(text) {
  return (text || '')
    .trim()
    .replace(RENDER_START, '')
    .replace(/(?:ภาพ|รูป)?\s*(?:จาก)?\s*(?:ตัว)?\s*(?:ไฟล์|ภาพ|รูป)?\s*(?:สเก็ต(?:ช์)?|sketch(?:up)?)\s*(?:ตัว|อัน|ภาพ|รูป)?\s*(?:นี้|นี่)?/gi, ' ')
    .replace(/^(?:ภาพ|รูป)?\s*(?:จาก)?\s*(?:ภาพ|รูป|ไฟล์)\s*(?:นี้|นี่)/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KEEP_RULES = [
  'STRICT — keep exactly as in the input image:',
  '- the camera position, angle, lens and framing;',
  '- every piece of furniture and every built-in element: its position, size, shape and proportions;',
  '- walls, ceiling, floor, doors, windows and all openings.',
  'Do not add, remove, move, resize or reshape any furniture or built-in element.',
];
const PADDING_NOTE =
  'If the input has flat grey bands at its edges, they are only padding: continue the same room/scene naturally into them; do not move or rescale the scene.';
const NO_TEXT =
  'Do not add any text, letters, labels, logos, signage, titles, borders, collages or presentation boards. Output one full-frame image.';

/**
 * @param {{ instruction?: string, isEdit?: boolean }} p
 *   isEdit = the input image is an earlier render and only the requested change should be applied.
 */
export function buildRenderPrompt({ instruction = '', isEdit = false }) {
  const words = instruction.trim();
  if (isEdit) {
    return [
      'Edit the input image, which is an architectural render.',
      `Apply only this change requested by the designer (may be in Thai or Lao): ${words}`,
      'Keep everything else identical: camera, furniture, layout, materials, colours and lighting, unless the change asks otherwise.',
      ...KEEP_RULES,
      PADDING_NOTE,
      NO_TEXT,
    ].join('\n');
  }
  return [
    'Turn the input image (a SketchUp / 3D model view or sketch) into a photorealistic architectural render of the same space.',
    ...KEEP_RULES,
    'FREE — you may choose and improve: materials, textures, colours, lighting, shadows, reflections, atmosphere,',
    'the view outside the windows, and small decor (plants, cushions, books, accessories) as long as it does not hide or replace a modelled item.',
    words
      ? `Style and wishes from the designer (may be in Thai or Lao), follow them: ${words}`
      : 'No style was given: choose a natural, realistic style that suits the model.',
    PADDING_NOTE,
    NO_TEXT,
  ].join('\n');
}

/** Caption sent under the rendered image. */
export function formatRenderCaption({ instruction = '', isEdit = false }) {
  const head = isEdit ? '🖼️ *ภาพที่ปรับแล้ว*' : '🖼️ *ภาพเรนเดอร์*';
  const what = instruction ? `${isEdit ? 'ปรับ' : 'สไตล์'}: ${instruction}` : null;
  return [head, what, '_ตอบกลับภาพนี้เพื่อสั่งปรับ เช่น "ไฟอุ่นขึ้น"_'].filter(Boolean).join('\n');
}

export const ASK_FOR_SKETCH = '🎨 ส่งสเก็ตมาได้เลยครับ ได้รูปแล้วจะเริ่มเรนเดอร์ทันที';
export const STARTED = '🎨 กำลังเรนเดอร์ครับ ประมาณ 1 นาที';

// The image model only outputs 1536x1024, 1024x1536 or 1024x1024. A SketchUp view is often much wider
// (e.g. 2.4:1), so: pad the source onto the closest canvas, render, then cut the same box back out and
// resize it to the source's own pixel size. Output framing and size then match the reference exactly.
const CANVASES = [
  { size: '1536x1024', width: 1536, height: 1024 },
  { size: '1024x1536', width: 1024, height: 1536 },
  { size: '1024x1024', width: 1024, height: 1024 },
];
const PAD = { r: 128, g: 128, b: 128, alpha: 1 };

/**
 * @param {Buffer} buf source image (any format sharp reads)
 * @returns {Promise<{ buffer: Buffer, size: string, padded: boolean,
 *   box: { left: number, top: number, width: number, height: number },
 *   canvas: { width: number, height: number }, source: { width: number, height: number } }>}
 */
export async function prepareSource(buf) {
  const img = sharp(buf, { failOn: 'none' }).rotate(); // respect EXIF orientation
  const { info } = await img.clone().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height };
  const ratio = source.width / source.height;
  const canvas = CANVASES.reduce((best, c) =>
    Math.abs(Math.log(c.width / c.height / ratio)) < Math.abs(Math.log(best.width / best.height / ratio)) ? c : best,
  );
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  const width = Math.min(canvas.width, Math.round(source.width * scale));
  const height = Math.min(canvas.height, Math.round(source.height * scale));
  const left = Math.floor((canvas.width - width) / 2);
  const top = Math.floor((canvas.height - height) / 2);
  const buffer = await img
    .resize(width, height)
    .extend({ top, bottom: canvas.height - height - top, left, right: canvas.width - width - left, background: PAD })
    .png()
    .toBuffer();
  return {
    buffer,
    size: canvas.size,
    padded: width < canvas.width || height < canvas.height,
    box: { left, top, width, height },
    canvas: { width: canvas.width, height: canvas.height },
    source,
  };
}

/** Cut the source's box out of the model output and resize it to the source's pixel size. */
export async function fitToSource(out, prep) {
  const meta = await sharp(out).metadata();
  const sx = meta.width / prep.canvas.width;
  const sy = meta.height / prep.canvas.height;
  const left = Math.round(prep.box.left * sx);
  const top = Math.round(prep.box.top * sy);
  const box = {
    left,
    top,
    width: Math.min(meta.width - left, Math.round(prep.box.width * sx)),
    height: Math.min(meta.height - top, Math.round(prep.box.height * sy)),
  };
  return sharp(out).extract(box).resize(prep.source.width, prep.source.height, { fit: 'fill' }).png().toBuffer();
}
