/**
 * Geocodificação de códigos postais do Reino Unido via postcodes.io (U5,
 * autorizado pelo PO a 26/11/2026, opção b).
 *
 * postcodes.io: API pública e gratuita, sem chave e sem contrato, sobre
 * dados abertos (ONS Postcode Directory / OS). Só se envia o CÓDIGO POSTAL
 * (dado público de um local), nunca nomes ou outros dados.
 *
 * Lookup em lote: POST /postcodes { postcodes: [...] } (máx. 100 por pedido).
 */

export interface PostcodeGeo {
  postcode: string;
  lat: number;
  lng: number;
  admin_district: string | null; // ex: "Richmond upon Thames"
}

export type PostFetchFn = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface BulkResponse {
  status: number;
  result: { query: string; result: { postcode: string; latitude: number | null; longitude: number | null; admin_district: string | null } | null }[];
}

export const POSTCODES_IO_BASE_URL = 'https://api.postcodes.io';

export class PostcodesIoClient {
  constructor(
    private readonly fetchFn: PostFetchFn = (url, init) => fetch(url, init),
    private readonly baseUrl = POSTCODES_IO_BASE_URL,
    private readonly userAgent = 'VivereEngine/1.0 (uk pilot)',
  ) {}

  /** Devolve um mapa postcode normalizado → geo. Postcodes não encontrados ficam fora do mapa. */
  async lookup(postcodes: readonly string[]): Promise<Map<string, PostcodeGeo>> {
    const unique = [...new Set(postcodes.map((p) => p.trim().toUpperCase()).filter(Boolean))];
    const out = new Map<string, PostcodeGeo>();
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100);
      const res = await this.fetchFn(`${this.baseUrl}/postcodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': this.userAgent },
        body: JSON.stringify({ postcodes: batch }),
      });
      if (!res.ok) throw new Error(`PostcodesIoClient: HTTP ${res.status}`);
      const body = (await res.json()) as BulkResponse;
      if (!body || !Array.isArray(body.result)) throw new Error('PostcodesIoClient: resposta inesperada');
      for (const r of body.result) {
        const g = r.result;
        if (!g || typeof g.latitude !== 'number' || typeof g.longitude !== 'number') continue;
        out.set(r.query.trim().toUpperCase(), {
          postcode: g.postcode,
          lat: g.latitude,
          lng: g.longitude,
          admin_district: g.admin_district ?? null,
        });
      }
    }
    return out;
  }
}
