'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Send, MessageCircle, User, MoreVertical, Phone, Video, Users, Heart, ThumbsUp, Smile } from 'lucide-react';

/**
 * Enhanced MessagesPage
 * - Realtime (INSERT / UPDATE / DELETE handled)
 * - Optimistic send
 * - Edit message
 * - Soft delete (is_deleted)
 * - Reply-to messages
 * - Reactions (emoji -> array of user_ids stored as JSONB)
 * - Infinite scroll (older messages)
 *
 * Required DB columns on conversation_messages:
 *  - id uuid primary key (gen_random_uuid())
 *  - conversation_id uuid
 *  - user_id uuid
 *  - message text
 *  - created_at timestamptz default now()
 *  - updated_at timestamptz
 *  - is_deleted boolean default false
 *  - reply_to uuid NULL (foreign key to conversation_messages.id)
 *  - reactions jsonb default '{}'  -- format: {"👍": ["user-uuid"], "❤️": ["user-uuid"]}
 */

type Msg = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  updated_at?: string | null;
  is_deleted?: boolean;
  reply_to?: string | null;
  reactions?: Record<string, string[]>; // emoji -> userIds
  full_name?: string | null;
  avatar_url?: string | null;
  isOptimistic?: boolean;
};

type Participant = {
  user_id: string;
  full_name?: string;
  avatar_url?: string;
};

type Conversation = {
  id: string;
  batch_id?: string;
  trek_id?: string;
  name?: string;
  participants: Participant[];
  created_at?: string;
};

