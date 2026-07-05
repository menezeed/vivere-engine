import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import type { ReviewAction } from '@/types/review';

export interface ReviewMutationConfig {
  approve: (id: string) => Promise<void>;
  reject:  (id: string) => Promise<void>;
  promote: (id: string) => Promise<void>;
  /** queryKeys a invalidar após sucesso */
  invalidateKeys: string[][];
  /** Mensagens de toast por acção */
  labels: Record<ReviewAction, string>;
}

/**
 * Hook genérico de mutation de revisão.
 * Elimina a duplicação entre VenuesPage, ActivitiesPage e qualquer
 * futuro módulo de revisão (Sources, Products, etc.).
 *
 * Expõe:
 * - mutate(id, action) — executa a acção
 * - isLoading(id) — true se este item específico está a ser processado
 * - activeId — id do item em processamento (null se nenhum)
 * - confirmPromote / cancelConfirm — para o ConfirmDialog de promote
 * - confirmState — { open, id } para o ConfirmDialog
 */
export function useReviewMutation(config: ReviewMutationConfig) {
  const qc = useQueryClient();
  const { success, error } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; id: string }>({
    open: false, id: '',
  });

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReviewAction }) => {
      setActiveId(id);
      if (action === 'approve') return config.approve(id);
      if (action === 'reject')  return config.reject(id);
      return config.promote(id);
    },
    onSuccess: (_, { action }) => {
      setActiveId(null);
      setConfirmState({ open: false, id: '' });
      success(config.labels[action]);
      config.invalidateKeys.forEach(key => qc.invalidateQueries({ queryKey: key }));
    },
    onError: (err) => {
      setActiveId(null);
      error('Erro na acção', String(err));
    },
  });

  function mutate(id: string, action: ReviewAction) {
    if (action === 'promote') {
      setConfirmState({ open: true, id });
    } else {
      mutation.mutate({ id, action });
    }
  }

  function confirmPromote() {
    mutation.mutate({ id: confirmState.id, action: 'promote' });
  }

  function cancelConfirm() {
    setConfirmState({ open: false, id: '' });
  }

  return {
    mutate,
    isLoading: (id: string) => mutation.isPending && activeId === id,
    isPending: mutation.isPending,
    confirmState,
    confirmPromote,
    cancelConfirm,
  };
}
