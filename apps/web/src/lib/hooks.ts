import { useRef } from "react";
import { uuidv7 } from "uuidv7";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ActivityItem,
  Category,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateSettlementRequest,
  CurrencyBalance,
  Expense,
  ExpenseHistoryEntry,
  GroupDebt,
  GroupDetail,
  GroupSummary,
  InviteInfo,
  MemberColor,
  Page,
  PairwiseBalance,
  PersonBalance,
  Settlement,
  SettlementHistoryEntry,
  UpdateExpenseRequest,
  UpdateProfileRequest,
  UpdateSettlementRequest,
  UserProfile,
} from "@splitty/shared";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api.js";

/** Adds a client-generated id to each create request. Retrying identical
 * content after a failure reuses the id, so if the first attempt did reach
 * the server it isn't recorded twice; success or an edit starts a new one. */
function useRetryableCreate<Input extends object, Result>(send: (input: Input) => Promise<Result>) {
  const pending = useRef<{ content: string; id: string } | null>(null);
  return async (input: Input): Promise<Result> => {
    const content = JSON.stringify(input);
    if (pending.current?.content !== content) pending.current = { content, id: uuidv7() };
    const result = await send({ ...input, id: pending.current.id });
    pending.current = null;
    return result;
  };
}

export function useGroups(): UseQueryResult<GroupSummary[]> {
  return useQuery({ queryKey: ["groups"], queryFn: () => apiGet("/groups") as Promise<GroupSummary[]> });
}

export function useGroup(groupId: string | null): UseQueryResult<GroupDetail> {
  return useQuery({
    queryKey: ["groups", groupId],
    queryFn: () => apiGet(`/groups/${groupId}`) as Promise<GroupDetail>,
    enabled: groupId !== null,
  });
}

/** A group's entries, or the direct ones shared with a person. */
export type ListScope = { groupId: string } | { personId: string };

function usePagedList<T>(queryKey: unknown[], path: string, params: Record<string, string> = {}) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }).toString();
      return apiGet(query ? `${path}?${query}` : path) as Promise<Page<T>>;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}

function useEntries<T>(kind: "expenses" | "settlements", scope: ListScope, deleted: boolean) {
  const path = "groupId" in scope ? `/groups/${scope.groupId}/${kind}` : `/${kind}`;
  return usePagedList<T>(["entries", kind, scope, { deleted }], path, {
    ...("personId" in scope ? { with: scope.personId } : {}),
    ...(deleted ? { deleted: "true" } : {}),
  });
}

export function useExpenses(scope: ListScope, deleted = false) {
  return useEntries<Expense>("expenses", scope, deleted);
}

export function useSettlements(scope: ListScope, deleted = false) {
  return useEntries<Settlement>("settlements", scope, deleted);
}

export function useGroupDebts(groupId: string): UseQueryResult<GroupDebt[]> {
  return useQuery({ queryKey: ["groups", groupId, "debts"], queryFn: () => apiGet(`/groups/${groupId}/debts`) as Promise<GroupDebt[]> });
}

export function usePerson(personId: string): UseQueryResult<PersonBalance> {
  return useQuery({
    queryKey: ["balances", "people", personId],
    queryFn: () => apiGet(`/balances/people/${personId}`) as Promise<PersonBalance>,
  });
}

export function useSettlement(settlementId: string): UseQueryResult<Settlement> {
  return useQuery({ queryKey: ["settlements", settlementId], queryFn: () => apiGet(`/settlements/${settlementId}`) as Promise<Settlement> });
}

export function useSettlementHistory(settlementId: string): UseQueryResult<SettlementHistoryEntry[]> {
  return useQuery({
    queryKey: ["settlements", settlementId, "history"],
    queryFn: () => apiGet(`/settlements/${settlementId}/history`) as Promise<SettlementHistoryEntry[]>,
  });
}

export function useExpense(expenseId: string): UseQueryResult<Expense> {
  return useQuery({ queryKey: ["expenses", expenseId], queryFn: () => apiGet(`/expenses/${expenseId}`) as Promise<Expense> });
}

