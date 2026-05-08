/**
 * F5 — Campaigns hooks.
 *
 * Architect-locked signatures + queryKeys:
 *  - List:   `['campaigns', { page, limit, status }]`
 *  - Detail: `['campaign', id]`
 *
 * Polling rule (architect lock):
 *  - `useCampaign(id, { polling: true })` returns `refetchInterval: 1500`
 *    ONLY while the cached `data?.status === 'sending'`. As soon as the
 *    status moves on (e.g. -> 'sent'), the function returns `false` and
 *    polling stops on the next tick.
 *  - `refetchIntervalInBackground: false` — backgrounded tabs don't poll.
 *
 * Mutation cache strategy:
 *  - Create: invalidate ['campaigns'] (list refresh).
 *  - Schedule: setQueryData(['campaign', id], updated) AND invalidate
 *              ['campaigns'] so the list status badge flips.
 *  - Send: setQueryData(['campaign', id], { ...current, status: 'sending' })
 *          optimistically — the polling pass carries the rest. We do NOT
 *          mark `sent` here, per the F4 carry-forward rule.
 *  - Delete: invalidate ['campaigns'] and remove ['campaign', id]; the page
 *            navigates away on success.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query';

import type {
  Campaign,
  CampaignDetail,
  CampaignStatus,
  CreateCampaignRequest,
  PaginatedList,
  ScheduleCampaignRequest,
  SendCampaignResponse,
} from '@app/shared';

import { api } from '../lib/api';

/** Query params accepted by `GET /campaigns`. */
export interface ListQuery {
  page?: number;
  limit?: number;
  status?: CampaignStatus;
}

export function useCampaignsList(
  query: ListQuery,
): UseQueryResult<PaginatedList<Campaign>> {
  return useQuery({
    queryKey: ['campaigns', query] as const,
    queryFn: async () => {
      const { data } = await api.get<PaginatedList<Campaign>>('/campaigns', {
        params: query,
      });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useCampaign(
  id: string,
  opts: { polling?: boolean } = {},
): UseQueryResult<CampaignDetail> {
  return useQuery({
    queryKey: ['campaign', id] as const,
    queryFn: async () => {
      const { data } = await api.get<CampaignDetail>(`/campaigns/${id}`);
      return data;
    },
    enabled: Boolean(id),
    refetchInterval: (q) => {
      if (!opts.polling) return false;
      const data = q.state.data as CampaignDetail | undefined;
      return data?.status === 'sending' ? 1500 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useCreateCampaignMutation(): UseMutationResult<
  Campaign,
  unknown,
  CreateCampaignRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCampaignRequest) => {
      const { data } = await api.post<Campaign>('/campaigns', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useScheduleCampaignMutation(): UseMutationResult<
  Campaign,
  unknown,
  { id: string } & ScheduleCampaignRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduled_at }) => {
      const { data } = await api.post<Campaign>(
        `/campaigns/${id}/schedule`,
        { scheduled_at },
      );
      return data;
    },
    onSuccess: (updated, vars) => {
      // Merge into the existing CampaignDetail so stats/recipients persist.
      qc.setQueryData<CampaignDetail | undefined>(
        ['campaign', vars.id],
        (prev) => (prev ? { ...prev, ...updated } : prev),
      );
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useSendCampaignMutation(): UseMutationResult<
  SendCampaignResponse,
  unknown,
  { id: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      const { data } = await api.post<SendCampaignResponse>(
        `/campaigns/${id}/send`,
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      // Optimistic flip to 'sending' so the detail page polling kicks in
      // immediately. Polling carries the rest of the way to 'sent'.
      qc.setQueryData<CampaignDetail | undefined>(
        ['campaign', vars.id],
        (prev) => (prev ? { ...prev, status: 'sending' } : prev),
      );
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useDeleteCampaignMutation(): UseMutationResult<
  void,
  unknown,
  { id: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await api.delete(`/campaigns/${id}`);
    },
    onSuccess: (_data, vars) => {
      qc.removeQueries({ queryKey: ['campaign', vars.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
