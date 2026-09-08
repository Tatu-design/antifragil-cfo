import "server-only";
import type { DriveClient, DriveFile } from "./types";

/**
 * Cliente REST de Google Drive.
 *
 * Se usa la API REST directamente en lugar del SDK completo: solo hacen falta
 * dos operaciones de listado, y así no entra una dependencia grande por dos
 * llamadas.
 *
 * El método de autenticación definitivo (OAuth de usuario vs cuenta de
 * servicio) está pendiente de decisión con el CTO. Este cliente solo pide un
 * proveedor de access token, así que la decisión no afecta al resto del código.
 *
 * Las credenciales viven SOLO en el servidor. El import de "server-only" hace
 * que el build falle si alguien arrastra este módulo al navegador.
 */

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size,parents)";

export interface DriveClientOptions {
  /** Devuelve un access token válido. Lo implementa la estrategia elegida. */
  getAccessToken: () => Promise<string>;
  /** Inyectable para tests. Por defecto, el fetch global. */
  fetchImpl?: typeof fetch;
}

export function createDriveClient(options: DriveClientOptions): DriveClient {
  const doFetch = options.fetchImpl ?? fetch;

  async function list(query: string): Promise<DriveFile[]> {
    const token = await options.getAccessToken();
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(DRIVE_FILES_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", FIELDS);
      url.searchParams.set("pageSize", "1000");
      // Necesario para carpetas en unidades compartidas.
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await doFetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(
          `Drive respondió ${response.status} ${response.statusText} al listar (${query}).`,
        );
      }

      const payload = (await response.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      files.push(...(payload.files ?? []));
      pageToken = payload.nextPageToken;
    } while (pageToken);

    return files;
  }

  return {
    listFolders(parentId: string) {
      return list(`'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    },
    listFiles(parentId: string) {
      return list(`'${parentId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`);
    },
  };
}
