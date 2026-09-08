import { NextResponse, type NextRequest } from "next/server";
import { createDocumentStorage } from "@/lib/ingest/storage";

/**
 * Visualización de un documento almacenado.
 *
 * Permite abrir el justificante desde el propio asiento, sin salir del flujo de
 * conciliación. Con Supabase se redirige a una URL firmada de vida corta; en
 * local se sirve el archivo desde la zona de trabajo.
 *
 * El bucket es privado: nunca se expone una URL pública permanente.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ruta: string[] }> },
) {
  const { ruta } = await params;
  const storagePath = ruta.map((segment) => decodeURIComponent(segment)).join("/");

  // Un documento se identifica por periodo y huella: nada de rutas relativas.
  if (storagePath.includes("..") || storagePath.startsWith("/")) {
    return NextResponse.json({ error: "Ruta no válida." }, { status: 400 });
  }

  const storage = createDocumentStorage();

  if (storage.name === "supabase") {
    const url = await storage.signedUrl(storagePath);
    if (!url) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
    return NextResponse.redirect(url);
  }

  const bytes = await storage.read(storagePath);
  if (!bytes) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": contentTypeFor(storagePath),
      "Content-Disposition": `inline; filename="${fileNameFor(storagePath)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function contentTypeFor(storagePath: string): string {
  if (storagePath.endsWith(".pdf")) return "application/pdf";
  if (storagePath.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (storagePath.endsWith(".xlsx") || storagePath.endsWith(".xlsm")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (storagePath.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

function fileNameFor(storagePath: string): string {
  return storagePath.split("/").pop() ?? "documento";
}
