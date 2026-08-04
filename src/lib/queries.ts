'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  getMyCompanies,
  getCompanyOverview,
  getCompanyTreks,
  getTrek,
  getTrekBatches,
  getBatchParticipants,
  getCompanyMembers,
  getAdminOverview,
  getAllCompanies,
  getAdminCompany,
  isPlatformAdmin,
} from '@/lib/company';
import type { CompanyStatusFilter } from '@/lib/company';
import type { FilterState } from '@/components/ui/FilterSection';

// Central registry of query keys so reads and the mutations that invalidate
// them stay in sync. Favorite keys are nested under ['favorites', userId] so a
// single invalidation refreshes both the list and any per-trek status query.
export const queryKeys = {
  searchTreks: (filters: FilterState, page: number) =>
    ['treks', 'search', filters, page] as const,
  favorites: (userId: string) => ['favorites', userId] as const,
  favoriteStatus: (userId: string, trekId: string) =>
    ['favorites', userId, trekId] as const,
  myCompanies: (userId: string) => ['companies', 'mine', userId] as const,
  platformAdmin: (userId: string) => ['platformAdmin', userId] as const,
  companyOverview: (companyId: string) => ['companies', companyId, 'overview'] as const,
  companyTreks: (companyId: string, includeArchived: boolean) =>
    ['companies', companyId, 'treks', includeArchived] as const,
  trek: (trekId: string) => ['treks', 'detail', trekId] as const,
  trekBatches: (trekId: string) => ['treks', trekId, 'batches'] as const,
  batchParticipants: (batchId: string) => ['batches', batchId, 'participants'] as const,
  companyMembers: (companyId: string) => ['companies', companyId, 'members'] as const,
  adminOverview: ['admin', 'overview'] as const,
  adminCompanies: (status: string) => ['admin', 'companies', status] as const,
  adminCompany: (companyId: string) => ['admin', 'company', companyId] as const,
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export interface SearchTrek {
  id: string;
  title: string;
  description: string;
  cover_image_url?: string;
  location: string;
  difficulty: string;
  distance_km?: number;
  max_participants?: number;
  rating?: number;
  estimated_cost?: number;
  participants_joined?: number;
  next_batch_date?: string | null;
  company_id?: string;
  company_name?: string;
  company_slug?: string;
  total_count?: number;
}

export interface FavoriteTrek {
  id: string;
  title: string;
  location: string;
  cover_image_url: string;
  difficulty: string;
  participants_joined: number;
}

export interface FavoriteRow {
  user_id: string;
  trek_id: string;
  created_at: string;
  treks: FavoriteTrek | FavoriteTrek[] | null;
}

export interface SearchTreksResult {
  treks: SearchTrek[];
  totalCount: number;
}

/**
 * Filtered/sorted/paginated trek search backed by the `search_treks` RPC.
 *
 * `initialData` seeds the one query the Explore server component already ran
 * (default filters, page 1) so the SSR'd grid isn't immediately refetched. Pass
 * it only for that exact key — TanStack stores it against the current key.
 */
export function useSearchTreks(
  filters: FilterState,
  page: number,
  perPage: number,
  initialData?: SearchTreksResult
) {
  return useQuery({
    queryKey: queryKeys.searchTreks(filters, page),
    placeholderData: keepPreviousData,
    initialData,
    queryFn: async (): Promise<SearchTreksResult> => {
      const { data, error } = await supabase.rpc('search_treks', {
        p_search: filters.search.trim() || null,
        p_location: filters.location || null,
        p_difficulty: filters.difficulty || null,
        p_min_distance: num(filters.minDistance),
        p_max_distance: num(filters.maxDistance),
        p_min_price: num(filters.minPrice),
        p_max_price: num(filters.maxPrice),
        p_date_from: filters.date || null,
        p_sort: filters.sort || 'date',
        p_limit: perPage,
        p_offset: (page - 1) * perPage,
      });
      if (error) throw error;

      const rows = (data ?? []) as SearchTrek[];
      return { treks: rows, totalCount: rows[0]?.total_count ?? 0 };
    },
  });
}

/** A user's saved treks. Disabled until a user id is known. */
export function useFavorites(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.favorites(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<FavoriteRow[]> => {
      const { data, error } = await supabase
        .from('favorites')
        .select(
          `
          user_id,
          trek_id,
          created_at,
          treks (
            id,
            title,
            location,
            cover_image_url,
            difficulty,
            participants_joined
          )
        `
        )
        .eq('user_id', userId!);
      if (error) throw error;
      return (data as FavoriteRow[]) ?? [];
    },
  });
}

/** Whether a single trek is favorited by the user. */
export function useFavoriteStatus(userId: string | undefined, trekId: string) {
  return useQuery({
    queryKey: queryKeys.favoriteStatus(userId ?? '', trekId),
    enabled: !!userId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('favorites')
        .select('trek_id')
        .eq('user_id', userId!)
        .eq('trek_id', trekId);
      if (error) throw error;
      return !!data?.length;
    },
  });
}

