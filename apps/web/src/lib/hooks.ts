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
} from "@splitty/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.js";

export function useGroups(): UseQueryResult<GroupSummary[]> {
  return useQuery({ queryKey: ["groups"], queryFn: () => apiGet("/groups") as Promise<GroupSummary[]> });
}

export function useGroup(groupId: string): UseQueryResult<GroupDetail> {
  return useQuery({ queryKey: ["groups", groupId], queryFn: () => apiGet(`/groups/${groupId}`) as Promise<GroupDetail> });
}

export function useGroupExpenses(groupId: string): UseQueryResult<Expense[]> {
  return useQuery({ queryKey: ["groups", groupId, "expenses"], queryFn: () => apiGet(`/groups/${groupId}/expenses`) as Promise<Expense[]> });
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
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) => apiPost(`/groups/${groupId}/expenses`, input) as Promise<Expense>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId, "expenses"] });
    },
  });
}

export function useCreateGroupSettlement(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementRequest) => apiPost(`/groups/${groupId}/settlements`, input) as Promise<Settlement>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["groups", groupId, "settlements"] });
    },
  });
}

export function useCreateDirectExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) => apiPost("/expenses", input) as Promise<Expense>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}

export function useCreateDirectSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementRequest) => apiPost("/settlements", input) as Promise<Settlement>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });
}
