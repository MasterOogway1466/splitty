import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupDetail } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useDeleteGroup, useLeaveGroup } from "../lib/hooks.js";
import { linkButtonClass } from "./styles.js";

export function GroupActions({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const leaveGroup = useLeaveGroup(group.id);
  const deleteGroup = useDeleteGroup(group.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === "owner";

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
      <div className="mb-6 flex items-center gap-4">
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
      {leaveError && <p className="text-sm text-rust mb-4">{leaveError}</p>}
      {deleteError && <p className="text-sm text-rust mb-4">{deleteError}</p>}
    </>
  );
}
