// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Fastify glue every import/export route shares: pull the uploaded file off a
// multipart request, dispatch it to the right parser by extension, and send a workbook
// back as an .xlsx download. Kept apart from the pure spreadsheet module so that stays
// free of framework types.
import { ERROR_CODES } from "@reportly/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "@/core/errors.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Read the single uploaded file part, or fail with a clear 400/413. */
export async function readUpload(
  request: FastifyRequest,
): Promise<{ filename: string; buffer: Buffer }> {
  const part = await request.file();
  if (!part) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Attach a .xlsx or .csv file");
  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch {
    throw new AppError(413, ERROR_CODES.VALIDATION_ERROR, "That file is too large");
  }
  return { filename: (part.filename ?? "").toLowerCase(), buffer };
}

/** Read the upload and parse it with the CSV or XLSX parser, by extension. */
export async function parseUpload<T>(
  request: FastifyRequest,
  parseCsv: (text: string) => T | Promise<T>,
  parseXlsx: (buffer: Buffer) => Promise<T>,
): Promise<T> {
  const { filename, buffer } = await readUpload(request);
  return filename.endsWith(".csv") ? parseCsv(buffer.toString("utf8")) : parseXlsx(buffer);
}

/** Send a workbook buffer as an .xlsx attachment. */
export function sendXlsx(reply: FastifyReply, buffer: Buffer, filename: string): FastifyReply {
  reply
    .header("content-type", XLSX_MIME)
    .header("content-disposition", `attachment; filename="${filename}"`)
    .header("content-length", String(buffer.length))
    .header("cache-control", "no-store");
  return reply.send(buffer);
}
