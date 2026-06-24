'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FilterState } from '@/components/ui/FilterSection';

// Central registry of query keys so reads and the mutations that invalidate
// them stay in sync. Favorite keys are nested under ['favorites', userId] so a
// single invalidation refreshes both the list and any per-trek status query.
export const queryKeys = {
  featuredTreks: ['treks', 'featured'] as const,
  searchTreks: (filters: FilterState, page: number) =>
    ['treks', 'search', filters, page] as const,
  favorites: (userId: string) => ['favorites', userId] as const,
  favoriteStatus: (userId: string, trekId: string) =>
    ['favorites', userId, trekId] as const,
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export interface FeaturedTrek {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  location: string;
  difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Expert';
  max_participants: number;
  estimated_cost: number;
  trek_batches?: { batch_date: string }[];
  real_participant_count: number;
  avg_rating: number | null;
}

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

/** Featured treks for the home page, enriched with live counts + ratings. */
export function useFeaturedTreks() {
  return useQuery({
    queryKey: queryKeys.featuredTreks,
    queryFn: async (): Promise<FeaturedTrek[]> => {
      // One RPC instead of N+1: search_treks already returns the avg rating and
      // (confirmed-only) participants_joined counter plus the next batch date.
      const { data, error } = await supabase.rpc('search_treks', {
        p_search: null,
        p_location: null,
        p_difficulty: null,
        p_min_distance: null,
        p_max_distance: null,
        p_min_price: null,
        p_max_price: null,
        p_date_from: null,
        p_sort: 'date',
        p_limit: 3,
        p_offset: 0,
      });
      if (error) throw error;

      return ((data ?? []) as SearchTrek[]).map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        cover_image_url: t.cover_image_url ?? '',
        location: t.location,
        difficulty: t.difficulty as FeaturedTrek['difficulty'],
        max_participants: t.max_participants ?? 0,
        estimated_cost: t.estimated_cost ?? 0,
        trek_batches: t.next_batch_date ? [{ batch_date: t.next_batch_date }] : [],
        real_participant_count: t.participants_joined ?? 0,
        avg_rating: t.rating ?? null,
      }));
    },
  });
}

export interface SearchTreksResult {
  treks: SearchTrek[];
  totalCount: number;
}

/** Filtered/sorted/paginated trek search backed by the `search_treks` RPC. */
export function useSearchTreks(filters: FilterState, page: number, perPage: number) {
  return useQuery({
    queryKey: queryKeys.searchTreks(filters, page),
    placeholderData: keepPreviousData,
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