export default function MessagesPage() {
  const supabase = createClient();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // paging / infinite scroll
  const PAGE_SIZE = 30;
  const [hasMore, setHasMore] = useState(true);
  const oldestMessageAtRef = useRef<string | null>(null);

  // refs for scroll/real-time
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const realtimeChannelRef = useRef<any | null>(null);

  // UI state for edit/delete/reply/reactions
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);

  // reaction picker simple set
  const REACTIONS = ['❤️', '😂', '👍'];

  // helper: map profile ids -> profile
  const fetchProfilesMap = async (ids: string[]) => {
    if (!ids || ids.length === 0) return new Map<string, any>();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', ids);

    if (error) {
      console.error('Error fetching profiles:', error);
      return new Map();
    }
    return new Map((profiles || []).map((p: any) => [p.id, p]));
  };

  // autoscroll helper (scrolls to bottom)
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // LOAD CONVERSATIONS
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const { data: parts, error: partsErr } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', user.id);

        if (partsErr) throw partsErr;

        const convIds = (parts || []).map((p: any) => p.conversation_id);
        if (convIds.length === 0) {
          if (mounted) setConversations([]);
          return;
        }

        const { data: convs, error: convsErr } = await supabase
          .from('conversations')
          .select('id, batch_id, name, created_at, trek_batches(trek_id)')
          .in('id', convIds)
          .order('created_at', { ascending: false });

        if (convsErr) throw convsErr;

        const { data: allParts } = await supabase
          .from('conversation_participants')
          .select('conversation_id, user_id')
          .in('conversation_id', convIds);

        const participantIds = Array.from(new Set((allParts || []).map((p: any) => p.user_id)));
        const profileMap = await fetchProfilesMap(participantIds);

        const convObjs = (convs || []).map((c: any) => {
          const participantsForConv = (allParts || []).filter((p: any) => p.conversation_id === c.id);
          return {
            id: c.id,
            batch_id: c.batch_id,
            trek_id: c.trek_batches?.[0]?.trek_id,
            name: c.name,
            created_at: c.created_at,
            participants: participantsForConv.map((p: any) => {
              const prof = profileMap.get(p.user_id);
              return { user_id: p.user_id, full_name: prof?.full_name, avatar_url: prof?.avatar_url };
            })
          } as Conversation;
        });

        if (mounted) setConversations(convObjs);
      } catch (err) {
        console.error('Load conversations error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [user, supabase]);

  // Open conversation from query params (conversationId)
  useEffect(() => {
    if (!user) return;
    const conversationIdParam = searchParams.get('conversationId');

    const init = async () => {
      if (conversationIdParam) {
        const existing = conversations.find(c => c.id === conversationIdParam);
        if (existing) {
          setSelectedConversation(existing);
          return;
        }
        try {
          const { data: conv, error: convErr } = await supabase
            .from('conversations')
            .select('id, batch_id, name, created_at, trek_batches(trek_id)')
            .eq('id', conversationIdParam)
            .single();
          if (convErr) throw convErr;

          const { data: parts } = await supabase
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', conv.id);

          const participantIds = (parts || []).map((p: any) => p.user_id);
          const profileMap = await fetchProfilesMap(participantIds);

          const convObj: Conversation = {
            id: conv.id,
            batch_id: conv.batch_id,
            trek_id: conv.trek_batches?.[0]?.trek_id,
            name: conv.name,
            participants: participantIds.map((id: string) => {
              const prof = profileMap.get(id);
              return { user_id: id, full_name: prof?.full_name, avatar_url: prof?.avatar_url };
            })
          };

          setConversations(prev => (prev.find(c => c.id === convObj.id) ? prev : [convObj, ...prev]));
          setSelectedConversation(convObj);
        } catch (err) {
          console.error('Open conversation error:', err);
        }
        return;
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user, conversations]);

  // Helper: fetch messages page (older messages)
  const fetchMessagesPage = async (conversationId: string, before?: string | null, pageSize = PAGE_SIZE) => {
    try {
      let query = supabase
        .from('conversation_messages')
        .select('id, conversation_id, user_id, message, created_at, updated_at, is_deleted, reply_to, reactions')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(pageSize);

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Fetch messages page error:', error);
        return { rows: [], hasMore: false };
      }

      const rows = (data || []).reverse();

      const profileIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
      const profileMap = await fetchProfilesMap(profileIds);

      const mapped: Msg[] = rows.map((r: any) => ({
        id: r.id,
        content: r.message,
        sender_id: r.user_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,
        reply_to: r.reply_to,
        reactions: r.reactions || {},
        full_name: profileMap.get(r.user_id)?.full_name,
        avatar_url: profileMap.get(r.user_id)?.avatar_url
      }));

      return {
        rows: mapped,
        hasMore: (data || []).length === pageSize
      };
    } catch (err) {
      console.error('fetchMessagesPage error:', err);
      return { rows: [], hasMore: false };
    }
  };

  // Load initial messages when conversation selected
  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      oldestMessageAtRef.current = null;
      setHasMore(true);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      return;
    }

    let mounted = true;
    const load = async () => {
      const { rows, hasMore: more } = await fetchMessagesPage(selectedConversation.id, undefined, PAGE_SIZE);
      if (!mounted) return;
      setMessages(rows);
      setHasMore(more);
      oldestMessageAtRef.current = rows.length > 0 ? rows[0].created_at : null;
      setTimeout(() => scrollToBottom('auto'), 0);
    };

    load();

    return () => { mounted = false; };
  }, [selectedConversation]);

  // Infinite scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let loadingOlder = false;

    const handleScroll = async () => {
      if (!selectedConversation) return;
      if (!el) return;

      if (el.scrollTop < 150 && !loadingOlder && hasMore) {
        loadingOlder = true;

        try {
          const before = oldestMessageAtRef.current;
          const prevScrollHeight = el.scrollHeight;

          const { rows, hasMore: more } = await fetchMessagesPage(selectedConversation.id, before, PAGE_SIZE);
          if (!rows || rows.length === 0) {
            setHasMore(false);
            loadingOlder = false;
            return;
          }

          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newRows = rows.filter(r => !existingIds.has(r.id));
            return [...newRows, ...prev];
          });

          oldestMessageAtRef.current = rows[0].created_at;

          requestAnimationFrame(() => {
            const newScrollHeight = el.scrollHeight;
            el.scrollTop = newScrollHeight - prevScrollHeight + el.scrollTop;
          });

          setHasMore(more);
        } catch (err) {
          console.error('Error loading older messages:', err);
        } finally {
          loadingOlder = false;
        }
      }
    };

    el.addEventListener('scroll', handleScroll);
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [selectedConversation, hasMore]);

  // Realtime subscription
  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    if (!selectedConversation) return;

    const convId = selectedConversation.id;

    const channel = supabase
      .channel(`public:conversation_messages:conversation_id=eq.${convId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${convId}`
        },
        (payload) => {
          const newMsg = payload.new;
          if (!newMsg) return;

          setMessages(prev => {
            // remove optimistic duplicates
            const filtered = prev.filter(m => !(m.isOptimistic && m.sender_id === newMsg.user_id && m.content === newMsg.message));
            if (filtered.some(m => m.id === newMsg.id)) return filtered;
            return [
              ...filtered,
              {
                id: newMsg.id,
                content: newMsg.message,
                sender_id: newMsg.user_id,
                created_at: newMsg.created_at,
                updated_at: newMsg.updated_at,
                is_deleted: newMsg.is_deleted,
                reply_to: newMsg.reply_to,
                reactions: newMsg.reactions || {}
              }
            ];
          });

          // fetch profile
          (async () => {
            try {
              const { data: profile } = await supabase
                .from('profiles')
                .select('id, full_name, avatar_url')
                .eq('id', newMsg.user_id)
                .single();

              if (profile) {
                setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...m, full_name: profile.full_name, avatar_url: profile.avatar_url } : m));
              }
            } catch (err) {
              console.error('Error fetching profile for realtime msg:', err);
            }
          })();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${convId}`
        },
        (payload) => {
          const updated = payload.new;
          if (!updated) return;
          setMessages(prev => prev.map(msg => msg.id === updated.id ? ({
            ...msg,
            content: updated.message,
            is_deleted: updated.is_deleted,
            updated_at: updated.updated_at,
            reply_to: updated.reply_to,
            reactions: updated.reactions || {}
          }) : msg));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${convId}`
        },
        (payload) => {
          const deleted = payload.old;
          if (!deleted) return;
          setMessages(prev => prev.filter(msg => msg.id !== deleted.id));
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [selectedConversation, supabase]);

  // Send message with optimistic UI (supports reply_to)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConversation || !user) return;

    const content = newMessage.trim();
    setNewMessage('');

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Msg = {
      id: tempId,
      content,
      sender_id: user.id,
      created_at: new Date().toISOString(),
      updated_at: undefined,
      is_deleted: false,
      reply_to: replyTo ? replyTo.id : null,
      reactions: {},
      isOptimistic: true
    };

    // resolve sender profile quickly
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      if (prof) {
        optimisticMsg.full_name = prof.full_name;
        optimisticMsg.avatar_url = prof.avatar_url;
      }
    } catch (err) {
      console.error('Error resolving my profile for optimistic message:', err);
    }

    setMessages(prev => [...prev, optimisticMsg]);
    setReplyTo(null);
    setTimeout(() => scrollToBottom('smooth'), 20);

    try {
      const { error } = await supabase
        .from('conversation_messages')
        .insert({
          conversation_id: selectedConversation.id,
          user_id: user.id,
          message: content,
          reply_to: optimisticMsg.reply_to
        });

      if (error) {
        console.error('Send error:', error);
        setMessages(prev => prev.filter(m => m.id !== tempId));
        alert('Failed to send message');
      }
    } catch (err) {
      console.error('Unexpected send error:', err);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert('Failed to send message (unexpected)');
    }
  };

  // Start editing
  const startEditMessage = (msg: Msg) => {
    setEditing(msg);
    setNewMessage(msg.content);
    setMenuOpen(null);
  };

  // Submit edited message
  const submitEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editing || !selectedConversation) return;
    const trimmed = newMessage.trim();
    if (!trimmed) return;

    const originalId = editing.id;

    // optimistic update locally
    setMessages(prev => prev.map(m => m.id === originalId ? { ...m, content: trimmed, updated_at: new Date().toISOString(), isOptimistic: false } : m));

    setEditing(null);
    setNewMessage('');

    const { error } = await supabase
      .from('conversation_messages')
      .update({ message: trimmed, updated_at: new Date().toISOString() })
      .eq('id', originalId);

    if (error) {
      console.error('Edit error:', error);
      alert('Failed to edit');
    }
  };

  // Delete (soft delete)
  const deleteMessage = async (id: string) => {
    const confirmDelete = confirm('Delete this message?');
    if (!confirmDelete) return;

    // optimistic
    setMessages(prev => prev.map(m => m.id === id ? { ...m, is_deleted: true, content: '' } : m));

    const { error } = await supabase
      .from('conversation_messages')
      .update({ is_deleted: true, message: '', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Delete error:', error);
      alert('Failed to delete');
    }

    setMenuOpen(null);
  };

  // Reply
  const startReply = (msg: Msg) => {
    setReplyTo(msg);
    setMenuOpen(null);
    // focus input
    const input = document.querySelector<HTMLInputElement>('input[type="text"]');
    input?.focus();
  };

  // Toggle reaction
  const toggleReaction = async (msg: Msg, emoji: string) => {
    if (!user) return;

    // build new reactions object locally
    const prevReactions = msg.reactions || {};
    const userList = new Set(prevReactions[emoji] || []);
    if (userList.has(user.id)) {
      userList.delete(user.id);
    } else {
      userList.add(user.id);
    }

    const newReactions = { ...prevReactions, [emoji]: Array.from(userList) };
    // remove empty arrays
    if (newReactions[emoji].length === 0) delete newReactions[emoji];

    // optimistic update
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reactions: newReactions } : m));

    // persist
    const { error } = await supabase
      .from('conversation_messages')
      .update({ reactions: newReactions, updated_at: new Date().toISOString() })
      .eq('id', msg.id);

    if (error) {
      console.error('Reaction save error:', error);
      // ideally revert local state by refetch, but keep simple: refetch message
      const { data } = await supabase.from('conversation_messages').select('id, reactions').eq('id', msg.id).single();
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reactions: data?.reactions || {} } : m));
    }
  };

  // Helper: display name/avatar for conversation
  const getConversationDisplay = (conv: Conversation) => {
    return { name: conv.name || 'Group Chat', avatar: null };
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">Please log in to view messages.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] bg-slate-50 flex">
      {/* Sidebar */}
      <div className={`w-full md:w-80 bg-white border-r border-slate-200 flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b border-slate-200">
          <h1 className="text-xl font-bold text-slate-800">Messages</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-slate-500">Loading chats...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p>No conversations yet.</p>
              <p className="text-sm mt-2">Start a chat from a user profile!</p>
            </div>
          ) : (
            <div className="py-2">
              {conversations.length > 0 && (
                <div className="mb-4">
                  <h2 className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Conversations</h2>
                  {conversations.map(conv => {
                    const display = getConversationDisplay(conv);
                    return (
                      <button
                        key={conv.id}
                        onClick={() => setSelectedConversation(conv)}
                        className={`w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors border-l-4 ${selectedConversation?.id === conv.id ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent'}`}
                      >
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                            <Users className="w-6 h-6 text-blue-600" />
                          </div>
                        </div>
                        <div className="flex-1 text-left">
                          <h3 className="font-semibold text-slate-900 truncate">{display.name}</h3>
                          <p className="text-sm text-slate-500 truncate">{conv.participants.length} participants</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-white ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        {selectedConversation ? (
          <>
            <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between bg-white shadow-sm z-10">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedConversation(null)} className="md:hidden p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                {(() => {
                  const display = getConversationDisplay(selectedConversation);
                  return (
                    <>
                      <div className="relative">
                        {display.avatar ? (
                          <img src={display.avatar} alt={display.name} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="w-5 h-5 text-slate-400" />
                          </div>
                        )}
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                      </div>
                      <div>
                        <h2 className="font-bold text-slate-900">{getConversationDisplay(selectedConversation).name}</h2>
                        <p className="text-xs text-green-600 font-medium">Online</p>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2">
                <button className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">
                  <Phone className="w-5 h-5" />
                </button>
                <button className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">
                  <Video className="w-5 h-5" />
                </button>
                <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages container */}
            <div ref={containerRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
              {hasMore && (
                <div className="text-center text-xs text-slate-400 mb-2">Scroll up to load older messages</div>
              )}

              {messages.map((msg) => {
                const isMe = msg.sender_id === user.id;
                const replied = msg.reply_to ? messages.find(m => m.id === msg.reply_to) : null;

                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%]`}>
                      {!isMe && (
                        <div className="text-[12px] text-slate-600 mb-1">{msg.full_name || 'Unknown'}</div>
                      )}

                      <div className="flex items-start gap-2">
                        <div className={`rounded-2xl px-4 py-3 shadow-sm ${isMe ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none'}`}>
                          {msg.is_deleted ? (
                            <p className="italic text-slate-400 text-sm">Message deleted</p>
                          ) : (
                            <>
                              {replied && (
                                <div className="border-l-2 border-slate-200 pl-2 mb-1 text-xs text-slate-500 italic max-w-[320px] overflow-hidden text-ellipsis">
                                  <strong className="text-[12px]">{replied.full_name || 'Someone'}:</strong> {replied.content}
                                </div>
                              )}

                              <p className="text-sm leading-relaxed">{msg.content}
                                {msg.updated_at && !msg.is_deleted && (
                                  <span className="text-[10px] ml-1 opacity-70"> (edited)</span>
                                )}
                              </p>

                              {/* reactions display */}
                              <div className="flex gap-2 mt-2">
                                {msg.reactions && Object.entries(msg.reactions).map(([emoji, userIds]) => (
                                  <button key={emoji} onClick={() => toggleReaction(msg, emoji)} className="text-xs py-0.5 px-2 rounded-full border border-slate-200 bg-white flex items-center gap-1">
                                    <span>{emoji}</span>
                                    <span className="text-[11px] text-slate-500">{userIds.length}</span>
                                  </button>
                                ))}
                              </div>

                              <p className={`text-[10px] mt-1 text-right ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </>
                          )}
                        </div>

                        {/* Options for own messages */}
                        {isMe && !msg.is_deleted && (
                          <div className="relative">
                            <button onClick={() => setMenuOpen(menuOpen === msg.id ? null : msg.id)} className="p-1 text-slate-400 hover:text-slate-600">
                              <MoreVertical size={16} />
                            </button>

                            {menuOpen === msg.id && (
                              <div className="absolute right-0 mt-1 bg-white shadow-lg rounded-lg border p-2 w-36 z-50">
                                <button className="w-full px-2 py-1 text-left hover:bg-slate-100 rounded text-sm" onClick={() => startEditMessage(msg)}>Edit</button>
                                <button className="w-full px-2 py-1 text-left hover:bg-slate-100 rounded text-sm" onClick={() => startReply(msg)}>Reply</button>
                                <div className="border-t my-1" />
                                <div className="flex gap-1 px-1">
                                  {REACTIONS.map(r => (
                                    <button key={r} onClick={() => toggleReaction(msg, r)} className="px-2 py-1 rounded hover:bg-slate-50">{r}</button>
                                  ))}
                                </div>
                                <div className="border-t my-1" />
                                <button className="w-full px-2 py-1 text-left hover:bg-slate-100 rounded text-sm text-red-600" onClick={() => deleteMessage(msg.id)}>Delete</button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* actions for others: reply and react */}
                        {!isMe && !msg.is_deleted && (
                          <div className="flex flex-col items-center gap-1 ml-1">
                            <button onClick={() => startReply(msg)} className="p-1 text-slate-400 hover:text-slate-600"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h11M3 6h11M3 14h11M3 18h11" /></svg></button>
                            <div className="flex flex-col gap-1">
                              {REACTIONS.map(r => (
                                <button key={r} onClick={() => toggleReaction(msg, r)} className="text-xs">{r}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* Input: text is black via text-black class */}
            <div className="p-4 bg-white border-t border-slate-200">
              <form onSubmit={editing ? submitEdit : handleSendMessage} className="flex flex-col gap-2 max-w-4xl mx-auto">
                {replyTo && (
                  <div className="bg-slate-50 border border-slate-100 px-3 py-2 rounded text-sm">
                    Replying to <strong>{replyTo.full_name || 'Someone'}</strong>: <span className="italic">{replyTo.content}</span>
                    <button type="button" onClick={() => setReplyTo(null)} className="ml-3 text-sm text-red-500">Cancel</button>
                  </div>
                )}

                {editing && (
                  <div className="text-xs text-blue-600">Editing message… <button type="button" onClick={() => { setEditing(null); setNewMessage(''); }} className="ml-2 text-red-500">Cancel</button></div>
                )}

                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 py-3 px-4 bg-slate-100 border-0 rounded-full focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-black"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all hover:shadow-lg transform active:scale-95"
                  >
                    <Send className="w-5 h-5 ml-0.5" />
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <MessageCircle className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">Your Messages</h3>
            <p className="max-w-xs text-center text-slate-500">Select a conversation from the sidebar to start chatting or connect with a new trekker.</p>
          </div>
        )}
      </div>
    </div>
  );
}
