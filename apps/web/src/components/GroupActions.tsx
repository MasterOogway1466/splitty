import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupDetail } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useDeleteGroup, useGroupAction, useLeaveGroup } from "../lib/hooks.js";
import { linkButtonClass } from "./styles.js";

export function GroupActions({ group, onSettings }: { group: GroupDetail; onSettings: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const leaveGroup = useLeaveGroup(group.id);
  const deleteGroup = useDeleteGroup(group.id);
  const groupAction = useGroupAction(group.id);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === "owner";

  async function handleArchive() {
    setArchiveError(null);
    try {
      await groupAction.mutateAsync(group.archivedAt ? "unarchive" : "archive");
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function handleLeave() {
    setLeaveError(null);
    try {
      await leaveGroup.mutateAsync();
      navigate("/");
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : "Something went wrong");
      setConfirmLeave(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteGroup.mutateAsync();
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Something went wrong");
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        {!group.archivedAt && (
          <button onClick={onSettings} className={linkButtonClass}>
            Settings
          </button>
        )}
        <button onClick={handleArchive} disabled={groupAction.isPending} className={linkButtonClass}>
          {group.archivedAt ? "Unarchive" : "Archive"}
        </button>
        {confirmLeave ? (
          <span className="text-sm text-ink-muted">
            Leave "{group.name}"?{" "}
            <button onClick={handleLeave} disabled={leaveGroup.isPending} className="text-rust font-medium hover:underline">
              {leaveGroup.isPending ? "Leaving…" : "Confirm"}
            </button>{" "}
            <button onClick={() => setConfirmLeave(false)} className="text-ink-muted hover:underline">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmLeave(true)} className={linkButtonClass}>
            Leave group
          </button>
        )}

        {isOwner &&
          (confirmDelete ? (
            <span className="text-sm text-ink-muted">
              Delete "{group.name}" for everyone?{" "}
              <button onClick={handleDelete} disabled={deleteGroup.isPending} className="text-rust font-medium hover:underline">
                {deleteGroup.isPending ? "Deleting…" : "Confirm"}
              </button>{" "}
              <button onClick={() => setConfirmDelete(false)} className="text-ink-muted hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className={linkButtonClass}>
              Delete group
            </button>
          ))}
      </div>
      {archiveError && <p className="text-sm text-rust mb-4">{archiveError}</p>}
      {leaveError && <p className="text-sm text-rust mb-4">{leaveError}</p>}
      {deleteError && <p className="text-sm text-rust mb-4">{deleteError}</p>}
    </>
  );
}
