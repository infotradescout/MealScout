import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Archive,
  ArrowRight,
  Building2,
  Loader2,
  MessageCircle,
  Send,
  UserRound,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { BackHeader } from "@/components/back-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Participant = {
  userId: string;
  participantType?: string | null;
  displayRole?: string | null;
  userType?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
  name?: string | null;
};

type Conversation = {
  id: string;
  subject?: string | null;
  restaurantId?: string | null;
  restaurantName?: string | null;
  restaurantBusinessType?: string | null;
  restaurantLogoUrl?: string | null;
  restaurantCoverImageUrl?: string | null;
  latestBody?: string | null;
  latestSenderUserId?: string | null;
  latestCreatedAt?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number | string | null;
  participants?: Participant[] | string | null;
};

type Message = {
  id: string;
  senderUserId?: string | null;
  senderName?: string | null;
  senderUserType?: string | null;
  senderProfileImageUrl?: string | null;
  body: string;
  createdAt?: string | null;
};

type ConversationDetail = {
  conversation: Conversation;
  participants: Participant[];
  messages: Message[];
};

type RestaurantPreview = {
  id: string;
  name: string;
  businessType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
};

function parseParticipants(value: Conversation["participants"]) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Participant[]) : [];
  } catch {
    return [];
  }
}

function participantName(participant: Participant | undefined | null) {
  if (!participant) return "MealScout user";
  const name = String(participant.name || "").trim();
  if (name) return name;
  const fullName = `${participant.firstName || ""} ${participant.lastName || ""}`.trim();
  if (fullName) return fullName;
  return participant.email || "MealScout user";
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "MS"
  );
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function businessLabel(type?: string | null) {
  if (type === "food_truck") return "Food truck";
  if (type === "bar") return "Bar";
  return "Business";
}

function getRedirectLoginPath() {
  const path = `${window.location.pathname}${window.location.search || ""}`;
  return `/login?redirect=${encodeURIComponent(path)}`;
}

