import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupDetail } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useDeleteGroup, useGroupAction, useLeaveGroup } from "../lib/hooks.js";
import { Button, ConfirmButton } from "./Button.js";

export function GroupActions({ group, settingsOpen, onSettings }: { group: GroupDetail; settingsOpen: boolean; onSettings: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const leaveGroup = useLeaveGroup(group.id);
  const deleteGroup = useDeleteGroup(group.id);
  const groupAction = useGroupAction(group.id);
  const [error, setError] = useState<string | null>(null);
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === "owner";

  async function attempt(action: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        {!group.archivedAt && (
          <Button icon="settings" aria-expanded={settingsOpen} onClick={onSettings}>
            Settings
          </Button>
        )}
        <Button
          icon={group.archivedAt ? "restore" : "archive"}
          disabled={groupAction.isPending}
          onClick={() => attempt(() => groupAction.mutateAsync(group.archivedAt ? "unarchive" : "archive"))}
        >
          {group.archivedAt ? "Unarchive" : "Archive"}
        </Button>
        {/* Apart from the rest, so neither is pressed by mistake. */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ConfirmButton
            icon="leave"
            label="Leave group"
            question={`Leave "${group.name}"?`}
            confirmLabel={leaveGroup.isPending ? "Leaving…" : "Leave"}
            pending={leaveGroup.isPending}
            onConfirm={() => attempt(() => leaveGroup.mutateAsync(), () => navigate("/"))}
          />
          {isOwner && (
            <ConfirmButton
              icon="trash"
              label="Delete group"
              question={`Delete "${group.name}" for everyone?`}
              confirmLabel={deleteGroup.isPending ? "Deleting…" : "Delete"}
              pending={deleteGroup.isPending}
              onConfirm={() => attempt(() => deleteGroup.mutateAsync(), () => navigate("/"))}
            />
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rust">
          {error}
        </p>
      )}
    </div>
  );
}
