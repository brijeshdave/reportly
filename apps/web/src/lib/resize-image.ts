// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shrinks a chosen image to an avatar before it is uploaded.
//
// The resize happens here, not on the server, for two reasons: a phone camera photo
// is several megabytes and there is no reason to push that up a connection only to
// throw 99% of it away; and doing it in the browser keeps image decoding — a large
// and famously exploitable surface — out of the API entirely.
const SIZE = 256;

/**
 * Centre-crop to a square and scale to 256px, returned as base64 PNG (no data-URL
 * prefix). Cropping rather than squashing: a face stretched to fit a circle looks
 * broken, and every avatar in the app is round.
 */
export async function resizeToAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read that image");

    // Take the largest centred square of the source, then scale it down.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    bitmap.close();
  }
}
