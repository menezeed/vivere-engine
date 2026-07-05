/**
 * Contratos de API partilhados entre todos os services do Admin Panel.
 *
 * ListResponse<T> é o contrato padronizado de listagem da Vivere Platform.
 * Todos os endpoints de listagem retornam este formato.
 * Qualquer mudança ao contrato (ex: adicionar hasNextPage) é feita aqui
 * e propaga automaticamente para todos os consumers.
 */

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  product_key?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}
