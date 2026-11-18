"use client";

import * as React from "react";
import Link from "next/link";
import {
  Hash,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Company {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface ChatUser {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

interface Member extends ChatUser {
  organizationRole: string;
}

interface Participant {
  id: string;
  userId: string;
  role: string;
  user: ChatUser;
}

interface Conversation {
  id: string;
  organizationId: string;
  type: "DIRECT" | "GROUP";
  name: string | null;
  displayName: string;
  role: string;
  muted: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  updatedAt: string;
  participants: Participant[];
  lastMessage: {
    id: string;
    body: string;
    createdAt: string;
    sender: ChatUser | null;
  } | null;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  kind: string;
  createdAt: string;
  editedAt: string | null;
  sender: ChatUser | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return (payload?.data ?? payload) as T;
}

function initials(user: Pick<ChatUser, "name" | "email"> | null): string {
  const source = user?.name?.trim() || user?.email || "?";
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function messageTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function CommunicationsCenter() {
  const currentUser = useAuthStore((state) => state.user);
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [organizationId, setOrganizationId] = React.useState("");
  const [members, setMembers] = React.useState<Member[]>([]);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [loadingCompanies, setLoadingCompanies] = React.useState(true);
  const [loadingRooms, setLoadingRooms] = React.useState(false);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [conversationFilter, setConversationFilter] = React.useState("");
  const [messageSearchInput, setMessageSearchInput] = React.useState("");
  const [messageSearch, setMessageSearch] = React.useState("");
  const [composer, setComposer] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createType, setCreateType] = React.useState<"DIRECT" | "GROUP">("DIRECT");
  const [groupName, setGroupName] = React.useState("");
  const [selectedMembers, setSelectedMembers] = React.useState<string[]>([]);
  const [creating, setCreating] = React.useState(false);
  const messageEndRef = React.useRef<HTMLDivElement>(null);
  const selectedIdRef = React.useRef("");

  const selectConversation = React.useCallback((conversationId: string) => {
    if (selectedIdRef.current === conversationId) return;
    selectedIdRef.current = conversationId;
    setSelectedId(conversationId);
    setMessages([]);
    setNextCursor(null);
    setHasMore(false);
    setMessageSearch("");
    setMessageSearchInput("");
    setComposer("");
  }, []);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const visibleConversations = conversations.filter((conversation) => {
    const query = conversationFilter.trim().toLowerCase();
    if (!query) return true;
    return (
      conversation.displayName.toLowerCase().includes(query) ||
      (conversation.lastMessage?.body ?? "").toLowerCase().includes(query)
    );
  });

  const loadConversations = React.useCallback(
    async (companyId: string, options?: { silent?: boolean; preferId?: string }) => {
      if (!companyId) return;
      if (!options?.silent) setLoadingRooms(true);
      try {
        const [conversationData, memberData] = await Promise.all([
          api<{ conversations: Conversation[] }>(
            `/api/communications/conversations?organizationId=${encodeURIComponent(companyId)}`,
          ),
          api<{ members: Member[] }>(
            `/api/communications/members?organizationId=${encodeURIComponent(companyId)}`,
          ),
        ]);
        setConversations(conversationData.conversations);
        setMembers(memberData.members);
        const preferred = options?.preferId || selectedIdRef.current;
        const nextId =
          preferred && conversationData.conversations.some((item) => item.id === preferred)
            ? preferred
            : (conversationData.conversations[0]?.id ?? "");
        selectConversation(nextId);
      } catch (error) {
        if (!options?.silent) toast.error(error instanceof Error ? error.message : "Could not load conversations");
      } finally {
        if (!options?.silent) setLoadingRooms(false);
      }
    },
    [selectConversation],
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ companies: Company[] }>("/api/companies");
        if (cancelled) return;
        setCompanies(data.companies);
        const firstCompanyId = data.companies[0]?.id ?? "";
        setOrganizationId(firstCompanyId);
        if (firstCompanyId) await loadConversations(firstCompanyId);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load companies");
      } finally {
        if (!cancelled) setLoadingCompanies(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConversations]);

  const markRead = React.useCallback(async (conversationId: string, messageId: string) => {
    try {
      await api(`/api/communications/conversations/${conversationId}/read`, {
        method: "PATCH",
        body: JSON.stringify({ messageId }),
      });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
        ),
      );
    } catch {
      // The next refresh retries. Reading must never interrupt the chat surface.
    }
  }, []);

  const loadMessages = React.useCallback(
    async (
      conversationId: string,
      options?: { older?: boolean; silent?: boolean; query?: string; cursor?: string | null },
    ) => {
      if (!conversationId) return;
      if (!options?.silent) setLoadingMessages(true);
      const query = options?.query ?? "";
      try {
        const params = new URLSearchParams({ conversationId, limit: "50" });
        if (query) params.set("q", query);
        if (options?.older && options.cursor) params.set("cursor", options.cursor);
        const data = await api<{
          messages: Message[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(`/api/communications/messages?${params.toString()}`);

        setMessages((current) => {
          if (options?.older) {
            const byId = new Map([...data.messages, ...current].map((message) => [message.id, message]));
            return [...byId.values()].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            );
          }
          if (options?.silent && !query) {
            const byId = new Map([...current, ...data.messages].map((message) => [message.id, message]));
            return [...byId.values()].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            );
          }
          return data.messages;
        });
        if (!options?.silent || options?.older) {
          setNextCursor(data.nextCursor);
          setHasMore(data.hasMore);
        }
        if (!query) {
          const newest = data.messages[data.messages.length - 1];
          if (newest) void markRead(conversationId, newest.id);
        }
      } catch (error) {
        if (!options?.silent) toast.error(error instanceof Error ? error.message : "Could not load messages");
      } finally {
        if (!options?.silent) setLoadingMessages(false);
      }
    },
    [markRead],
  );

  React.useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      void loadMessages(selectedId, { query: "" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadMessages]);

  React.useEffect(() => {
    if (!selectedId || messageSearch) return;
    const timer = window.setInterval(() => {
      void loadMessages(selectedId, { silent: true, query: "" });
      if (organizationId) void loadConversations(organizationId, { silent: true, preferId: selectedId });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [selectedId, organizationId, messageSearch, loadMessages, loadConversations]);

  React.useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, selectedId]);

  function changeOrganization(companyId: string) {
    if (companyId === organizationId) return;
    selectConversation("");
    setConversations([]);
    setMembers([]);
    setConversationFilter("");
    setOrganizationId(companyId);
    void loadConversations(companyId);
  }

  async function sendMessage() {
    const body = composer.trim();
    if (!selectedId || !body || sending) return;
    setSending(true);
    try {
      await api("/api/communications/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: selectedId, body }),
      });
      setComposer("");
      setMessageSearch("");
      setMessageSearchInput("");
      await Promise.all([
        loadMessages(selectedId, { query: "" }),
        organizationId
          ? loadConversations(organizationId, { silent: true, preferId: selectedId })
          : Promise.resolve(),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  async function createConversation() {
    if (!organizationId || creating) return;
    setCreating(true);
    try {
      const result = await api<{ conversation: { id: string }; existing: boolean }>(
        "/api/communications/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            organizationId,
            type: createType,
            name: createType === "GROUP" ? groupName : undefined,
            participantIds: selectedMembers,
          }),
        },
      );
      setCreateOpen(false);
      setGroupName("");
      setSelectedMembers([]);
      await loadConversations(organizationId, { preferId: result.conversation.id });
      toast.success(result.existing ? "Opened existing direct conversation" : "Conversation created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create conversation");
    } finally {
      setCreating(false);
    }
  }

  function toggleMember(userId: string, checked: boolean) {
    if (createType === "DIRECT") {
      setSelectedMembers(checked ? [userId] : []);
      return;
    }
    setSelectedMembers((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );
  }

  function runMessageSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const query = messageSearchInput.trim();
    setMessageSearch(query);
    setNextCursor(null);
    void loadMessages(selectedId, { query });
  }

  function clearMessageSearch() {
    setMessageSearch("");
    setMessageSearchInput("");
    setNextCursor(null);
    if (selectedId) void loadMessages(selectedId, { query: "" });
  }

  if (loadingCompanies) {
    return (
      <div className="flex min-h-[560px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#E8501A]" aria-label="Loading chat" />
      </div>
    );
  }

  if (!companies.length) {
    return (
      <Card className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full bg-orange-50 p-4">
          <MessageCircle className="h-8 w-8 text-[#E8501A]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Create a company workspace first</h1>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Team chat is tenant-scoped, so every conversation belongs to one company.
          </p>
        </div>
        <Button asChild className="bg-[#E8501A] hover:bg-[#C2410C]">
          <Link href="/apps">Open App Center</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-6 w-6 text-[#E8501A]" />
            <h1 className="text-2xl font-bold text-slate-900">Team Chat</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Self-hosted direct and group messaging inside your company workspace.
          </p>
        </div>
        <Select value={organizationId} onValueChange={changeOrganization}>
          <SelectTrigger className="w-full bg-white sm:w-[260px]" aria-label="Company workspace">
            <SelectValue placeholder="Choose a company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((company) => (
              <SelectItem key={company.id} value={company.id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="grid min-h-[650px] overflow-hidden p-0 lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="flex min-h-[300px] flex-col border-b bg-slate-50/60 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Conversations</h2>
              <Button
                size="sm"
                className="h-8 bg-[#E8501A] px-2.5 hover:bg-[#C2410C]"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> New
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={conversationFilter}
                onChange={(event) => setConversationFilter(event.target.value)}
                className="bg-white pl-8"
                placeholder="Find a conversation"
              />
            </div>
          </div>
          <ScrollArea className="h-[350px] flex-1 lg:h-auto">
            <div className="space-y-1 p-2">
              {loadingRooms ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E8501A]" />
                </div>
              ) : visibleConversations.length ? (
                visibleConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => selectConversation(conversation.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                      selectedId === conversation.id
                        ? "bg-orange-50 text-slate-900"
                        : "hover:bg-white",
                    )}
                  >
                    <Avatar className="h-10 w-10 border bg-white">
                      <AvatarFallback className="bg-white text-xs text-slate-600">
                        {conversation.type === "GROUP" ? <Users className="h-4 w-4" /> : initials(conversation.participants.find((p) => p.userId !== currentUser?.id)?.user ?? null)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm font-medium">{conversation.displayName}</span>
                        {conversation.unreadCount > 0 && (
                          <Badge className="h-5 min-w-5 justify-center bg-[#E8501A] px-1.5 text-[10px]">
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {conversation.lastMessage
                          ? `${conversation.lastMessage.sender?.name || conversation.lastMessage.sender?.email || "Former member"}: ${conversation.lastMessage.body}`
                          : "No messages yet"}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-4 py-12 text-center text-sm text-slate-500">
                  {conversationFilter ? "No conversations match your search." : "No conversations yet. Start one with a company member."}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-h-[650px] min-w-0 flex-col bg-white">
          {selectedConversation ? (
            <>
              <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {selectedConversation.type === "GROUP" ? (
                      <Hash className="h-4 w-4 text-slate-400" />
                    ) : (
                      <UserRound className="h-4 w-4 text-slate-400" />
                    )}
                    <h2 className="truncate font-semibold text-slate-900">{selectedConversation.displayName}</h2>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {selectedConversation.participants
                      .map((participant) => participant.user.name || participant.user.email)
                      .join(", ")}
                  </p>
                </div>
                <form onSubmit={runMessageSearch} className="relative w-full sm:w-[260px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={messageSearchInput}
                    onChange={(event) => setMessageSearchInput(event.target.value)}
                    placeholder="Search messages"
                    className="h-9 pl-8 pr-8"
                  />
                  {(messageSearchInput || messageSearch) && (
                    <button
                      type="button"
                      onClick={clearMessageSearch}
                      className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                      aria-label="Clear message search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </form>
              </div>

              {messageSearch && (
                <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  Showing messages containing “{messageSearch}”
                </div>
              )}

              <ScrollArea className="h-[430px] flex-1">
                <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
                  {hasMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mx-auto text-slate-500"
                      disabled={loadingMessages}
                      onClick={() =>
                        void loadMessages(selectedId, {
                          older: true,
                          query: messageSearch,
                          cursor: nextCursor,
                        })
                      }
                    >
                      {loadingMessages && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Load earlier messages
                    </Button>
                  )}
                  {loadingMessages && !messages.length ? (
                    <div className="flex justify-center py-16">
                      <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
                    </div>
                  ) : messages.length ? (
                    messages.map((message) => {
                      const mine = message.senderId === currentUser?.id;
                      return (
                        <div
                          key={message.id}
                          className={cn("flex max-w-[85%] gap-2 sm:max-w-[75%]", mine ? "ml-auto flex-row-reverse" : "")}
                        >
                          <Avatar className="mt-1 h-8 w-8 shrink-0 border">
                            <AvatarFallback className="text-[10px]">{initials(message.sender)}</AvatarFallback>
                          </Avatar>
                          <div className={cn("min-w-0", mine ? "text-right" : "") }>
                            <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
                              {!mine && <span className="font-medium text-slate-600">{message.sender?.name || message.sender?.email || "Former member"}</span>}
                              <span>{messageTime(message.createdAt)}</span>
                            </div>
                            <div
                              className={cn(
                                "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-left text-sm",
                                mine
                                  ? "rounded-tr-sm bg-[#E8501A] text-white"
                                  : "rounded-tl-sm bg-slate-100 text-slate-800",
                              )}
                            >
                              {message.body}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <MessageCircle className="h-9 w-9 text-slate-300" />
                      <p className="mt-3 text-sm font-medium text-slate-600">
                        {messageSearch ? "No matching messages" : "Start the conversation"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {messageSearch ? "Try a different search phrase." : "Messages are stored in this portal's database."}
                      </p>
                    </div>
                  )}
                  <div ref={messageEndRef} />
                </div>
              </ScrollArea>

              <div className="border-t p-3 sm:p-4">
                <div className="mx-auto flex max-w-4xl items-end gap-2">
                  <Textarea
                    value={composer}
                    onChange={(event) => setComposer(event.target.value.slice(0, 4_000))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={1}
                    maxLength={4_000}
                    placeholder={`Message ${selectedConversation.displayName}`}
                    className="min-h-11 resize-none"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-11 w-11 shrink-0 bg-[#E8501A] hover:bg-[#C2410C]"
                    disabled={!composer.trim() || sending}
                    onClick={() => void sendMessage()}
                    aria-label="Send message"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mx-auto mt-1 max-w-4xl text-right text-[10px] text-slate-400">
                  Enter to send · Shift+Enter for a new line · {composer.length}/4000
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full bg-orange-50 p-4">
                <MessageCircle className="h-8 w-8 text-[#E8501A]" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">Choose or start a conversation</h2>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Direct and group messages are private to their participants inside this company.
              </p>
              <Button className="mt-5 bg-[#E8501A] hover:bg-[#C2410C]" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New conversation
              </Button>
            </div>
          )}
        </main>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Only active members of this company can be invited. Participants alone can read the room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={createType === "DIRECT" ? "default" : "outline"}
                className={createType === "DIRECT" ? "bg-[#E8501A] hover:bg-[#C2410C]" : ""}
                onClick={() => {
                  setCreateType("DIRECT");
                  setSelectedMembers((current) => current.slice(0, 1));
                }}
              >
                <UserRound className="mr-2 h-4 w-4" /> Direct
              </Button>
              <Button
                type="button"
                variant={createType === "GROUP" ? "default" : "outline"}
                className={createType === "GROUP" ? "bg-[#E8501A] hover:bg-[#C2410C]" : ""}
                onClick={() => setCreateType("GROUP")}
              >
                <Users className="mr-2 h-4 w-4" /> Group
              </Button>
            </div>
            {createType === "GROUP" && (
              <div className="space-y-1.5">
                <Label htmlFor="chat-group-name">Group name</Label>
                <Input
                  id="chat-group-name"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value.slice(0, 80))}
                  placeholder="e.g. Product team"
                  maxLength={80}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{createType === "DIRECT" ? "Choose one person" : "Choose participants"}</Label>
              <ScrollArea className="h-56 rounded-md border">
                <div className="space-y-1 p-2">
                  {members.filter((member) => member.id !== currentUser?.id).length ? (
                    members
                      .filter((member) => member.id !== currentUser?.id)
                      .map((member) => {
                        const checked = selectedMembers.includes(member.id);
                        return (
                          <label
                            key={member.id}
                            className="flex cursor-pointer items-center gap-3 rounded-md p-2.5 hover:bg-slate-50"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => toggleMember(member.id, value === true)}
                            />
                            <Avatar className="h-8 w-8 border">
                              <AvatarFallback className="text-[10px]">{initials(member)}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-800">
                                {member.name || member.email}
                              </span>
                              <span className="block truncate text-xs text-slate-400">{member.email}</span>
                            </span>
                            <Badge variant="outline" className="text-[10px]">{member.organizationRole}</Badge>
                          </label>
                        );
                      })
                  ) : (
                    <p className="p-6 text-center text-sm text-slate-500">
                      No other active company members are available.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#E8501A] hover:bg-[#C2410C]"
              disabled={
                creating ||
                selectedMembers.length < 1 ||
                (createType === "DIRECT" && selectedMembers.length !== 1) ||
                (createType === "GROUP" && !groupName.trim())
              }
              onClick={() => void createConversation()}
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
