import { useState, type FormEvent } from "react";
import { formatDateTime } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useAddComment, useComments, useDeleteComment } from "../lib/hooks.js";
import { cardClass, inputClass, primaryButtonClass } from "./styles.js";

export function CommentsSection({ expenseId, readOnly }: { expenseId: string; readOnly: boolean }) {
  const { user } = useAuth();
  const query = useComments(expenseId);
  const addComment = useAddComment(expenseId);
  const deleteComment = useDeleteComment(expenseId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function attempt(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      return false;
    }
  }
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (await attempt(() => addComment.mutateAsync({ body }))) setBody("");
  }

  const comments = query.data ?? [];
  if (readOnly && comments.length === 0) return null;

  return (
    <section className={`mt-6 ${cardClass}`}>
      <h2 className="font-medium text-ink px-4 py-3.5">Comments</h2>
      {comments.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {comments.map((c) => (
            <li key={c.id} className="px-4 py-3 text-sm text-ink">
              <p className="text-xs text-ink-muted">
                {c.userId === user?.id ? "You" : c.displayName} · {formatDateTime(new Date(c.createdAt))}
                {!readOnly && c.userId === user?.id && (
                  <>
                    {" · "}
                    <button onClick={() => attempt(() => deleteComment.mutateAsync(c.id))} className="hover:text-rust transition-colors">
                      Delete
                    </button>
                  </>
                )}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-4 pb-2 text-sm text-rust">{error}</p>}
      {!readOnly && (
        <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-line">
          <input
            aria-label="Comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment"
            maxLength={2000}
            required
            className={`flex-1 min-w-0 ${inputClass}`}
          />
          <button type="submit" disabled={addComment.isPending} className={primaryButtonClass}>
            Post
          </button>
        </form>
      )}
    </section>
  );
}