export default function MessagesPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );
  const selectedId = params.get("conversationId") || "";
  const businessId = params.get("businessId") || "";
  const subjectParam = params.get("subject") || "";
  const [draft, setDraft] = useState("");
  const [startDraft, setStartDraft] = useState("");

  const conversationsQuery = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["/api/messages/conversations"],
    enabled: isAuthenticated,
  });

  const restaurantQuery = useQuery<RestaurantPreview>({
    queryKey: [`/api/restaurants/${businessId}`],
    enabled: isAuthenticated && Boolean(businessId) && !selectedId,
  });

  const detailQuery = useQuery<ConversationDetail>({
    queryKey: [`/api/messages/conversations/${selectedId}`],
    enabled: isAuthenticated && Boolean(selectedId),
  });

  const conversations = conversationsQuery.data?.conversations || [];

  useEffect(() => {
    if (!selectedId && !businessId && conversations.length > 0) {
      setLocation(`/messages?conversationId=${conversations[0].id}`);
    }
  }, [businessId, conversations, selectedId, setLocation]);

  const selectedConversation = useMemo(() => {
    if (detailQuery.data?.conversation) return detailQuery.data.conversation;
    return conversations.find((conversation) => conversation.id === selectedId);
  }, [conversations, detailQuery.data?.conversation, selectedId]);

  const selectedParticipants = useMemo(() => {
    if (detailQuery.data?.participants) return detailQuery.data.participants;
    return parseParticipants(selectedConversation?.participants);
  }, [detailQuery.data?.participants, selectedConversation?.participants]);

  const otherParticipants = useMemo(
    () =>
      selectedParticipants.filter(
        (participant) => participant.userId !== user?.id,
      ),
    [selectedParticipants, user?.id],
  );

  const selectedTitle =
    selectedConversation?.restaurantName ||
    selectedConversation?.subject ||
    otherParticipants.map(participantName).join(", ") ||
    "Conversation";

  const startTitle =
    restaurantQuery.data?.name || subjectParam || "this business";

  const startConversationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/messages/conversations", {
        restaurantId: businessId,
        subject: subjectParam || restaurantQuery.data?.name || undefined,
        body: startDraft,
      });
      return response.json() as Promise<{ conversationId: string }>;
    },
    onSuccess: async (payload) => {
      setStartDraft("");
      await queryClient.invalidateQueries({
        queryKey: ["/api/messages/conversations"],
      });
      setLocation(`/messages?conversationId=${payload.conversationId}`);
      toast({
        title: "Message sent",
        description: "The business can reply from their MealScout inbox.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Message not sent",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/messages/conversations/${selectedId}/messages`,
        { body: draft },
      );
      return response.json();
    },
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({
        queryKey: ["/api/messages/conversations"],
      });
      await queryClient.invalidateQueries({
        queryKey: [`/api/messages/conversations/${selectedId}`],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reply not sent",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (conversationId: string) =>
      apiRequest(
        "PATCH",
        `/api/messages/conversations/${conversationId}/archive`,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/messages/conversations"],
      });
      setLocation("/messages");
      toast({ title: "Conversation archived" });
    },
  });

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)] px-4 py-8 pb-24">
        <Card className="mx-auto max-w-md border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
          <CardContent className="space-y-4 p-6 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-[color:var(--accent-text)]" />
            <h1 className="text-2xl font-black">Sign in to message</h1>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Messages are private between you and the business.
            </p>
            <Link href={getRedirectLoginPath()}>
              <Button className="w-full">Sign in</Button>
            </Link>
          </CardContent>
        </Card>
        <Navigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] pb-24">
      <BackHeader
        title="Messages"
        fallbackHref="/dashboard"
        icon={MessageCircle}
        className="border-b border-[color:var(--border-subtle)] bg-[var(--bg-card)]"
      />

      <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
            <div>
              <h2 className="text-lg font-black">Inbox</h2>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Business and customer conversations
              </p>
            </div>
            {conversationsQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--text-secondary)]" />
            ) : (
              <Badge variant="outline">{conversations.length}</Badge>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {conversations.length === 0 && !conversationsQuery.isLoading ? (
              <div className="p-6 text-center">
                <MessageCircle className="mx-auto mb-3 h-9 w-9 text-[color:var(--text-secondary)]" />
                <p className="font-semibold">No messages yet</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Message a business from its MealScout profile.
                </p>
              </div>
            ) : null}

            {conversations.map((conversation) => {
              const participants = parseParticipants(conversation.participants);
              const other = participants.find(
                (participant) => participant.userId !== user.id,
              );
              const title =
                conversation.restaurantName ||
                participantName(other) ||
                conversation.subject ||
                "Conversation";
              const unread = Number(conversation.unreadCount || 0);
              const isActive = conversation.id === selectedId;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() =>
                    setLocation(`/messages?conversationId=${conversation.id}`)
                  }
                  className={`mb-2 flex w-full gap-3 rounded-lg border p-3 text-left transition ${
                    isActive
                      ? "border-[color:var(--accent-text)] bg-[color:var(--accent-text)]/10"
                      : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-card-hover)]"
                  }`}
                >
                  <Avatar className="h-11 w-11 flex-shrink-0">
                    <AvatarImage
                      src={
                        conversation.restaurantLogoUrl ||
                        conversation.restaurantCoverImageUrl ||
                        other?.profileImageUrl ||
                        undefined
                      }
                    />
                    <AvatarFallback>{initials(title)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-bold">{title}</p>
                      {unread > 0 ? (
                        <Badge className="h-5 min-w-5 justify-center rounded-full px-1">
                          {unread}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-[color:var(--text-secondary)]">
                      {conversation.latestBody || conversation.subject || "New conversation"}
                    </p>
                    <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                      {formatTime(conversation.latestCreatedAt || conversation.lastMessageAt)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="min-h-[58vh] rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
          {businessId && !selectedId ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-[color:var(--border-subtle)] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h1 className="text-xl font-black">Message {startTitle}</h1>
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      {businessLabel(restaurantQuery.data?.businessType)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-end gap-4 p-4">
                <Textarea
                  value={startDraft}
                  onChange={(event) => setStartDraft(event.target.value)}
                  placeholder="Ask about today's location, catering, availability, menu items, or booking details."
                  className="min-h-36 resize-none"
                  maxLength={4000}
                />
                <Button
                  size="lg"
                  disabled={
                    startDraft.trim().length === 0 ||
                    startConversationMutation.isPending
                  }
                  onClick={() => startConversationMutation.mutate()}
                  className="w-full"
                >
                  {startConversationMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send message
                </Button>
              </div>
            </div>
          ) : selectedId ? (
            <div className="flex h-full min-h-[58vh] flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] p-4">
                <div>
                  <h1 className="text-xl font-black">{selectedTitle}</h1>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedConversation?.restaurantBusinessType ? (
                      <Badge variant="outline">
                        {businessLabel(selectedConversation.restaurantBusinessType)}
                      </Badge>
                    ) : null}
                    {otherParticipants.slice(0, 3).map((participant) => (
                      <Badge key={participant.userId} variant="secondary">
                        {participant.displayRole || participantName(participant)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate(selectedId)}
                >
                  <Archive className="mr-2 h-4 w-4" />
                  Archive
                </Button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {detailQuery.isLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-[color:var(--text-secondary)]" />
                  </div>
                ) : null}

                {(detailQuery.data?.messages || []).map((message) => {
                  const isMine = message.senderUserId === user.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex gap-2 ${isMine ? "justify-end" : "justify-start"}`}
                    >
                      {!isMine ? (
                        <Avatar className="mt-1 h-8 w-8">
                          <AvatarImage src={message.senderProfileImageUrl || undefined} />
                          <AvatarFallback>
                            {initials(message.senderName || "MS")}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <div
                        className={`max-w-[82%] rounded-lg px-4 py-3 ${
                          isMine
                            ? "bg-[color:var(--accent-text)] text-black"
                            : "bg-[var(--bg-surface)] text-[color:var(--text-primary)]"
                        }`}
                      >
                        {!isMine ? (
                          <p className="mb-1 text-xs font-bold opacity-75">
                            {message.senderName || "MealScout user"}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {message.body}
                        </p>
                        <p className="mt-2 text-[11px] opacity-70">
                          {formatTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-[color:var(--border-subtle)] p-4">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a reply..."
                  className="min-h-24 resize-none"
                  maxLength={4000}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    disabled={
                      draft.trim().length === 0 || sendMessageMutation.isPending
                    }
                    onClick={() => sendMessageMutation.mutate()}
                  >
                    {sendMessageMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Reply
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[58vh] items-center justify-center p-6 text-center">
              <div>
                <UserRound className="mx-auto mb-4 h-10 w-10 text-[color:var(--text-secondary)]" />
                <h1 className="text-2xl font-black">Select a conversation</h1>
                <p className="mt-2 max-w-sm text-sm text-[color:var(--text-secondary)]">
                  Customer questions, booking details, and business replies live here.
                </p>
                <Link href="/search">
                  <Button variant="outline" className="mt-5">
                    Find a business
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>

      <Navigation />
    </div>
  );
}