/** Remove a favorite, then refresh the user's favorite queries. */
export function useRemoveFavorite(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trekId: string) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('trek_id', trekId);
      if (error) throw error;
    },
    onMutate: async (trekId) => {
      if (!userId) return;
      const listKey = queryKeys.favorites(userId);
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      const previous = queryClient.getQueryData<FavoriteRow[]>(listKey);
      queryClient.setQueryData<FavoriteRow[]>(listKey, (rows) =>
        (rows ?? []).filter((r) => r.trek_id !== trekId)
      );
      return { listKey, previous };
    },
    onError: (_err, _trekId, context) => {
      if (context) queryClient.setQueryData(context.listKey, context.previous);
    },
    onSettled: () => {
      if (userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.favorites(userId), exact: true });
      }
    },
  });
}

/** Toggle a favorite on/off, then refresh the user's favorite queries. */
export function useToggleFavorite(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ trekId, isLiked }: { trekId: string; isLiked: boolean }) => {
      if (!userId) throw new Error('Not authenticated');
      if (isLiked) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('trek_id', trekId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert([{ user_id: userId, trek_id: trekId }]);
        if (error) throw error;
      }
    },
    onMutate: async ({ trekId, isLiked }) => {
      if (!userId) return;
      const statusKey = queryKeys.favoriteStatus(userId, trekId);
      await queryClient.cancelQueries({ queryKey: statusKey, exact: true });
      const previous = queryClient.getQueryData<boolean>(statusKey);
      queryClient.setQueryData<boolean>(statusKey, !isLiked);
      return { statusKey, previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(context.statusKey, context.previous);
    },
    onSettled: (_data, _err, { trekId }) => {
      if (!userId) return;
      // Scope invalidation: refresh only this trek's status + the favorites list,
      // not every favorite-status query on the page (the old broad-prefix storm).
      queryClient.invalidateQueries({ queryKey: queryKeys.favoriteStatus(userId, trekId), exact: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites(userId), exact: true });
    },
  });
}

/** Companies the signed-in user belongs to (any role). Disabled until a user id is known. */
export function useMyCompanies(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.myCompanies(userId ?? ''),
    enabled: !!userId,
    queryFn: getMyCompanies,
  });
}

/** Whether the signed-in user is a platform admin (gates the /admin nav link). */
export function usePlatformAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.platformAdmin(userId ?? ''),
    enabled: !!userId,
    queryFn: isPlatformAdmin,
  });
}

/** Dashboard headline stats for a company. */
export function useCompanyOverview(companyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.companyOverview(companyId ?? ''),
    enabled: !!companyId,
    queryFn: () => getCompanyOverview(companyId!),
  });
}

/** A company's own treks for the dashboard. Disabled until a company id is known. */
export function useCompanyTreks(companyId: string | undefined, includeArchived: boolean) {
  return useQuery({
    queryKey: queryKeys.companyTreks(companyId ?? '', includeArchived),
    enabled: !!companyId,
    queryFn: () => getCompanyTreks(companyId!, includeArchived),
  });
}

/** A single trek for the edit form. */
export function useTrek(trekId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trek(trekId ?? ''),
    enabled: !!trekId,
    queryFn: () => getTrek(trekId!),
  });
}

/** Dated departures for a trek, with live confirmed counts. */
export function useTrekBatches(trekId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trekBatches(trekId ?? ''),
    enabled: !!trekId,
    queryFn: () => getTrekBatches(trekId!),
  });
}

/** Roster (with contact PII) for one batch, via the company roster RPC. */
export function useBatchParticipants(batchId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.batchParticipants(batchId ?? ''),
    enabled: !!batchId,
    queryFn: () => getBatchParticipants(batchId!),
  });
}

/** A company's team roster (identity via SECURITY DEFINER RPC). */
export function useCompanyMembers(companyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.companyMembers(companyId ?? ''),
    enabled: !!companyId,
    queryFn: () => getCompanyMembers(companyId!),
  });
}

/** Platform-wide headline counts for the /admin overview. */
export function useAdminOverview() {
  return useQuery({
    queryKey: queryKeys.adminOverview,
    queryFn: getAdminOverview,
  });
}

/** All companies for the /admin list, filtered by status. */
export function useAdminCompanies(status: CompanyStatusFilter) {
  return useQuery({
    queryKey: queryKeys.adminCompanies(status),
    queryFn: () => getAllCompanies(status),
  });
}

/** A single company (with audit columns) for the /admin detail view. */
export function useAdminCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.adminCompany(companyId ?? ''),
    enabled: !!companyId,
    queryFn: () => getAdminCompany(companyId!),
  });
}
