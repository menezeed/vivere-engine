import { describe, it, expect } from 'vitest';
import { assertAdminPanelEnv, AdminEnvGuardError, type AdminEnvGuardErrorCode } from '../viteEnvGuard';
import { SUPABASE_PROJECT_REFS, supabaseUrlFor } from '../../../src/config/environments';

const STAGING_REF = SUPABASE_PROJECT_REFS.staging;
const PRODUCTION_REF = SUPABASE_PROJECT_REFS.production;
const STAGING_URL = supabaseUrlFor('staging');
const PRODUCTION_URL = supabaseUrlFor('production');

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.SENTINELsig`;

const ANON_STAGING = jwt({ role: 'anon', ref: STAGING_REF });
const ANON_PRODUCTION = jwt({ role: 'anon', ref: PRODUCTION_REF });
const SERVICE_STAGING = jwt({ role: 'service_role', ref: STAGING_REF });
const PUBLISHABLE = 'sb_publishable_ANONSENTINEL0123456789';
const SECRET = 'sb_secret_SERVICESENTINEL0123456789';

const valid = (): Record<string, string | undefined> => ({
  VITE_API_BASE_URL: 'http://localhost:3001',
  VITE_SUPABASE_URL: STAGING_URL,
  VITE_SUPABASE_ANON_KEY: ANON_STAGING,
});

function codeOf(env: Record<string, string | undefined>): AdminEnvGuardErrorCode | 'OK' {
  try {
    assertAdminPanelEnv(env);
    return 'OK';
  } catch (err) {
    if (err instanceof AdminEnvGuardError) return err.code;
    throw err;
  }
}

describe('assertAdminPanelEnv — aceita só o staging', () => {
  it('aceita staging com JWT anon do staging', () => {
    expect(codeOf(valid())).toBe('OK');
  });

  it('aceita staging com chave sb_publishable_', () => {
    expect(codeOf({ ...valid(), VITE_SUPABASE_ANON_KEY: PUBLISHABLE })).toBe('OK');
  });

  it('aceita URL da Review API em https', () => {
    expect(codeOf({ ...valid(), VITE_API_BASE_URL: 'https://api.admin.vivere.com.br' })).toBe('OK');
  });
});

describe('assertAdminPanelEnv — bloqueia produção', () => {
  it('bloqueia o URL de produção', () => {
    expect(codeOf({ ...valid(), VITE_SUPABASE_URL: PRODUCTION_URL })).toBe('PRODUCTION_BLOCKED');
  });

  it('bloqueia o ref de produção mesmo com formato estranho', () => {
    expect(codeOf({ ...valid(), VITE_SUPABASE_URL: `https://${PRODUCTION_REF.toUpperCase()}.supabase.co/` })).toBe('PRODUCTION_BLOCKED');
  });

  it('bloqueia JWT anon de produção com URL de staging', () => {
    expect(codeOf({ ...valid(), VITE_SUPABASE_ANON_KEY: ANON_PRODUCTION })).toBe('PRODUCTION_BLOCKED');
  });
});

describe('assertAdminPanelEnv — chaves privilegiadas nunca entram no bundle', () => {
  it.each([
    ['sb_secret_ na anon key', { VITE_SUPABASE_ANON_KEY: SECRET }],
    ['JWT service_role na anon key', { VITE_SUPABASE_ANON_KEY: SERVICE_STAGING }],
    ['sb_secret_ noutra VITE_*', { VITE_QUALQUER_COISA: SECRET }],
    ['JWT supabase_admin noutra VITE_*', { VITE_OUTRA: jwt({ role: 'supabase_admin', ref: STAGING_REF }) }],
  ])('%s', (_label, extra) => {
    expect(codeOf({ ...valid(), ...extra })).toBe('PRIVILEGED_KEY_EXPOSED');
  });

  it('a verificação de privilégio corre antes da do URL', () => {
    expect(codeOf({ VITE_SUPABASE_ANON_KEY: SECRET })).toBe('PRIVILEGED_KEY_EXPOSED');
  });
});

describe('assertAdminPanelEnv — formato e presença', () => {
  it.each<[string, Record<string, string | undefined>, AdminEnvGuardErrorCode]>([
    ['URL ausente', { VITE_SUPABASE_URL: undefined }, 'URL_MISSING'],
    ['URL vazio', { VITE_SUPABASE_URL: '  ' }, 'URL_MISSING'],
    ['URL de outro projecto', { VITE_SUPABASE_URL: 'https://abcdefghijabcdefghij.supabase.co' }, 'URL_NOT_STAGING'],
    ['URL de staging com barra final', { VITE_SUPABASE_URL: `${STAGING_URL}/` }, 'URL_NOT_STAGING'],
    ['URL de staging em http', { VITE_SUPABASE_URL: STAGING_URL.replace('https', 'http') }, 'URL_NOT_STAGING'],
    ['anon key ausente', { VITE_SUPABASE_ANON_KEY: undefined }, 'ANON_KEY_MISSING'],
    ['anon key placeholder', { VITE_SUPABASE_ANON_KEY: 'your-anon-key-here' }, 'ANON_KEY_INVALID'],
    ['JWT com role authenticated', { VITE_SUPABASE_ANON_KEY: jwt({ role: 'authenticated', ref: STAGING_REF }) }, 'ANON_KEY_INVALID'],
    ['JWT anon sem ref', { VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) }, 'ANON_KEY_INVALID'],
    ['JWT anon de outro projecto', { VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'abcdefghijabcdefghij' }) }, 'ANON_KEY_INVALID'],
    ['JWT com payload ilegível', { VITE_SUPABASE_ANON_KEY: 'aaaa.bbbb.cccc' }, 'ANON_KEY_INVALID'],
    ['API URL ausente', { VITE_API_BASE_URL: undefined }, 'API_URL_INVALID'],
    ['API URL sem protocolo', { VITE_API_BASE_URL: 'localhost:3001' }, 'API_URL_INVALID'],
  ])('%s', (_label, override, expected) => {
    expect(codeOf({ ...valid(), ...override })).toBe(expected);
  });
});

describe('assertAdminPanelEnv — mensagens nunca expõem valores', () => {
  it.each<[string, Record<string, string | undefined>]>([
    ['secret', { VITE_SUPABASE_ANON_KEY: SECRET }],
    ['service_role', { VITE_SUPABASE_ANON_KEY: SERVICE_STAGING }],
    ['anon de produção', { VITE_SUPABASE_ANON_KEY: ANON_PRODUCTION }],
    ['placeholder', { VITE_SUPABASE_ANON_KEY: 'your-anon-key-here' }],
  ])('%s', (_label, override) => {
    const env = { ...valid(), ...override };
    let message = '';
    try {
      assertAdminPanelEnv(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(env['VITE_SUPABASE_ANON_KEY'] as string);
    expect(message).not.toContain('SENTINEL');
  });
});