export function useExpenseHistory(expenseId: string): UseQueryResult<ExpenseHistoryEntry[]> {
  return useQuery({
    queryKey: ["expenses", expenseId, "history"],
    queryFn: () => apiGet(`/expenses/${expenseId}/history`) as Promise<ExpenseHistoryEntry[]>,
  });
}

// Settled either way: a refused change usually means our copy is stale.
export function useUpdateExpense(expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateExpenseRequest) => apiPut(`/expenses/${expenseId}`, input) as Promise<Expense>,
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useSetExpenseDeleted(expenseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, deleted }: { version: number; deleted: boolean }) =>
      apiPost(`/expenses/${expenseId}/${deleted ? "delete" : "restore"}`, { version }) as Promise<Expense>,
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({ queryKey: ["categories"], queryFn: () => apiGet("/categories") as Promise<Category[]>, staleTime: Infinity });
}

export function useActivity(groupId?: string) {
  return usePagedList<ActivityItem>(["activity", groupId ?? null], groupId ? `/groups/${groupId}/activity` : "/activity");
}

export function useGlobalBalance(): UseQueryResult<CurrencyBalance[]> {
  return useQuery({ queryKey: ["balances"], queryFn: () => apiGet("/balances") as Promise<CurrencyBalance[]> });
}

export function usePeopleBalances(): UseQueryResult<PairwiseBalance[]> {
  return useQuery({ queryKey: ["balances", "people"], queryFn: () => apiGet("/balances/people") as Promise<PairwiseBalance[]> });
}

export function useInviteInfo(token: string): UseQueryResult<InviteInfo> {
  return useQuery({ queryKey: ["invites", token], queryFn: () => apiGet(`/invites/${token}`) as Promise<InviteInfo> });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (input: UpdateProfileRequest) => apiPatch("/auth/me", input) as Promise<UserProfile>,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupRequest) => apiPost("/groups", input) as Promise<GroupSummary>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useAddGroupMember(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => apiPost(`/groups/${groupId}/members`, { email }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups", groupId] }),
  });
}

export function useRemoveGroupMember(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiDelete(`/groups/${groupId}/members/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups", groupId] }),
  });
}

export function useLeaveGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/groups/${groupId}/leave`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useDeleteGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/groups/${groupId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
}

export function useSetMemberColor(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (color: MemberColor | null) => apiPatch(`/groups/${groupId}/color`, { color }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups", groupId] }),
  });
}

// A ledger change can touch balances, lists and activity in several places,
// so everything is refetched rather than guessing which.

/** `groupId: null` for a direct expense. */
export function useCreateExpense(groupId: string | null) {
  const queryClient = useQueryClient();
  const path = groupId ? `/groups/${groupId}/expenses` : "/expenses";
  const create = useRetryableCreate((input: CreateExpenseRequest) => apiPost(path, input) as Promise<Expense>);
  return useMutation({ mutationFn: (input: CreateExpenseRequest) => create(input), onSuccess: () => queryClient.invalidateQueries() });
}

/** `groupId: null` for a direct settlement. */
export function useCreateSettlement(groupId: string | null) {
  const queryClient = useQueryClient();
  const path = groupId ? `/groups/${groupId}/settlements` : "/settlements";
  const create = useRetryableCreate((input: CreateSettlementRequest) => apiPost(path, input) as Promise<Settlement>);
  return useMutation({ mutationFn: (input: CreateSettlementRequest) => create(input), onSuccess: () => queryClient.invalidateQueries() });
}

export function useUpdateSettlement(settlementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettlementRequest) => apiPut(`/settlements/${settlementId}`, input) as Promise<Settlement>,
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useSetSettlementDeleted(settlementId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, deleted }: { version: number; deleted: boolean }) =>
      apiPost(`/settlements/${settlementId}/${deleted ? "delete" : "restore"}`, { version }) as Promise<Settlement>,
    onSettled: () => queryClient.invalidateQueries(),
  });
}
