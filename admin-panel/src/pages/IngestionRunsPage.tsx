import { useQuery } from '@tanstack/react-query';
import { StatsService } from '@/services/StatsService';
import { Clock } from 'lucide-react';

export function IngestionRunsPage() {
  const { data: runs, isLoading } = useQuery({
    queryKey: ['ingestion-runs-full'],
    queryFn: () => StatsService.getIngestionRuns(50),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-vivere-dark mb-6">Histórico de Ingestões</h1>

      {isLoading ? (
        <p className="text-sm text-gray-400">A carregar...</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">ID</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Source</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Itens</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Erros</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Início</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs?.map(run => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {run.id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{run.source_key}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      run.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{run.items_collected}</td>
                  <td className="px-4 py-3">
                    <span className={run.items_errored > 0 ? 'text-orange-600' : 'text-gray-400'}>
                      {run.items_errored}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 flex items-center gap-1">
                    <Clock size={12} />
                    {new Date(run.started_at).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
