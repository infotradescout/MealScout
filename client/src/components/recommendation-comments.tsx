import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MessageCircle, Reply, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";

type CommentTargetType = "story" | "recommendation";

type RecommendationComment = {
  id: string;
  userId: string;
  parentCommentId: string | null;
  text: string;
  createdAt?: string;
  authorName: string;
};

type RecommendationCommentsProps = {
  targetType: CommentTargetType;
  targetId: string;
  initialCount?: number;
  compact?: boolean;
  defaultOpen?: boolean;
  hideToggle?: boolean;
  onCountChange?: (count: number) => void;
};

const endpointFor = (targetType: CommentTargetType, targetId: string) =>
  targetType === "story"
    ? `/api/stories/${encodeURIComponent(targetId)}/comments`
    : `/api/recommendations/${encodeURIComponent(targetId)}/comments`;

const queryKeyFor = (targetType: CommentTargetType, targetId: string) => [
  targetType,
  targetId,
  "comments",
];

export function RecommendationComments({
  targetType,
  targetId,
  initialCount = 0,
  compact = false,
  defaultOpen = false,
  hideToggle = false,
  onCountChange,
}: RecommendationCommentsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<RecommendationComment | null>(null);
  const endpoint = endpointFor(targetType, targetId);
  const queryKey = queryKeyFor(targetType, targetId);

  const { data, isLoading } = useQuery<{ comments: RecommendationComment[] }>({
    queryKey,
    enabled: open && Boolean(targetId),
    queryFn: async () => {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load comments");
      return response.json();
    },
  });

  const comments = data?.comments ?? [];
  const topLevelComments = useMemo(
    () => comments.filter((comment) => !comment.parentCommentId),
    [comments],
  );

  const repliesByParent = useMemo(() => {
    const map = new Map<string, RecommendationComment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      const list = map.get(comment.parentCommentId) ?? [];
      list.push(comment);
      map.set(comment.parentCommentId, list);
    }
    return map;
  }, [comments]);

  const commentCount = open ? comments.length : initialCount;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        text: text.trim(),
        parentCommentId: replyTo?.id ?? null,
      };
      const response = await apiRequest("POST", endpoint, payload);
      return response.json();
    },
    onSuccess: async () => {
      setText("");
      setReplyTo(null);
      await queryClient.invalidateQueries({ queryKey });
      onCountChange?.(commentCount + 1);
    },
  });

  const submit = () => {
    if (!text.trim() || mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <div className={compact ? "mt-3" : "mt-4"}>
      {!hideToggle ? (
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          className={compact ? "h-8 px-2" : "w-full justify-center"}
          onClick={() => setOpen((current) => !current)}
        >
          <MessageCircle className="w-3.5 h-3.5 mr-1" />
          {commentCount}
        </Button>
      ) : null}

      {open ? (
        <div className="mt-3 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-3">
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Be the first to respond.
              </p>
            ) : (
              topLevelComments.map((comment) => (
                <div key={comment.id} className="space-y-2">
                  <CommentBubble
                    comment={comment}
                    onReply={() => setReplyTo(comment)}
                  />
                  {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                    <div key={reply.id} className="ml-5">
                      <CommentBubble
                        comment={reply}
                        onReply={() => setReplyTo(comment)}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {replyTo ? (
            <div className="flex items-center justify-between rounded-xl bg-[var(--bg-card)] px-3 py-2 text-xs text-muted-foreground">
              <span>Replying to {replyTo.authorName}</span>
              <button type="button" onClick={() => setReplyTo(null)}>
                Clear
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={500}
              placeholder="Add a response..."
              className="min-h-20 resize-none"
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!text.trim() || mutation.isPending}
              onClick={submit}
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              Post response
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommentBubble({
  comment,
  onReply,
}: {
  comment: RecommendationComment;
  onReply: () => void;
}) {
  return (
    <div className="rounded-xl bg-[var(--bg-card)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{comment.authorName}</p>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {comment.text}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onReply}
        >
          <Reply className="w-3 h-3" />
          Reply
        </button>
      </div>
    </div>
  );
}
