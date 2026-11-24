import { useRef } from "react";
import { uuidv7 } from "uuidv7";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateSettlementRequest,
  CurrencyBalance,
  Expense,
  GroupDetail,
  GroupSummary,
  InviteInfo,
  MemberColor,
  PairwiseBalance,
  Settlement,
  UpdateProfileRequest,
  UserProfile, ActivityItem, Category, ExpenseHistoryEntry, UpdateExpenseRequest } from "@splitty/shared";
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

export function useGroupExpenses(groupId: string, deleted = false): UseQueryResult<Expense[]> {
  return useQuery({
    queryKey: ["groups", groupId, "expenses", { deleted }],
    queryFn: () => apiGet(`/groups/${groupId}/expenses${deleted ? "?deleted=true" : ""}`) as Promise<Expense[]>,
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

export function useActivity(groupId?: string): UseQueryResult<ActivityItem[]> {
  return useQuery({
    queryKey: groupId ? ["groups", groupId, "activity"] : ["activity"],
    queryFn: () => apiGet(groupId ? `/groups/${groupId}/activity` : "/activity") as Promise<ActivityItem[]>,
  });
}

export function useGroupSettlements(groupId: string): UseQueryResult<Settlement[]> {
  return useQuery({
    queryKey: ["groups", groupId, "settlements"],
    queryFn: () => apiGet(`/groups/${groupId}/settlements`) as Promise<Settlement[]>,
  });
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

export function useCreateGroupExpense(groupId: string) {
  const queryClient = useQueryClient();
  const create = useRetryableCreate((input: CreateExpenseRequest) => apiPost(`/groups/${groupId}/expenses`, input) as Promise<Expense>);
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) => create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId, "expenses"] });
    },
  });
}

export function useCreateGroupSettlement(groupId: string) {
  const queryClient = useQueryClient();
  const create = useRetryableCreate((input: CreateSettlementRequest) => apiPost(`/groups/${groupId}/settlements`, input) as Promise<Settlement>);
  return useMutation({
    mutationFn: (input: CreateSettlementRequest) => create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId, "settlements"] });
    },
  });
}

export function useCreateDirectExpense() {
  const queryClient = useQueryClient();
  const create = useRetryableCreate((input: CreateExpenseRequest) => apiPost("/expenses", input) as Promise<Expense>);
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) => create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

export function useCreateDirectSettlement() {
  const queryClient = useQueryClient();
  const create = useRetryableCreate((input: CreateSettlementRequest) => apiPost("/settlements", input) as Promise<Settlement>);
  return useMutation({
    mutationFn: (input: CreateSettlementRequest) => create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}
